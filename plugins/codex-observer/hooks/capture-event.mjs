#!/usr/bin/env node
import { runCli } from "../src/cli.mjs";

runCli(["capture", "--quiet", ...process.argv.slice(2)]).catch((error) => {
  console.error(`[codex-observer] ${error?.message || String(error)}`);
  process.exitCode = 1;
});
