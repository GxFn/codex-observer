import assert from "node:assert/strict";
import test from "node:test";
import { buildObserverAgentBrief } from "../src/agent-brief.mjs";
import { runCli } from "../src/cli.mjs";

test("builds a read-only Observer sub-agent brief", () => {
  const brief = buildObserverAgentBrief({
    home: "/tmp/observer home",
    sessionId: "s1",
    dashboardUrl: "http://127.0.0.1:8765/",
  });

  assert.match(brief, /只读的旁路观察员/);
  assert.match(brief, /不修改文件/);
  assert.match(brief, /codex_observer_status/);
  assert.match(brief, /Session: s1/);
  assert.match(brief, /Dashboard: http:\/\/127\.0\.0\.1:8765\//);
  assert.match(brief, /codex-observer --home '\/tmp\/observer home' --session s1 status/);
});

test("prints agent brief from the CLI", async () => {
  const output = await captureLog(() => runCli(["agent-brief", "--session", "s-cli"]));

  assert.match(output, /Codex Observer 子 agent/);
  assert.match(output, /Session: s-cli/);
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
