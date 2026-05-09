#!/usr/bin/env node
import readline from "node:readline";
import { answerQuestion } from "../src/ask.mjs";
import { readPackageVersion } from "../src/config.mjs";
import { readSessionEvents } from "../src/event-store.mjs";
import { formatStatus, formatTimeline } from "../src/format.mjs";
import { buildStatus } from "../src/status.mjs";
import { startDashboardServer } from "../src/cli.mjs";

const tools = [
  {
    name: "codex_observer_status",
    description: "Return the current read-only Codex Observer status summary.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Optional session id to inspect." },
        home: { type: "string", description: "Optional observer store directory." },
      },
    },
  },
  {
    name: "codex_observer_ask",
    description: "Answer a status question from visible Codex Observer events.",
    inputSchema: {
      type: "object",
      required: ["question"],
      properties: {
        question: { type: "string" },
        sessionId: { type: "string" },
        home: { type: "string" },
      },
    },
  },
  {
    name: "codex_observer_timeline",
    description: "Return recent Codex Observer timeline events.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", default: 20 },
        sessionId: { type: "string" },
        home: { type: "string" },
      },
    },
  },
  {
    name: "codex_observer_dashboard",
    description: "Start the local Codex Observer chat dashboard and return its localhost URL.",
    inputSchema: {
      type: "object",
      properties: {
        port: { type: "number", default: 8765 },
        home: { type: "string", description: "Optional observer store directory." },
      },
    },
  },
];

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

rl.on("line", async (line) => {
  if (!line.trim()) return;
  let request;
  try {
    request = JSON.parse(line);
    const result = await handleRequest(request);
    if (result) process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request?.id ?? null,
        error: { code: -32000, message: error.message },
      })}\n`,
    );
  }
});

async function handleRequest(request) {
  if (request.method === "notifications/initialized") return null;
  if (request.method === "initialize") {
    const version = await readPackageVersion();
    return response(request.id, {
      protocolVersion: request.params?.protocolVersion || "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "codex-observer", version },
    });
  }
  if (request.method === "tools/list") {
    return response(request.id, { tools });
  }
  if (request.method === "tools/call") {
    const name = request.params?.name;
    const args = request.params?.arguments || {};
    return response(request.id, await callTool(name, args));
  }
  return response(request.id, {});
}

async function callTool(name, args) {
  if (name === "codex_observer_dashboard") {
    const dashboard = await startDashboardServer({ home: args.home, port: Number(args.port || 8765) });
    return textContent(
      [
        `Codex Observer dashboard is running at ${dashboard.url}`,
        "Open that URL in the Codex in-app browser/right panel to use the streaming Observer chat.",
      ].join("\n"),
    );
  }

  const { events } = await readSessionEvents({ home: args.home, sessionId: args.sessionId });
  const status = buildStatus(events);
  if (name === "codex_observer_status") {
    return textContent(formatStatus(status));
  }
  if (name === "codex_observer_ask") {
    return textContent(answerQuestion(args.question, status, events));
  }
  if (name === "codex_observer_timeline") {
    return textContent(formatTimeline(events, Number(args.limit || 20)));
  }
  return {
    isError: true,
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
  };
}

function response(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function textContent(text) {
  return { content: [{ type: "text", text }] };
}
