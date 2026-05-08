import { formatDuration } from "./status.mjs";

export function formatStatus(status) {
  const lines = [
    `Session: ${status.sessionId || "none"}`,
    `State: ${status.stateLabel} (${status.state})`,
    `Events: ${status.eventCount}`,
    `Last event: ${status.lastEventAt || "none"}`,
  ];
  if (status.idleMs != null) lines.push(`No visible update for: ${formatDuration(status.idleMs)}`);
  if (status.recentCommand) lines.push(`Recent command: ${status.recentCommand.command}`);
  if (status.lastFailure) {
    lines.push(
      `Last failure: ${status.lastFailure.command || status.lastFailure.toolName || "unknown"}`,
    );
  }
  if (status.changedFiles.length > 0) lines.push(`Changed files: ${status.changedFiles.join(", ")}`);
  if (status.risks.length > 0) lines.push(`Risks: ${status.risks.join(" ")}`);
  lines.push(`Next: ${status.nextLikelyStep}`);
  return lines.join("\n");
}

export function formatTimeline(events, limit = 20) {
  const visible = events.slice(-limit);
  if (visible.length === 0) return "No observer events recorded yet.";
  return visible
    .map((event) => {
      const status = event.status && event.status !== "unknown" ? ` [${event.status}]` : "";
      const command = event.command ? `\n    $ ${event.command}` : "";
      const files = event.files?.length ? `\n    files: ${event.files.join(", ")}` : "";
      return `${event.ts || "unknown"} ${event.kind || event.event}${status} - ${event.summary || ""}${command}${files}`;
    })
    .join("\n");
}
