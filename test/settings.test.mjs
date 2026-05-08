import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { publicSettings, readSettings, saveProviderSettings } from "../src/settings.mjs";

test("saves provider keys locally without exposing plaintext settings", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "codex-observer-settings-"));

  const saved = await saveProviderSettings(
    {
      provider: "deepseek",
      apiKey: "sk-test-secret",
    },
    { home },
  );
  const settings = await readSettings({ home });
  const stat = await fs.stat(settings.file);

  assert.equal(saved.activeProvider, "deepseek");
  assert.equal(saved.providers.deepseek.configured, true);
  assert.equal(saved.providers.deepseek.source, "local");
  assert.equal(saved.providers.deepseek.apiKey, undefined);
  assert.equal(settings.providers.deepseek.apiKey, "sk-test-secret");
  assert.equal(stat.mode & 0o777, 0o600);
});

test("clears only the selected local provider key", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "codex-observer-settings-"));

  await saveProviderSettings({ provider: "openai", apiKey: "sk-openai" }, { home });
  await saveProviderSettings({ provider: "deepseek", apiKey: "sk-deepseek" }, { home });
  const cleared = await saveProviderSettings({ provider: "deepseek", clearKey: true }, { home });
  const settings = publicSettings(await readSettings({ home }));

  assert.equal(cleared.providers.openai.configured, true);
  assert.equal(cleared.providers.deepseek.configured, false);
  assert.deepEqual(cleared, settings);
});
