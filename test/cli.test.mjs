import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { runCli } from "../src/cli.mjs";

test("prints package version from global flag and command", async () => {
  const pkg = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(await captureLog(() => runCli(["--version"])), pkg.version);
  assert.equal(await captureLog(() => runCli(["version"])), pkg.version);
});

async function captureLog(callback) {
  const originalLog = console.log;
  const lines = [];
  console.log = (value = "") => lines.push(String(value));
  try {
    await callback();
  } finally {
    console.log = originalLog;
  }
  return lines.join("\n");
}
