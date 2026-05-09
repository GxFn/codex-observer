#!/usr/bin/env node
import { ensureDashboardProcess } from "../src/dashboard.mjs";
import { runCli } from "../src/cli.mjs";

const eventName = process.argv[2];

runCli(["capture", "--quiet", ...process.argv.slice(2)])
  .then(async () => {
    if (eventName !== "SessionStart" || process.env.CODEX_OBSERVER_AUTO_DASHBOARD === "0") return;
    try {
      await ensureDashboardProcess();
    } catch (error) {
      console.error(`[codex-observer] dashboard autostart failed: ${error?.message || String(error)}`);
    }
  })
  .catch((error) => {
  console.error(`[codex-observer] ${error?.message || String(error)}`);
  process.exitCode = 1;
  });
