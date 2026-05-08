import assert from "node:assert/strict";
import test from "node:test";
import { buildEvidence, buildObserverMessages, streamDeepSeekChat } from "../src/chat.mjs";
import { buildStatus } from "../src/status.mjs";

test("builds observer chat messages from safe evidence", () => {
  const status = buildStatus([
    {
      ts: "2026-05-09T00:00:00.000Z",
      kind: "tool_finish",
      event: "PostToolUse",
      sessionId: "s1",
      toolName: "exec_command",
      command: "npm test",
      files: [],
      status: "succeeded",
      summary: "命令完成：npm test",
      raw: { hidden: "do not include raw payloads" },
    },
  ]);

  const messages = buildObserverMessages({
    question: "现在在干嘛？",
    history: [{ role: "user", content: "上一轮" }],
    status,
    events: status.evidence,
  });

  assert.equal(messages[0].role, "system");
  assert.match(messages[1].content, /当前可见证据/);
  assert.match(messages.at(-1).content, /现在在干嘛/);
  assert.doesNotMatch(messages[1].content, /do not include raw payloads/);
});

test("streams DeepSeek SSE content chunks", async () => {
  const encoder = new TextEncoder();
  let requestBody;
  const fetchImpl = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              [
                'data: {"choices":[{"delta":{"content":"你"}}]}',
                "",
                'data: {"choices":[{"delta":{"content":"好"}}]}',
                "",
                "data: [DONE]",
                "",
              ].join("\n"),
            ),
          );
          controller.close();
        },
      }),
      { status: 200 },
    );
  };

  let output = "";
  await streamDeepSeekChat({
    apiKey: "test-key",
    question: "hello",
    status: buildStatus([]),
    events: [],
    write: (chunk) => {
      output += chunk;
    },
    fetchImpl,
  });

  assert.equal(output, "你好");
  assert.equal(requestBody.model, "deepseek-v4-flash");
  assert.equal(requestBody.stream, true);
  assert.deepEqual(requestBody.thinking, { type: "disabled" });
});

test("adds explicit plan and inferred route summary to model evidence", () => {
  const events = [
    {
      ts: "2026-05-09T00:00:00.000Z",
      kind: "plan_update",
      sessionId: "s-route",
      status: "succeeded",
      summary: "更新执行计划：正在实现路线摘要",
      plan: {
        explanation: "整理路线",
        items: [
          { step: "读取上下文", status: "completed" },
          { step: "实现路线摘要", status: "in_progress" },
          { step: "运行验证", status: "pending" },
        ],
      },
    },
    {
      ts: "2026-05-09T00:00:10.000Z",
      kind: "tool_finish",
      sessionId: "s-route",
      toolName: "exec_command",
      command: "rg update_plan src",
      status: "succeeded",
      summary: "命令完成：rg update_plan src",
      files: [],
    },
  ];
  const status = buildStatus(events, { now: "2026-05-09T00:00:20.000Z" });
  const evidence = buildEvidence(status, events);

  assert.equal(evidence.routeSummary.phaseLabel, "读取上下文");
  assert.deepEqual(evidence.routeSummary.explicitPlan.inProgress, ["实现路线摘要"]);
  assert.deepEqual(evidence.routeSummary.explicitPlan.pending, ["运行验证"]);
  assert.match(evidence.routeSummary.observedSteps.at(-1).label, /搜索上下文/);
  assert.match(evidence.routeSummary.likelyNext.join(" "), /实现路线摘要/);
});
