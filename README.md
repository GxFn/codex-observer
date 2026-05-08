# Codex Observer

Codex Observer 是一个只读旁路观察器，用来回答“Codex 现在在干什么？”而不把这个问题发进正在工作的主 coding thread。

第一版目标很小：

- 用 Codex hooks 记录可见事件到本地 JSONL timeline。
- 用 `codex-observer status` 摘要当前状态。
- 用 `codex-observer ask "现在在干嘛？"` 基于证据回答自然语言问题。
- 通过 MCP 暴露 `status`、`ask`、`timeline`，方便独立 Observer Agent 调用。
- 默认只读，不中断、不改写、不向主 agent 发送指令。

## 快速试用

```bash
npm test
node ./bin/codex-observer.mjs status
node ./bin/codex-observer.mjs serve --port 8765
```

本地页面默认使用无需登录的 Observer 规则问答；右上角也保留 `API key` 入口，可以把 OpenAI 或 DeepSeek key 保存到本机配置中。配置 DeepSeek key 后，页面会优先使用 DeepSeek Chat Completion 流式回答。

模型问答会带上一份只读 evidence pack：当前状态、最近事件、失败摘要、文件列表，以及结合可见计划和行为推断生成的 `routeSummary`。

模拟一条 hook 事件：

```bash
printf '{"session_id":"demo","tool_name":"exec_command","tool_input":{"cmd":"npm test"},"tool_response":{"exitCode":1,"stderr":"1 failed"}}' \
  | node ./bin/codex-observer.mjs capture PostToolUse

node ./bin/codex-observer.mjs status
node ./bin/codex-observer.mjs ask "最近失败的测试是什么？"
```

默认数据目录是 `~/.codex-observer`。开发时可以用：

```bash
CODEX_OBSERVER_HOME=./tmp/observer-home node ./bin/codex-observer.mjs status
```

更多本地验证步骤见 [docs/getting-started.md](./docs/getting-started.md)，事件规范见 [docs/event-format.md](./docs/event-format.md)。

## 作为 Codex 插件安装

```bash
codex plugin marketplace add GxFn/codex-observer
codex plugin marketplace upgrade codex-observer
```

如果已经添加过 marketplace，只运行第二条 upgrade 即可。安装后重启 Codex，并开一个新会话。Observer 会通过 hooks 把可见事件写入 `~/.codex-observer`，并暴露 `codex-observer:observer` skill 和 MCP 工具。你可以在 Codex 里问：

```text
用 Codex Observer 看看现在在干嘛？
```

如果也想在终端直接用 CLI，进入仓库后执行：

```bash
npm link
```

然后查看：

```bash
codex-observer status
codex-observer ask "现在 Codex 在干嘛？"
codex-observer timeline --limit 20
```

如果想先用本地仓库安装：

```bash
codex plugin marketplace add /Users/gaoxuefeng/Documents/github/codex-observer
```

## 插件结构

```text
.codex-plugin/plugin.json  # Codex 插件元信息
hooks.json                 # Codex hook 配置
hooks/capture-event.mjs    # hook 入口，读取 stdin JSON 并记录 timeline
bin/codex-observer.mjs     # CLI
mcp/server.mjs             # 只读 MCP server
src/                       # event store、状态推断、问答和格式化
```

## 能回答的问题

- 现在在做什么？
- 刚才为什么运行这个命令？
- 它现在是不是卡住了？
- 它已经改了哪些文件？
- 最近失败的测试是什么？
- 下一步大概会做什么？
- 我现在是否应该介入？

回答会明确说明依据，并避免声称读取主模型的隐藏思考。

## 边界

Observer 只解释可见证据：hook 事件、命令、文件条目、输出摘要、权限请求和 stop 事件。它不会读取隐藏 chain-of-thought，也不会自动中断或控制主 agent。

更完整的产品和架构记录见 [docs/codex-observer-agent-design.md](./docs/codex-observer-agent-design.md)。
