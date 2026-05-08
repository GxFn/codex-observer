import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const rootManifestUrl = new URL("../.codex-plugin/plugin.json", import.meta.url);
const bundledManifestUrl = new URL("../plugins/codex-observer/.codex-plugin/plugin.json", import.meta.url);
const rootSkillUrl = new URL("../skills/observer/SKILL.md", import.meta.url);
const bundledSkillUrl = new URL("../plugins/codex-observer/skills/observer/SKILL.md", import.meta.url);
const marketplaceUrl = new URL("../.agents/plugins/marketplace.json", import.meta.url);
const packageUrl = new URL("../package.json", import.meta.url);
const repoRootUrl = new URL("../", import.meta.url);
const bundleRootUrl = new URL("../plugins/codex-observer/", import.meta.url);
const mirroredEntries = [".mcp.json", "hooks.json", "bin", "hooks", "mcp", "src"];

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

test("keeps the marketplace plugin bundle self-contained", async () => {
  for (const entry of mirroredEntries) {
    const rootPath = path.join(repoRootUrl.pathname, entry);
    const bundledPath = path.join(bundleRootUrl.pathname, entry);

    const rootStat = await fs.lstat(rootPath);
    const stat = await fs.lstat(bundledPath);
    assert.equal(stat.isSymbolicLink(), false, `${entry} must be a real bundled file or directory`);

    if (rootStat.isFile()) {
      const rootText = await fs.readFile(rootPath, "utf8");
      const bundledText = await fs.readFile(bundledPath, "utf8");
      assert.equal(bundledText, rootText, `${entry} drifted from the root implementation`);
      continue;
    }

    const rootFiles = await listFiles(rootPath);
    const bundledFiles = await listFiles(bundledPath);
    assert.deepEqual(bundledFiles, rootFiles, `${entry} file list drifted from the root implementation`);

    for (const relativePath of rootFiles) {
      const rootText = await fs.readFile(path.join(rootPath, relativePath), "utf8");
      const bundledText = await fs.readFile(path.join(bundledPath, relativePath), "utf8");
      assert.equal(bundledText, rootText, `${entry}/${relativePath} drifted from the root implementation`);
    }
  }
});

async function listFiles(targetPath, basePath = targetPath) {
  const stat = await fs.lstat(targetPath);
  if (stat.isSymbolicLink()) return [`${path.relative(basePath, targetPath)} -> symlink`];
  if (stat.isFile()) return [path.relative(basePath, targetPath)];

  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const childPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(childPath, basePath)));
    else files.push(path.relative(basePath, childPath));
  }
  return files.sort();
}
