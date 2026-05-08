# Codex Observer Agent 设计记录

日期：2026-05-08

本文档记录一次关于“在不打扰主编程 agent 的情况下，让用户用自然语言了解 Codex 当前状态和执行原因”的产品与架构讨论，供后续窗口继续推进。

## 背景

当前 Codex 在长时间写代码、跑测试、修 CI 或执行重构时，用户经常只能看到较粗的运行状态。虽然 Codex App 和 CLI 已经提供了一些状态能力，例如 detail level、terminal、diff、overlay、`/status`、`/ps`、`/side`，但这些能力更偏“查看面板”或“会话状态”，还没有形成一个完整的、可对话的旁路观察 agent。

核心痛点是：

- 用户想知道“现在在干嘛”，但不希望打断正在工作的 coding agent。
- 用户想问“为什么跑这个命令 / 为什么改这个文件 / 是否卡住了”，但普通发消息可能会被当成新指令处理。
- 长任务中用户需要可观察性、解释和信任感，而不仅仅是 `running`。

## 产品概念

建议产品名暂定为 **Codex Observer Agent**。

它不是替代 coding agent，而是一个旁路观察员：

- 主 coding agent 继续负责写代码、读文件、跑命令、提交变更。
- Observer Agent 只读观察主 agent 的事件、日志、diff、终端输出、plan 和权限请求。
- 用户与 Observer Agent 单独对话，询问状态、原因、风险和下一步，不进入主 coding thread。

三条硬边界：

1. **只读观察**
   Observer 默认不修改文件，不运行破坏性命令，不向主 agent 发送新指令。

2. **独立对话**
   用户的状态问题进入 Observer 的会话，不打断主 agent 当前 turn。

3. **显式干预**
   如果用户决定介入，例如“把这句话发给主 agent”或“中断它”，必须通过明确按钮或确认动作升级。

## 用户问题

Observer 应该能回答这些自然语言问题：

- 现在在做什么？
- 刚才为什么运行这个命令？
- 它现在是不是卡住了？
- 它已经改了哪些文件？
- 最近失败的测试是什么？
- 它下一步大概会做什么？
- 这次权限请求安全吗？
- 它是不是偏离了我最初的任务？
- 我现在是否应该介入？

回答必须基于可见证据，例如最近的工具调用、命令输出、git diff、测试结果、plan 状态、transcript 摘要。Observer 不能声称读取了主模型的隐藏思考链。

## 当前市场判断

截至 2026-05-08，没有看到成熟产品完整覆盖“独立 Observer Agent 观察主 coding agent，并支持不中断式自然语言追问”的形态。

已有相邻能力：

- Codex App 有 overlay、detail level、terminal、diff、plan。
- Codex CLI 有 `/status`、`/ps`、`/side`。
- Codex hooks 可以捕获 `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`PermissionRequest`、`Stop` 等事件。
- Codex plugins 可以打包 skills、MCP servers 和相关本地能力。
- Cursor Background Agents、Claude Code hooks/subagents 等方向也有相邻能力，但不是完整的旁路自然语言观察员产品。

结论：有真实需求，有相邻基础设施，但完整产品位仍然比较空。

## 与 Alembic 的关系

更新后的建议：如果目标是“小而美、不牵连太多内容”，应优先采用 **单独仓库、单独插件、单独产品心智**。

早期讨论曾倾向于“工程上集合，产品上分离”，也就是先在 Alembic monorepo 内孵化，再视情况拆分。但进一步收束目标后，Observer 更适合从第一版开始就保持轻量边界。

Alembic 现在已经具备很多适合孵化 Observer 的基础设施：

- daemon
- dashboard
- jobs
- SQLite / 本地状态
- MCP 入口
- Codex plugin packaging
- skills
- HTTP / Socket realtime
- Guard、Recipes、project memory 等可选增强能力

这些能力说明 Alembic 可以作为未来增强或参考实现，但不应该成为 Observer MVP 的默认依赖。Observer 的第一版更适合单独仓库，例如：

```text
codex-observer/
  .codex-plugin/plugin.json
  hooks/
  mcp/
  src/
    collector/
    timeline/
    status/
    ask/
  docs/
