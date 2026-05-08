import fs from "node:fs/promises";
import path from "node:path";
import { resolveObserverHome } from "./config.mjs";

export const PROVIDERS = {
  openai: {
    label: "OpenAI",
    envName: "OPENAI_API_KEY",
  },
  deepseek: {
    label: "DeepSeek",
    envName: "DEEPSEEK_API_KEY",
  },
};

export async function readSettings(options = {}) {
  const home = resolveObserverHome(options.home);
  const file = settingsFilePath(home);
  const stored = await readStoredSettings(file);
  const providers = Object.fromEntries(
    Object.entries(PROVIDERS).map(([id, provider]) => {
      const storedKey = cleanKey(stored.providers?.[id]?.apiKey);
      const envKey = cleanKey(process.env[provider.envName]);
      return [
        id,
        {
          ...provider,
          apiKey: storedKey || envKey || null,
          source: storedKey ? "local" : envKey ? "env" : "none",
        },
      ];
    }),
  );
  const configuredProvider = Object.entries(providers).find(([, provider]) => provider.apiKey)?.[0];
  const activeProvider =
    validProvider(stored.activeProvider) && providers[stored.activeProvider]?.apiKey
      ? stored.activeProvider
      : configuredProvider || (validProvider(stored.activeProvider) ? stored.activeProvider : "openai");

  return { home, file, activeProvider, providers };
}

export async function saveProviderSettings(update = {}, options = {}) {
  const home = resolveObserverHome(options.home);
  const file = settingsFilePath(home);
  const stored = await readStoredSettings(file);
  const provider = update.provider || update.activeProvider || stored.activeProvider || "openai";

  assertProvider(provider);
  stored.activeProvider = provider;
  stored.providers ||= {};
  stored.providers[provider] ||= {};

  if (update.clearKey) {
    delete stored.providers[provider].apiKey;
  } else if (Object.hasOwn(update, "apiKey")) {
    const apiKey = cleanKey(update.apiKey);
    if (apiKey) stored.providers[provider].apiKey = apiKey;
  }

  await writeStoredSettings(file, stored);
  return publicSettings(await readSettings({ home }));
}

export function publicSettings(settings) {
  return {
    activeProvider: settings.activeProvider,
    providers: Object.fromEntries(
      Object.entries(settings.providers).map(([id, provider]) => [
        id,
        {
          label: provider.label,
          envName: provider.envName,
          configured: Boolean(provider.apiKey),
          source: provider.source,
        },
      ]),
    ),
  };
}

export function settingsFilePath(home) {
  return path.join(resolveObserverHome(home), "settings.json");
}

async function readStoredSettings(file) {
  try {
    const text = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(text);
    return {
      activeProvider: parsed.activeProvider,
      providers: parsed.providers && typeof parsed.providers === "object" ? parsed.providers : {},
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { providers: {} };
    if (error instanceof SyntaxError) return { providers: {} };
    throw error;
  }
}

async function writeStoredSettings(file, settings) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(file, 0o600);
}

function assertProvider(provider) {
  if (!validProvider(provider)) {
    throw new Error(`Unsupported provider: ${provider}`);
  }
}

function validProvider(provider) {
  return Object.hasOwn(PROVIDERS, provider);
}

function cleanKey(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
