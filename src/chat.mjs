const DEEPSEEK_CHAT_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_CHAT_MODEL = "deepseek-v4-flash";

const SYSTEM_PROMPT = [
  "你是 Codex Observer，一个只读的旁路观察 agent。",
  "你只能根据提供的 status、timeline、命令摘要、失败摘要和文件列表回答。",
  "不要声称读取了主 coding agent 的隐藏思考。",
  "不要向主 agent 下指令，不要修改文件，不要建议用户把普通聊天当成主 agent 指令。",
  "如果证据不足，明确说明不确定性。",
  "回答要简洁、像一个正在协助用户观察任务进展的工程同伴。",
].join("\n");

export async function streamDeepSeekChat({
  apiKey,
  question,
  history = [],
  status,
  events,
  write,
  fetchImpl = fetch,
}) {
  if (!apiKey) throw new Error("DeepSeek API key is not configured.");
  if (!question?.trim()) throw new Error("Missing chat question.");

  const response = await fetchImpl(DEEPSEEK_CHAT_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_CHAT_MODEL,
      messages: buildObserverMessages({ question, history, status, events }),
      stream: true,
      thinking: { type: "disabled" },
      max_tokens: 1200,
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const detail = await safeResponseText(response);
    throw new Error(`DeepSeek API request failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  if (!response.body) throw new Error("DeepSeek API did not return a response stream.");

  await readSseContent(response.body, write);
}

export function buildObserverMessages({ question, history = [], status, events }) {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        "当前可见证据如下。请只基于这些证据回答后续用户问题。",
        JSON.stringify(buildEvidence(status, events), null, 2),
      ].join("\n\n"),
    },
    ...normalizeHistory(history),
    { role: "user", content: String(question).trim() },
  ];
}

export function buildEvidence(status, events = []) {
  return {
    state: status?.state,
    stateLabel: status?.stateLabel,
    lastEventAt: status?.lastEventAt,
    idleMs: status?.idleMs,
    recentCommand: status?.recentCommand || null,
    lastFailure: status?.lastFailure || null,
    changedFiles: status?.changedFiles || [],
    risks: status?.risks || [],
    nextLikelyStep: status?.nextLikelyStep || null,
    routeSummary: buildRouteSummary(status, events),
    recentEvents: events.slice(-12).map((event) => ({
      ts: event.ts || null,
      kind: event.kind || event.event || null,
      summary: event.summary || null,
      command: event.command || null,
      files: event.files || [],
      plan: compactPlan(event.plan),
      status: event.status || null,
      outputSummary: event.outputSummary || null,
    })),
  };
}

export function buildRouteSummary(status, events = []) {
  const latestPlan = findLatestPlan(events);
  const observedSteps = summarizeObservedSteps(events);
  const activePlanItems = (latestPlan?.items || []).filter((item) => item.status === "in_progress");
  const pendingPlanItems = (latestPlan?.items || []).filter((item) => item.status === "pending");
  const completedPlanItems = (latestPlan?.items || []).filter((item) => item.status === "completed");
  const likelyNext = [
    ...activePlanItems.map((item) => `继续：${item.step}`),
    ...pendingPlanItems.slice(0, 3).map((item) => `待办：${item.step}`),
  ];

  if (status?.nextLikelyStep && !likelyNext.includes(status.nextLikelyStep)) {
    likelyNext.push(status.nextLikelyStep);
  }

  return {
    phase: status?.state || "unknown",
    phaseLabel: status?.stateLabel || null,
    explicitPlan: latestPlan
      ? {
          explanation: latestPlan.explanation || null,
          completed: completedPlanItems.map((item) => item.step),
          inProgress: activePlanItems.map((item) => item.step),
          pending: pendingPlanItems.map((item) => item.step),
          items: latestPlan.items,
        }
      : null,
    observedSteps,
    likelyNext: likelyNext.slice(0, 5),
    confidence: latestPlan ? "high" : observedSteps.length >= 3 ? "medium" : "low",
    uncertainty: latestPlan
      ? "explicitPlan 来自可见计划更新事件；likelyNext 仍是基于当前状态的推测。"
      : "没有可见计划更新，路线摘要主要由命令、编辑和测试事件推断。",
  };
}

export async function readSseContent(stream, write) {
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of streamChunks(stream)) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    if (parseSseLines(lines, write)) return;
  }

  buffer += decoder.decode();
  if (buffer) parseSseLines(buffer.split(/\r?\n/), write);
}

async function* streamChunks(stream) {
  if (typeof stream.getReader === "function") {
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) yield value;
      }
    } finally {
      reader.releaseLock();
    }
    return;
  }

  for await (const chunk of stream) {
    yield typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
  }
}

function parseSseLines(lines, write) {
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data) continue;
    if (data === "[DONE]") return true;

    try {
      const parsed = JSON.parse(data);
      const delta = parsed.choices?.[0]?.delta;
      const content = delta?.content || parsed.choices?.[0]?.message?.content || "";
      if (content) write(content);
    } catch {
      // Ignore malformed keepalive chunks and continue reading the stream.
    }
  }
  return false;
}

function findLatestPlan(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const plan = compactPlan(events[index]?.plan);
    if (plan?.items?.length) return plan;
  }
  return null;
}

function compactPlan(plan) {
  if (!plan || !Array.isArray(plan.items)) return null;
  return {
    explanation: plan.explanation || null,
    items: plan.items
      .map((item) => ({
        step: String(item.step || "").trim(),
        status: String(item.status || "pending").trim(),
      }))
      .filter((item) => item.step),
  };
}

function summarizeObservedSteps(events) {
  const steps = [];
  for (const event of events) {
    const label = observedStepLabel(event);
    if (!label) continue;
    if (steps.at(-1)?.label === label) continue;
    steps.push({
      ts: event.ts || null,
      label,
      kind: event.kind || event.event || null,
      status: event.status || null,
    });
  }
  return steps.slice(-10);
}

function observedStepLabel(event) {
  if (!event) return null;
  if (event.kind === "user_prompt") return "收到用户任务";
  if (event.kind === "plan_update") {
    const active = event.plan?.items?.find((item) => item.status === "in_progress");
    return active ? `计划更新：正在${active.step}` : event.summary || "计划更新";
  }
  if (event.kind === "permission_request") return event.summary || "请求权限";
  if (event.kind === "stop") return "当前 turn 结束";
  if (event.command) return commandStepLabel(event.command, event.status);
  if (event.files?.length && /apply_patch|edit|write/i.test(event.toolName || "")) {
    return `修改文件：${event.files.slice(0, 3).join(", ")}`;
  }
  if (event.toolName && /apply_patch|edit|write/i.test(event.toolName)) return "修改文件";
  return null;
}

function commandStepLabel(command, status) {
  const prefix = status === "failed" ? "命令失败" : status === "succeeded" ? "命令完成" : "运行命令";
  if (/\b(rg|grep|find)\b/i.test(command)) return `${prefix}：搜索上下文`;
  if (/\b(ls|sed|cat|head|tail|wc)\b/i.test(command)) return `${prefix}：读取文件或目录`;
  if (/\b(test|spec|jest|vitest|pytest|cargo test|go test|xcodebuild|swift test|npm run test|pnpm test|yarn test)\b/i.test(command)) {
    return `${prefix}：运行验证`;
  }
  if (/\b(build|tsc)\b/i.test(command)) return `${prefix}：构建或类型检查`;
  if (/git\s+(status|diff|show|log)/i.test(command)) return `${prefix}：检查 Git 状态`;
  return `${prefix}：${command}`;
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((message) => ["user", "assistant"].includes(message?.role))
    .map((message) => ({
      role: message.role,
      content: String(message.content || "").slice(0, 4000),
    }))
    .filter((message) => message.content.trim())
    .slice(-8);
}

async function safeResponseText(response) {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "";
  }
}