```

这样做的好处：

- 安装后马上懂：`Codex Observer` = 看 Codex 在干嘛，并允许不中断追问。
- 不要求用户理解 Alembic、Recipes、Guard、项目知识库。
- 技术边界更干净：只关心 hooks、transcript、terminal、diff、timeline、ask。
- 发布和试错更快：不被 Alembic 的 daemon、dashboard、DB schema、MCP 层级一起拖住。

产品心智上不建议把它作为 Alembic 的普通功能。Alembic 的核心叙事是项目知识、Recipes、Guard、代码库记忆；Observer 的核心叙事是 coding agent 的实时可观察性和解释。一个用户即使不需要 Alembic 项目知识，也可能需要 Observer。

建议产品拆分：

- **Alembic for Codex**：项目记忆、Recipes、Guard、bootstrap。
- **Codex Observer**：不中断主 agent 的状态观察、解释和问答。

增强关系：

- 只安装 Observer：回答“现在在干嘛、是否卡住、刚才改了什么”。
- 同时安装 Alembic：还能回答“它这么改是否符合项目 Recipes / Guard / 架构惯例”。

因此本文档可以继续保留在 Alembic 仓库中，作为概念孵化和决策记录；真正实现时建议创建独立仓库。

## 建议架构

```text
Codex Main Agent
  ├─ tool calls
  ├─ terminal output
  ├─ diff / file edits
  ├─ plan updates
  └─ permission requests

Codex Hooks / Local Collector
  ├─ event JSONL
  ├─ SQLite event store
  ├─ transcript pointer
  └─ session metadata

Observer Service
  ├─ event normalizer
  ├─ session state model
  ├─ stuck / risk detector
  ├─ evidence retriever
  └─ natural language answerer

Observer UI / CLI / MCP
  ├─ status timeline
  ├─ current state card
  ├─ ask box
  ├─ intervention controls
  └─ optional Alembic enrichment
```

### 事件采集

通过 Codex hooks 或等价机制记录：

- session start
- user prompt submitted
- pre tool use
- post tool use
- permission request
- plan update
- command start / output / exit
- file edit summary
- stop / error

落地格式可以先用 JSONL，稳定后进入 SQLite。

### 状态模型

Observer 维护一个面向用户的状态，而不是只展示原始事件。

可能状态：

- `inspecting`: 正在读代码或搜索上下文
- `planning`: 正在整理计划
- `editing`: 正在修改文件
- `testing`: 正在运行测试或构建
- `debugging`: 正在根据失败输出定位问题
- `waiting_permission`: 等待用户批准
- `blocked`: 疑似卡住或连续失败
- `idle`: 当前没有活跃动作
- `done`: 当前 turn 完成

### 自然语言回答

回答应包含：

- 简短结论
- 证据来源
- 风险或不确定性
- 用户可选动作

示例：

```text
它现在在验证刚才的 MCP 入口改动。依据是最近运行了 `npm run test:unit`，
并且失败集中在 `CodexMcpServer.test.ts`。看起来不是卡死，而是在处理测试断言和实际工具输出不一致。
```

## MVP 范围

第一版应该小而完整：

1. 采集主 agent 工具调用、命令、权限请求和 stop 事件。
2. 保存本地 timeline。
3. 提供 `status` 摘要。
4. 提供自然语言 ask 能力。
5. 支持回答“现在在干嘛 / 为什么这么做 / 是否卡住 / 改了什么”。
6. 对卡住、重复失败、长时间无输出做简单检测。
7. 默认只读，不向主 agent 发消息。

明确不做：

- 不读取或暴露隐藏 chain-of-thought。
- 不承诺精确百分比进度。
- 不自动中断主 agent。
- 不默认修改用户项目。
- 不默认依赖 Alembic Recipes / Guard。

## 后续演进

可以分阶段推进：

1. **Observer Log MVP**
   先只做 hooks 采集、timeline、status 摘要。

2. **Observer Ask**
   增加独立问答接口，可以解释最近动作和失败。

3. **Observer UI**
   优先做独立 sidecar 页面、菜单栏、CLI 或轻量本地页面，展示当前状态、时间线和 ask box。

4. **Intervention Gate**
   用户可以显式把一句话发送给主 agent，或请求中断，但必须确认。

5. **Alembic Enrichment**
   如果同一项目启用了 Alembic，则把 Recipes、Guard、project memory 作为额外证据源。这个能力应作为 optional integration，而不是 MVP 基础依赖。

6. **独立发布**
   `Codex Observer` 从第一版开始按独立 package / plugin 发布；Alembic 侧只保留文档、集成点或示例。

## 关键产品判断

这个方向的价值不是再做一个状态栏，而是把长时间运行的 coding agent 变得可观察、可追问、可信任。

用户真正想知道的通常不是“它是否 running”，而是：

- 它为什么这样做？
- 它有没有走偏？
- 它是不是卡住？
- 我现在是否需要介入？

Observer Agent 应该成为用户和 coding agent 之间的解释层，而不是新的控制层。

如果目标是做一个“小而美”的产品，最终判断是：**单独仓库更好，Alembic 只作为未来增强和生态集成。**
