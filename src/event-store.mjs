import fs from "node:fs/promises";
import path from "node:path";
import { latestSessionPath, resolveObserverHome, sessionFilePath } from "./config.mjs";

export async function appendEvent(event, options = {}) {
  const home = resolveObserverHome(options.home);
  const sessionId = event.sessionId || "unknown-session";
  const file = sessionFilePath(home, sessionId);

  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${JSON.stringify(event)}\n`, "utf8");
  await fs.writeFile(latestSessionPath(home), sessionId, "utf8");

  return { home, file, sessionId };
}

export async function readSessionEvents(options = {}) {
  const home = resolveObserverHome(options.home);
  const sessionId = await resolveSessionId(home, options.sessionId);
  if (!sessionId) {
    return { home, sessionId: null, events: [] };
  }

  const file = sessionFilePath(home, sessionId);
  try {
    const text = await fs.readFile(file, "utf8");
    return {
      home,
      sessionId,
      events: parseJsonl(text),
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { home, sessionId, events: [] };
    }
    throw error;
  }
}

export async function listSessions(options = {}) {
  const home = resolveObserverHome(options.home);
  const dir = path.join(home, "sessions");

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const sessions = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const file = path.join(dir, entry.name);
      const stat = await fs.stat(file);
      sessions.push({
        sessionId: entry.name.replace(/\.jsonl$/, ""),
        file,
        updatedAt: stat.mtime.toISOString(),
        bytes: stat.size,
      });
    }
    sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { home, sessions };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { home, sessions: [] };
    }
    throw error;
  }
}

export function parseJsonl(text) {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        return {
          id: `invalid-${index + 1}`,
          ts: null,
          event: "invalid_jsonl",
          summary: `Invalid JSONL line ${index + 1}: ${error.message}`,
          rawLine: line,
        };
      }
    });
}

async function resolveSessionId(home, explicitSessionId) {
  if (explicitSessionId) return explicitSessionId;

  try {
    const latest = await fs.readFile(latestSessionPath(home), "utf8");
    return latest.trim() || null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}
