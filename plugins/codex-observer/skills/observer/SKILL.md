---
name: observer
description: Query Codex Observer for read-only status, timeline, and evidence-backed answers about what the main Codex agent is doing, or open the local Observer chat dashboard. Use when the user asks what Codex is doing, whether it is stuck, why a command ran, what files changed, whether they should intervene, or wants the Observer panel/chat/dashboard.
---

# Codex Observer

Use this skill when the user wants a non-interrupting status check on the current Codex work.

## Preferred workflow

1. Use the `codex_observer_status` MCP tool when available.
2. Use `codex_observer_ask` for natural language questions such as:
   - "现在在干嘛？"
   - "是不是卡住了？"
   - "刚才为什么运行这个命令？"
   - "已经改了哪些文件？"
3. Use `codex_observer_timeline` when the user asks for recent evidence or event history.
4. Use `codex_observer_dashboard` when the user asks to open the Observer panel, chat, dashboard, or right-side page. Plugin hooks auto-start the localhost dashboard on `SessionStart`, and this tool ensures it is running and returns the URL.
5. After `codex_observer_dashboard`, actually open the returned URL in the Codex in-app browser when the Browser plugin is available in the current session. Use the Browser skill/workflow for that navigation. Only say the panel is opened after browser navigation succeeds.
6. If the Browser plugin is not available, do not claim the panel is opened. Say that the dashboard service is ready, provide the URL, and explain that the current plugin cannot control the right-side browser panel by itself.
7. When the user explicitly asks for a sub-agent Observer, call `codex_observer_agent_brief` when available, then launch a child agent only if the runtime exposes sub-agent tools. The child agent should be read-only and use Observer status/timeline/ask as its evidence source.
8. If MCP tools are unavailable, fall back to the local CLI:

```bash
codex-observer status
codex-observer ask "现在在干嘛？"
codex-observer timeline --limit 20
codex-observer serve --port 8765
codex-observer agent-brief
```

## Boundaries

- Only report visible evidence from hooks, commands, file entries, outputs, permissions, and stop events.
- Do not claim access to hidden chain-of-thought.
- Do not send instructions to the main coding agent unless the user explicitly asks for an intervention path.
- Phrase uncertainty clearly when the timeline is sparse or stale.
