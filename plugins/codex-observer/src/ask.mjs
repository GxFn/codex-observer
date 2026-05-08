import { formatDuration } from "./status.mjs";

export function answerQuestion(question, status, events) {
  const q = String(question || "").trim();
  const intent = detectIntent(q);

  if (events.length === 0) {
    return [
      "简短结论：目前还没有可见的 Observer 事件。",
      "依据：本地 timeline 为空，hooks 可能还没有启用，或者当前查询的 session 不对。",
      "可选动作：先让 Codex 执行一个带 hook 的 turn，或者用 `codex-observer sessions` 查看已有 session。",
    ].join("\n");
  }

  if (intent === "stuck") return stuckAnswer(status);
  if (intent === "why_command") return whyCommandAnswer(status);
  if (intent === "changed_files") return changedFilesAnswer(status);
  if (intent === "failures") return failuresAnswer(status);
  if (intent === "next") return nextAnswer(status);
  if (intent === "risk") return riskAnswer(status);
  return currentStatusAnswer(status);
}

export function currentStatusAnswer(status) {
  const lines = [
    `简短结论：它现在看起来处于「${status.stateLabel}」状态。`,
    `依据：最近的可见事件是 ${latestEvidence(status)}。`,
  ];
  if (status.recentCommand) lines.push(`最近命令：\`${status.recentCommand.command}\`。`);
  if (status.changedFiles.length > 0) lines.push(`已记录改动文件：${status.changedFiles.slice(0, 6).join(", ")}。`);
  if (status.risks.length > 0) lines.push(`风险提示：${status.risks.join(" ")}`);
  lines.push(`下一步推测：${status.nextLikelyStep}`);
  lines.push("不确定性：Observer 只能看到 hooks、命令输出和记录到 timeline 的事件，不能读取主模型隐藏思考。");
  return lines.join("\n");
}

function stuckAnswer(status) {
  if (status.state === "waiting_permission") {
    return [
      "简短结论：不像是卡死，更像是在等你处理权限请求。",
      `依据：当前状态是「${status.stateLabel}」，最近事件是 ${latestEvidence(status)}。`,
      "可选动作：检查 Codex 的权限弹窗或审批区，决定批准还是拒绝。",
    ].join("\n");
  }
  if (status.isPossiblyStuck || status.state === "blocked") {
    return [
      "简短结论：有卡住迹象，值得看一眼。",
      `依据：距离最近可见事件已经 ${formatDuration(status.idleMs)}，并且没有 stop 事件。`,
      status.risks.length ? `风险提示：${status.risks.join(" ")}` : null,
      "可选动作：先查看 terminal 输出；如果仍无进展，再考虑中断或给主 agent 新指令。",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    "简短结论：目前没有明显卡住迹象。",
    `依据：最近事件是 ${latestEvidence(status)}，当前状态是「${status.stateLabel}」。`,
    `下一步推测：${status.nextLikelyStep}`,
  ].join("\n");
}

function whyCommandAnswer(status) {
  if (!status.recentCommand) {
    return [
      "简短结论：timeline 里还没有记录到命令。",
      "依据：最近事件没有 command 字段，可能是在读写工具、计划更新或等待权限。",
    ].join("\n");
  }
  const command = status.recentCommand.command;
  let reason = "这看起来是在推进当前任务。";
  if (/\b(rg|grep|find|ls|sed|cat|head|tail|wc)\b/i.test(command)) {
    reason = "这类命令通常用于读取代码结构、搜索上下文或确认文件内容。";
  } else if (/\b(test|spec|jest|vitest|pytest|cargo test|go test|xcodebuild|swift test|build|tsc)\b/i.test(command)) {
    reason = "这类命令通常用于验证刚才的修改，或复现失败。";
  } else if (/git\s+(status|diff|show|log)/i.test(command)) {
    reason = "这类命令通常用于确认当前改动、查看差异或理解历史上下文。";
  }
  return [
    `简短结论：最近运行 \`${command}\`，${reason}`,
    `依据：timeline 记录的最近命令状态是 ${status.recentCommand.status || "unknown"}，事件摘要为「${status.recentCommand.summary}」。`,
    "不确定性：这是基于命令类型和邻近事件的解释，不是主 agent 的隐藏思考。",
  ].join("\n");
}

function changedFilesAnswer(status) {
  if (status.changedFiles.length === 0) {
    return [
      "简短结论：目前 timeline 没有记录到明确的文件改动。",
      "依据：最近事件没有 file/path 或 apply_patch 文件条目。",
      "可选动作：如果你想确认真实工作区 diff，可以在主界面查看 diff 面板。",
    ].join("\n");
  }
  return [
    `简短结论：Observer 已记录 ${status.changedFiles.length} 个改动文件。`,
    `文件：${status.changedFiles.join(", ")}`,
    `风险提示：${status.risks.length ? status.risks.join(" ") : "暂未看到异常范围提示。"}`,
  ].join("\n");
}

function failuresAnswer(status) {
  if (!status.lastFailure) {
    return [
      "简短结论：当前 session 没有记录到明确失败事件。",
      `依据：最近状态是「${status.stateLabel}」，最近事件是 ${latestEvidence(status)}。`,
    ].join("\n");
  }
  return [
    "简短结论：最近确实有失败记录。",
    `失败来源：${status.lastFailure.command ? `\`${status.lastFailure.command}\`` : status.lastFailure.toolName || "未知工具"}。`,
    status.lastFailure.outputSummary ? `输出摘要：${status.lastFailure.outputSummary}` : null,
    `下一步推测：${status.nextLikelyStep}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function nextAnswer(status) {
  return [
    `简短结论：下一步大概率是：${status.nextLikelyStep}`,
    `依据：当前状态「${status.stateLabel}」，最近事件是 ${latestEvidence(status)}。`,
    "不确定性：这只是基于可见事件的预测，不是进度承诺。",
  ].join("\n");
}

function riskAnswer(status) {
  if (status.risks.length === 0) {
    return [
      "简短结论：目前没有明显需要立刻介入的风险。",
      `依据：当前状态「${status.stateLabel}」，最近事件是 ${latestEvidence(status)}。`,
      "可选动作：继续观察；如果你看到权限请求或重复失败，再介入更划算。",
    ].join("\n");
  }
  return [
    "简短结论：有一些值得注意的风险。",
    `风险提示：${status.risks.join(" ")}`,
    "可选动作：先查看最近 terminal/diff；如果风险与你的目标冲突，再明确中断或发送新指令。",
  ].join("\n");
}

function detectIntent(question) {
  if (/卡|卡住|stuck|hang|blocked|没动|无输出/i.test(question)) return "stuck";
  if (/为什么|why|为啥|运行.*命令|跑.*命令|command/i.test(question)) return "why_command";
  if (/改了|哪些文件|changed|diff|文件/i.test(question)) return "changed_files";
  if (/失败|报错|测试|fail|error|test/i.test(question)) return "failures";
  if (/下一步|next|接下来/i.test(question)) return "next";
  if (/风险|权限|介入|中断|safe|permission|interrupt/i.test(question)) return "risk";
  return "status";
}

function latestEvidence(status) {
  const latest = status.evidence.at(-1);
  if (!latest) return "没有可见事件";
  return `${latest.ts || "未知时间"} 的「${latest.summary || "未知事件"}」`;
}
