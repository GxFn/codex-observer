import os from "node:os";
import path from "node:path";

export const DEFAULT_STUCK_AFTER_MS = 3 * 60 * 1000;

export function resolveObserverHome(explicitHome) {
  return path.resolve(
    explicitHome ||
      process.env.CODEX_OBSERVER_HOME ||
      path.join(os.homedir(), ".codex-observer"),
  );
}

export function sessionFilePath(home, sessionId) {
  return path.join(home, "sessions", `${safeFileName(sessionId)}.jsonl`);
}

export function latestSessionPath(home) {
  return path.join(home, "latest-session");
}

export function safeFileName(value) {
  return String(value || "unknown")
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160) || "unknown";
}

export function nowIso() {
  return new Date().toISOString();
}
