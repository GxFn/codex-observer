import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { answerQuestion } from "../src/ask.mjs";
import { appendEvent, readSessionEvents } from "../src/event-store.mjs";
import { normalizeHookEvent } from "../src/normalize.mjs";
import { buildStatus } from "../src/status.mjs";

test("normalizes hook input and records a session", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "codex-observer-"));
  const event = normalizeHookEvent(
    {
      session_id: "s1",
      cwd: "/repo",
      tool_name: "exec_command",
      tool_input: { cmd: "npm test" },
      tool_response: { exitCode: 1, stderr: "1 failed" },
    },
    { eventName: "PostToolUse", now: "2026-05-08T00:00:00.000Z" },
  );

  await appendEvent(event, { home });
  const { events, sessionId } = await readSessionEvents({ home });

  assert.equal(sessionId, "s1");
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "tool_finish");
  assert.equal(events[0].status, "failed");
  assert.equal(events[0].command, "npm test");
});

test("derives status and asks about failures", () => {
  const events = [
    {
      ts: "2026-05-08T00:00:00.000Z",
      kind: "session_start",
      sessionId: "s2",
      files: [],
      status: "unknown",
      summary: "会话开始",
    },
    {
      ts: "2026-05-08T00:00:10.000Z",
      kind: "tool_finish",
      event: "PostToolUse",
      sessionId: "s2",
      toolName: "apply_patch",
      files: ["src/status.mjs"],
      status: "succeeded",
      summary: "工具完成：apply_patch",
    },
    {
      ts: "2026-05-08T00:00:20.000Z",
      kind: "tool_finish",
      event: "PostToolUse",
      sessionId: "s2",
      toolName: "exec_command",
      command: "node --test",
      files: [],
      status: "failed",
      outputSummary: "1 failed",
      summary: "命令失败：node --test",
    },
  ];

  const status = buildStatus(events, { now: "2026-05-08T00:00:30.000Z" });
  const answer = answerQuestion("最近失败的测试是什么？", status, events);

  assert.equal(status.state, "debugging");
  assert.deepEqual(status.changedFiles, ["src/status.mjs"]);
  assert.match(answer, /node --test/);
  assert.match(answer, /1 failed/);
});

test("flags a long-running active tool as possibly stuck", () => {
  const events = [
    {
      ts: "2026-05-08T00:00:00.000Z",
      kind: "tool_start",
      event: "PreToolUse",
      sessionId: "s3",
      toolName: "exec_command",
      command: "npm run build",
      files: [],
      status: "unknown",
      summary: "开始运行命令：npm run build",
    },
  ];

  const status = buildStatus(events, { now: "2026-05-08T00:05:30.000Z" });
  const answer = answerQuestion("是不是卡住了？", status, events);

  assert.equal(status.state, "blocked");
  assert.equal(status.stateLabel, "疑似卡住");
  assert.equal(status.confidence, "low");
  assert.equal(status.isPossiblyStuck, true);
  assert.match(status.nextLikelyStep, /terminal/);
  assert.match(answer, /卡住迹象/);
});
