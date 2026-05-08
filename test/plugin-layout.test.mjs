import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const rootManifestUrl = new URL("../.codex-plugin/plugin.json", import.meta.url);
const bundledManifestUrl = new URL("../plugins/codex-observer/.codex-plugin/plugin.json", import.meta.url);
const rootSkillUrl = new URL("../skills/observer/SKILL.md", import.meta.url);
const bundledSkillUrl = new URL("../plugins/codex-observer/skills/observer/SKILL.md", import.meta.url);
const marketplaceUrl = new URL("../.agents/plugins/marketplace.json", import.meta.url);
const packageUrl = new URL("../package.json", import.meta.url);

test("keeps root plugin metadata and marketplace bundle in sync", async () => {
  const rootManifest = JSON.parse(await fs.readFile(rootManifestUrl, "utf8"));
  const bundledManifest = JSON.parse(await fs.readFile(bundledManifestUrl, "utf8"));
  const rootSkill = await fs.readFile(rootSkillUrl, "utf8");
  const bundledSkill = await fs.readFile(bundledSkillUrl, "utf8");
  const marketplace = JSON.parse(await fs.readFile(marketplaceUrl, "utf8"));
  const pkg = JSON.parse(await fs.readFile(packageUrl, "utf8"));

  assert.deepEqual(bundledManifest, rootManifest);
  assert.equal(rootManifest.version, pkg.version);
  assert.equal(bundledSkill, rootSkill);
  assert.equal(marketplace.name, "codex-observer");
  assert.equal(marketplace.plugins[0]?.name, "codex-observer");
  assert.equal(marketplace.plugins[0]?.source?.path, "./plugins/codex-observer");
});
