# Event Format

Collector 会尽量兼容不同 hook payload。输入可以包含这些常见字段：

```json
{
  "session_id": "session-id",
  "turn_id": "turn-id",
  "cwd": "/repo",
  "transcript_path": "/path/to/transcript.jsonl",
  "tool_name": "exec_command",
  "tool_input": { "cmd": "npm test" },
  "tool_response": { "exitCode": 1, "stderr": "1 failed" }
}
```

写入 JSONL 的规范化事件形状：

```json
{
  "id": "stable-event-id",
  "ts": "2026-05-08T00:00:00.000Z",
  "event": "PostToolUse",
  "kind": "tool_finish",
  "sessionId": "session-id",
  "turnId": "turn-id",
  "cwd": "/repo",
  "transcriptPath": "/path/to/transcript.jsonl",
  "toolName": "exec_command",
  "command": "npm test",
  "files": [],
  "plan": null,
  "status": "failed",
  "exitCode": 1,
  "inputSummary": "{\"cmd\":\"npm test\"}",
  "outputSummary": "{\"exitCode\":1,\"stderr\":\"1 failed\"}",
  "summary": "命令失败：npm test"
}
```

`raw` 字段也会保留原始 payload，方便未来补充更精确的解释器。

当 hook 捕获到 `update_plan` 工具或 plan 类事件时，collector 会把计划条目结构化保存到 `plan` 字段：

```json
{
  "kind": "plan_update",
  "summary": "更新执行计划：正在运行验证",
  "plan": {
    "explanation": "整理执行路线",
    "items": [
      { "step": "读取上下文", "status": "completed" },
      { "step": "实现路线摘要", "status": "in_progress" },
      { "step": "运行验证", "status": "pending" }
    ]
  }
}
```
