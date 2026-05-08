import crypto from "node:crypto";
import path from "node:path";
import { nowIso } from "./config.mjs";

const TOOL_START_EVENTS = new Set(["PreToolUse", "pre_tool_use", "tool_start"]);
const TOOL_FINISH_EVENTS = new Set(["PostToolUse", "post_tool_use", "tool_finish"]);

export function normalizeHookEvent(input, options = {}) {
  const raw = coerceObject(input);
  const payload = coerceObject(raw.payload);
  const eventName =
    options.eventName ||
    raw.hook_event_name ||
    raw.eventName ||
    raw.event ||
    raw.type ||
    payload.hook_event_name ||
    payload.event ||
    payload.type ||
    "event";
  const toolName = firstString(
    raw.tool_name,
    raw.toolName,
    raw.name,
    raw.tool?.name,
    payload.tool_name,
    payload.toolName,
    payload.name,
    payload.tool?.name,
  );
  const toolInput = firstObjectOrValue(
    raw.tool_input,
    raw.toolInput,
    raw.input,
    raw.arguments,
    payload.tool_input,
    payload.toolInput,
    payload.input,
    payload.arguments,
  );
  const toolOutput = firstObjectOrValue(
    raw.tool_response,
    raw.toolResponse,
    raw.tool_output,
    raw.toolOutput,
    raw.output,
    raw.response,
    raw.result,
    payload.tool_response,
    payload.toolOutput,
    payload.output,
    payload.response,
    payload.result,
  );
  const cwd = firstString(raw.cwd, raw.workspace, payload.cwd, payload.workspace);
  const transcriptPath = firstString(
    raw.transcript_path,
    raw.transcriptPath,
    payload.transcript_path,
    payload.transcriptPath,
  );
  const sessionId =
    firstString(
      raw.session_id,
      raw.sessionId,
      raw.session?.id,
      payload.session_id,
      payload.sessionId,
      payload.session?.id,
    ) || sessionIdFromTranscript(transcriptPath) || "unknown-session";
  const command = extractCommand(toolName, toolInput);
  const files = extractFiles(toolName, toolInput, raw);
  const exitCode = extractExitCode(toolOutput, raw, payload);
  const status = inferEventStatus(eventName, exitCode, toolOutput, raw);
  const ts = firstString(raw.timestamp, raw.ts, payload.timestamp, payload.ts) || options.now || nowIso();
  const normalized = {
    id: stableId(ts, eventName, sessionId, toolName, command),
    ts,
    event: eventName,
    kind: normalizeKind(eventName),
    sessionId,
    turnId: firstString(raw.turn_id, raw.turnId, payload.turn_id, payload.turnId) || null,
    cwd: cwd || null,
    transcriptPath: transcriptPath || null,
    toolName: toolName || null,
    command: command || null,
    files,
    status,
    exitCode,
    inputSummary: summarizeValue(toolInput, 320),
    outputSummary: summarizeValue(toolOutput, 640),
    summary: "",
    raw,
  };

  normalized.summary = summarizeEvent(normalized);
  return normalized;
}

export function normalizeKind(eventName) {
  if (TOOL_START_EVENTS.has(eventName)) return "tool_start";
  if (TOOL_FINISH_EVENTS.has(eventName)) return "tool_finish";
  if (/permission/i.test(eventName)) return "permission_request";
  if (/prompt/i.test(eventName)) return "user_prompt";
  if (/session.*start/i.test(eventName)) return "session_start";
  if (/stop|complete|done/i.test(eventName)) return "stop";
  if (/plan/i.test(eventName)) return "plan_update";
  if (/error/i.test(eventName)) return "error";
  return "event";
}

export function summarizeEvent(event) {
  if (event.kind === "tool_start") {
    if (event.command) return `开始运行命令：${event.command}`;
    if (event.toolName) return `开始使用工具：${event.toolName}`;
  }
  if (event.kind === "tool_finish") {
    const result = event.status === "failed" ? "失败" : "完成";
    if (event.command) return `命令${result}：${event.command}`;
    if (event.toolName) return `工具${result}：${event.toolName}`;
  }
  if (event.kind === "permission_request") {
    return event.command ? `请求权限运行：${event.command}` : "请求用户权限";
  }
  if (event.kind === "user_prompt") return "收到用户任务";
  if (event.kind === "session_start") return "会话开始";
  if (event.kind === "stop") return "当前 turn 已结束";
  if (event.kind === "plan_update") return "更新执行计划";
  return `${event.event}${event.toolName ? `：${event.toolName}` : ""}`;
}

export function summarizeValue(value, maxLength = 240) {
  if (value == null || value === "") return null;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function extractCommand(toolName, toolInput) {
  const input = coerceObject(toolInput);
  const name = String(toolName || "").toLowerCase();
  if (typeof toolInput === "string" && isShellLikeTool(name)) return toolInput;
  return firstString(
    input.cmd,
    input.command,
    input.shell_command,
    input.script,
    input.args?.join?.(" "),
  );
}

function extractFiles(toolName, toolInput, raw) {
  const files = new Set();
  const inputText = typeof toolInput === "string" ? toolInput : JSON.stringify(toolInput || {});
  const name = String(toolName || "").toLowerCase();

  if (name.includes("apply_patch") || inputText.includes("*** Begin Patch")) {
    for (const match of inputText.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) {
      files.add(match[1].trim());
    }
  }

  const input = coerceObject(toolInput);
  for (const candidate of [
    input.file,
    input.path,
    input.filePath,
    input.target_file,
    raw.file,
    raw.path,
  ]) {
    if (typeof candidate === "string" && looksLikePath(candidate)) files.add(candidate);
  }

  return [...files];
}

function extractExitCode(toolOutput, raw, payload) {
  const output = coerceObject(toolOutput);
  for (const value of [
    raw.exit_code,
    raw.exitCode,
    raw.status_code,
    payload.exit_code,
    payload.exitCode,
    output.exit_code,
    output.exitCode,
    output.code,
  ]) {
    if (Number.isInteger(value)) return value;
    if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  }
  return null;
}

function inferEventStatus(eventName, exitCode, toolOutput, raw) {
  if (exitCode != null) return exitCode === 0 ? "succeeded" : "failed";
  const text = summarizeValue(toolOutput, 5000) || summarizeValue(raw, 5000) || "";
  if (/failed|error|exception|traceback|exit code [1-9]/i.test(text)) {
    return TOOL_FINISH_EVENTS.has(eventName) ? "failed" : "unknown";
  }
  if (TOOL_FINISH_EVENTS.has(eventName)) return "succeeded";
  return "unknown";
}

function sessionIdFromTranscript(transcriptPath) {
  if (!transcriptPath) return null;
  return path.basename(transcriptPath).replace(/\.jsonl$/, "");
}

function coerceObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function firstObjectOrValue(...values) {
  for (const value of values) {
    if (value != null && value !== "") return value;
  }
  return null;
}

function isShellLikeTool(name) {
  return name.includes("exec") || name.includes("shell") || name.includes("bash") || name.includes("command");
}

function looksLikePath(value) {
  return value.includes("/") || value.includes("\\") || /\.[a-zA-Z0-9]{1,8}$/.test(value);
}

function stableId(...parts) {
  return crypto.createHash("sha1").update(parts.filter(Boolean).join("\u0000")).digest("hex").slice(0, 16);
}
