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
4. Use `codex_observer_dashboard` when the user asks to open the Observer panel, chat, dashboard, or right-side page. Plugin hooks auto-start the localhost dashboard on `SessionStart`, and this tool ensures it is running and returns the URL; if the Browser plugin is available, open that URL in the Codex in-app browser.
5. If MCP tools are unavailable, fall back to the local CLI:

```bash
codex-observer status
codex-observer ask "现在在干嘛？"
codex-observer timeline --limit 20
codex-observer serve --port 8765
```

## Boundaries

- Only report visible evidence from hooks, commands, file entries, outputs, permissions, and stop events.
- Do not claim access to hidden chain-of-thought.
- Do not send instructions to the main coding agent unless the user explicitly asks for an intervention path.
- Phrase uncertainty clearly when the timeline is sparse or stale.
