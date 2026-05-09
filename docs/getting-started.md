# Getting Started

Codex Observer 的 MVP 由三部分组成：

1. `hooks.json` 把 Codex 可见事件送进 `hooks/capture-event.mjs`。
2. collector 把事件规范化后写入 `~/.codex-observer/sessions/<session>.jsonl`。
3. `SessionStart` hook 自动启动本地 HTTP dashboard 服务。
4. CLI、HTTP dashboard 和 MCP server 只读查询这些事件。

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

打开 `http://127.0.0.1:8765` 可以看到当前状态、最近 timeline，并且可以在页面里询问状态。右上角的 `API key` 入口可以保存 OpenAI 或 DeepSeek key；key 只保存在本地 `CODEX_OBSERVER_HOME/settings.json`，接口返回时只暴露脱敏配置状态。配置 DeepSeek key 后，页面会优先通过 DeepSeek Chat Completion 流式回答；未配置或 provider 未支持时回退到本地规则问答。

模型问答会收到一份只读 evidence pack，其中包含当前状态、最近事件、失败摘要、文件列表，以及 `routeSummary`。`routeSummary` 会合并可见的 `update_plan` 条目和从命令/编辑/测试事件推断出的路线摘要，用来回答“当前 agent 在做什么、计划是什么、接下来可能做什么”。

安装为插件后，dashboard 服务会在新会话 `SessionStart` 时自动启动。当前 Codex 插件 API 不能强制弹出右侧网页面板；如果你把右侧浏览器停留在 `http://127.0.0.1:8765/`，后续带上插件的新任务会自动让这个页面可用。设置 `CODEX_OBSERVER_AUTO_DASHBOARD=0` 可以关闭自动启动。

## MCP 工具

`mcp/server.mjs` 暴露三个只读工具：

- `codex_observer_status`
- `codex_observer_ask`
- `codex_observer_timeline`
- `codex_observer_dashboard`

这些工具适合给独立 Observer Agent 调用。前三个只读取本地 timeline，不会向主 coding agent 发送消息；`codex_observer_dashboard` 会启动本地 Chat 面板服务并返回 URL。Codex 目前不会因为带上插件就自动弹出右侧网页，所以需要让 agent 显式打开这个 URL。
