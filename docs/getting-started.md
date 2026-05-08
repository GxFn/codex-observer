# Getting Started

Codex Observer 的 MVP 由三部分组成：

1. `hooks.json` 把 Codex 可见事件送进 `hooks/capture-event.mjs`。
2. collector 把事件规范化后写入 `~/.codex-observer/sessions/<session>.jsonl`。
3. CLI、HTTP dashboard 和 MCP server 只读查询这些事件。

## 手动验证

```bash
CODEX_OBSERVER_HOME=./tmp/demo \
node ./bin/codex-observer.mjs status
```

写入一条模拟事件：

```bash
printf '{"session_id":"demo","tool_name":"exec_command","tool_input":{"cmd":"npm test"},"tool_response":{"exitCode":1,"stderr":"1 failed"}}' \
  | CODEX_OBSERVER_HOME=./tmp/demo node ./bin/codex-observer.mjs capture PostToolUse
```

查询：

```bash
CODEX_OBSERVER_HOME=./tmp/demo node ./bin/codex-observer.mjs status
CODEX_OBSERVER_HOME=./tmp/demo node ./bin/codex-observer.mjs ask "它是不是卡住了？"
CODEX_OBSERVER_HOME=./tmp/demo node ./bin/codex-observer.mjs timeline --limit 10
```

## 本地页面

```bash
CODEX_OBSERVER_HOME=./tmp/demo node ./bin/codex-observer.mjs serve --port 8765
```

打开 `http://127.0.0.1:8765` 可以看到状态、风险、改动文件和最近 timeline，并且可以在页面里询问状态。

## MCP 工具

`mcp/server.mjs` 暴露三个只读工具：

- `codex_observer_status`
- `codex_observer_ask`
- `codex_observer_timeline`

这些工具适合给独立 Observer Agent 调用。它们只读取本地 timeline，不会向主 coding agent 发送消息。
