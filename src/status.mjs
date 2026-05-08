import { DEFAULT_STUCK_AFTER_MS } from "./config.mjs";

const INSPECTION_COMMANDS = /\b(rg|grep|find|ls|sed|cat|head|tail|wc|git\s+(status|show|diff|log))\b/i;
const TEST_COMMANDS = /\b(test|spec|jest|vitest|pytest|cargo test|go test|xcodebuild|swift test|npm run test|pnpm test|yarn test|build|tsc)\b/i;
const EDIT_TOOLS = /(apply_patch|write|edit|notebookedit)/i;

export function buildStatus(events, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const last = events.at(-1) || null;
  const activeTool = findActiveTool(events);
  const recentCommand = findLast(events, (event) => event.command);
  const lastFailure = findLast(events, (event) => event.status === "failed");
  const changedFiles = unique(events.flatMap((event) => event.files || []));
  const permission = findLast(events, (event) => event.kind === "permission_request");
  const repeatedFailures = detectRepeatedFailures(events);
  const idleMs = last?.ts ? Math.max(0, now - new Date(last.ts)) : null;
  const state = inferState({ events, last, activeTool, lastFailure, permission, idleMs, options });
  const risks = [];

  if (state === "waiting_permission") {
    risks.push("正在等待权限审批，主 agent 可能无法继续推进。");
  }
  if (activeTool && idleMs != null && idleMs > (options.stuckAfterMs || DEFAULT_STUCK_AFTER_MS)) {
    risks.push(`工具调用已经 ${formatDuration(idleMs)} 没有新的可见事件，可能需要观察是否卡住。`);
  }
  if (repeatedFailures.length > 0) {
    risks.push(`同类失败重复出现：${repeatedFailures[0].label}。`);
  }
  if (changedFiles.length >= 8) {
    risks.push(`已记录 ${changedFiles.length} 个改动文件，建议关注变更范围。`);
  }

  const evidence = events.slice(-6).map((event) => ({
    ts: event.ts,
    summary: event.summary,
    command: event.command,
    files: event.files || [],
    status: event.status,
  }));

  return {
    sessionId: events[0]?.sessionId || null,
    state,
    stateLabel: stateLabels[state] || state,
    confidence: inferConfidence(events, activeTool, idleMs),
    isPossiblyStuck: risks.some((risk) => risk.includes("卡住")),
    eventCount: events.length,
    lastEventAt: last?.ts || null,
    idleMs,
    activeTool,
    recentCommand: recentCommand
      ? {
          command: recentCommand.command,
          status: recentCommand.status,
          ts: recentCommand.ts,
          summary: recentCommand.summary,
        }
      : null,
    lastFailure: lastFailure
      ? {
          command: lastFailure.command,
          toolName: lastFailure.toolName,
          ts: lastFailure.ts,
          outputSummary: lastFailure.outputSummary,
        }
      : null,
    changedFiles,
    risks,
    nextLikelyStep: inferNextStep({ state, lastFailure, changedFiles, recentCommand }),
    evidence,
  };
}

export function formatDuration(ms) {
  if (ms == null) return "未知时长";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时 ${minutes % 60} 分钟`;
}

function inferState({ events, last, activeTool, lastFailure, permission, idleMs, options }) {
  if (!last) return "idle";
  if (last.kind === "stop") return "done";
  if (permission && permission === last) return "waiting_permission";
  if (activeTool) return stateFromTool(activeTool);
  if (idleMs != null && idleMs > (options.stuckAfterMs || DEFAULT_STUCK_AFTER_MS) && last.kind !== "stop") {
    return "blocked";
  }
  if (lastFailure && events.slice(-3).includes(lastFailure)) return "debugging";
  if (last.kind === "user_prompt" || last.kind === "plan_update") return "planning";
  if (last.kind === "tool_finish" && last.status === "succeeded") return stateFromTool(last);
  return "planning";
}

function stateFromTool(event) {
  const command = event.command || "";
  const tool = event.toolName || "";
  if (TEST_COMMANDS.test(command)) return "testing";
  if (EDIT_TOOLS.test(tool)) return "editing";
  if (INSPECTION_COMMANDS.test(command)) return "inspecting";
  if (/git\s+(add|commit|push|branch|checkout|switch)/i.test(command)) return "versioning";
  return event.kind === "tool_start" ? "working" : "planning";
}

function findActiveTool(events) {
  const last = events.at(-1);
  return last?.kind === "tool_start" ? last : null;
}

function findLast(events, predicate) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (predicate(events[index])) return events[index];
  }
  return null;
}

function detectRepeatedFailures(events) {
  const failed = events.filter((event) => event.status === "failed");
  const counts = new Map();
  for (const event of failed) {
    const label = event.command || event.toolName || event.event;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([label, count]) => ({ label, count }));
}

function inferConfidence(events, activeTool, idleMs) {
  if (events.length === 0) return "low";
  if (activeTool || idleMs == null || idleMs < DEFAULT_STUCK_AFTER_MS) return "medium";
  return "low";
}

function inferNextStep({ state, lastFailure, changedFiles, recentCommand }) {
  if (state === "waiting_permission") return "等待用户批准或拒绝权限请求。";
  if (state === "debugging" && lastFailure) return "根据失败输出定位问题，随后再次运行相关测试或检查。";
  if (state === "testing" && lastFailure) return "根据失败输出定位问题，随后再次运行相关测试。";
  if (state === "editing") return "继续完成当前文件修改，然后查看 diff 或运行验证。";
  if (state === "inspecting") return "读完上下文后形成修改计划或定位目标文件。";
  if (state === "done") return "当前 turn 已结束，可以查看总结、diff 或下一步指令。";
  if (changedFiles.length > 0 && recentCommand?.status === "succeeded") return "很可能会验证改动或整理最终说明。";
  return "继续基于最近证据推进当前任务。";
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

const stateLabels = {
  idle: "空闲",
  inspecting: "读取上下文",
  planning: "整理计划",
  editing: "修改文件",
  testing: "运行验证",
  debugging: "定位失败",
  waiting_permission: "等待权限",
  blocked: "疑似卡住",
  done: "已完成",
  working: "执行工具",
  versioning: "处理 Git",
};
