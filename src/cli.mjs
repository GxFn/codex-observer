import http from "node:http";
import { appendEvent, listSessions, readSessionEvents } from "./event-store.mjs";
import { normalizeHookEvent } from "./normalize.mjs";
import { answerQuestion } from "./ask.mjs";
import { formatStatus, formatTimeline } from "./format.mjs";
import { buildStatus } from "./status.mjs";

export async function runCli(argv) {
  const { command, args, options } = parseArgs(argv);

  if (!command || command === "help" || options.help) {
    printHelp();
    return;
  }

  if (command === "capture") {
    const eventName = args[0] || options.event;
    const input = await readStdinJson();
    const normalized = normalizeHookEvent(input, { eventName });
    const result = await appendEvent(normalized, { home: options.home });
    if (options.json) {
      console.log(JSON.stringify({ recorded: normalized, ...result }, null, 2));
    } else if (!options.quiet) {
      console.log(`Recorded ${normalized.summary} (${result.sessionId})`);
    }
    return;
  }

  if (command === "status") {
    const { events, sessionId } = await readSessionEvents(options);
    const status = buildStatus(events);
    if (options.json) console.log(JSON.stringify(status, null, 2));
    else if (!sessionId) console.log("No observer session found yet.");
    else console.log(formatStatus(status));
    return;
  }

  if (command === "ask") {
    const question = args.join(" ").trim() || (await readStdinText()).trim();
    if (!question) throw new Error("Missing question. Try: codex-observer ask \"现在在干嘛？\"");
    const { events } = await readSessionEvents(options);
    const status = buildStatus(events);
    const answer = answerQuestion(question, status, events);
    if (options.json) console.log(JSON.stringify({ question, answer, status }, null, 2));
    else console.log(answer);
    return;
  }

  if (command === "timeline") {
    const { events } = await readSessionEvents(options);
    if (options.json) console.log(JSON.stringify(events.slice(-Number(options.limit || 20)), null, 2));
    else console.log(formatTimeline(events, Number(options.limit || 20)));
    return;
  }

  if (command === "sessions") {
    const { sessions } = await listSessions(options);
    if (options.json) console.log(JSON.stringify(sessions, null, 2));
    else if (sessions.length === 0) console.log("No observer sessions found yet.");
    else console.log(sessions.map((session) => `${session.updatedAt} ${session.sessionId}`).join("\n"));
    return;
  }

  if (command === "serve") {
    await serve(options);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

export function parseArgs(argv) {
  const args = [];
  const options = {};
  let command = null;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--json") options.json = true;
    else if (value === "--quiet") options.quiet = true;
    else if (value === "--help" || value === "-h") options.help = true;
    else if (value === "--home") options.home = argv[++index];
    else if (value === "--session") options.sessionId = argv[++index];
    else if (value === "--limit") options.limit = argv[++index];
    else if (value === "--port") options.port = Number(argv[++index]);
    else if (value === "--event") options.event = argv[++index];
    else if (!command) command = value;
    else args.push(value);
  }

  return { command, args, options };
}

async function serve(options) {
  const port = options.port || 8765;
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
      if (url.pathname === "/api/status") {
        const { events } = await readSessionEvents(options);
        return json(response, buildStatus(events));
      }
      if (url.pathname === "/api/timeline") {
        const { events } = await readSessionEvents(options);
        return json(response, events.slice(-Number(url.searchParams.get("limit") || 50)));
      }
      if (url.pathname === "/api/ask" && request.method === "POST") {
        const body = await readRequestJson(request);
        const { events } = await readSessionEvents(options);
        const status = buildStatus(events);
        return json(response, {
          answer: answerQuestion(body.question, status, events),
          status,
        });
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(dashboardHtml());
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: error.message }));
    }
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  console.log(`Codex Observer listening at http://127.0.0.1:${port}`);
}

function json(response, value) {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value, null, 2));
}

function dashboardHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Codex Observer</title>
  <style>
    :root { color-scheme: light dark; --accent: #1d4ed8; --ok: #047857; --warn: #b45309; --line: color-mix(in srgb, CanvasText 16%, transparent); }
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: Canvas; color: CanvasText; }
    main { max-width: 1080px; margin: 0 auto; padding: 28px; display: grid; gap: 18px; }
    header { display: flex; justify-content: space-between; gap: 16px; align-items: baseline; border-bottom: 1px solid var(--line); padding-bottom: 14px; }
    h1 { font-size: 24px; margin: 0; letter-spacing: 0; }
    .state { font-size: 14px; color: var(--accent); font-weight: 700; }
    section { display: grid; gap: 10px; }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .panel { border: 1px solid var(--line); border-radius: 8px; padding: 14px; min-width: 0; }
    .label { font-size: 12px; opacity: .68; margin-bottom: 6px; }
    .value { font-size: 15px; overflow-wrap: anywhere; }
    form { display: grid; grid-template-columns: 1fr auto; gap: 10px; }
    input, button { font: inherit; border-radius: 7px; border: 1px solid var(--line); padding: 10px 12px; background: Canvas; color: CanvasText; }
    button { background: var(--accent); color: white; border-color: var(--accent); cursor: pointer; }
    pre { white-space: pre-wrap; margin: 0; font: 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; line-height: 1.5; }
    ol { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
    li { border-top: 1px solid var(--line); padding-top: 8px; font-size: 13px; }
    @media (max-width: 760px) { main { padding: 18px; } .grid { grid-template-columns: 1fr; } form { grid-template-columns: 1fr; } header { display: grid; } }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Codex Observer</h1>
      <div class="state" id="state">Loading</div>
    </header>
    <div class="grid">
      <div class="panel"><div class="label">最近命令</div><div class="value" id="command">-</div></div>
      <div class="panel"><div class="label">改动文件</div><div class="value" id="files">-</div></div>
      <div class="panel"><div class="label">风险</div><div class="value" id="risks">-</div></div>
    </div>
    <section class="panel">
      <form id="ask-form">
        <input id="question" placeholder="问：现在在干嘛？是不是卡住了？" />
        <button>询问</button>
      </form>
      <pre id="answer"></pre>
    </section>
    <section class="panel">
      <div class="label">Timeline</div>
      <ol id="timeline"></ol>
    </section>
  </main>
  <script>
    async function refresh() {
      const [status, timeline] = await Promise.all([
        fetch('/api/status').then(r => r.json()),
        fetch('/api/timeline?limit=20').then(r => r.json())
      ]);
      document.querySelector('#state').textContent = status.stateLabel + ' · ' + (status.lastEventAt || 'no events');
      document.querySelector('#command').textContent = status.recentCommand?.command || '-';
      document.querySelector('#files').textContent = status.changedFiles?.length ? status.changedFiles.join(', ') : '-';
      document.querySelector('#risks').textContent = status.risks?.length ? status.risks.join(' ') : '暂未发现';
      document.querySelector('#timeline').innerHTML = timeline.map(event => '<li><strong>' + (event.ts || '') + '</strong><br>' + (event.summary || event.event || '') + '</li>').join('');
    }
    document.querySelector('#ask-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const question = document.querySelector('#question').value;
      const result = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question }) }).then(r => r.json());
      document.querySelector('#answer').textContent = result.answer;
    });
    refresh();
    setInterval(refresh, 2500);
  </script>
</body>
</html>`;
}

async function readStdinJson() {
  const text = await readStdinText();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    return { raw_stdin: text, parse_error: error.message };
  }
}

async function readStdinText() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function readRequestJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function printHelp() {
  console.log(`Codex Observer

Usage:
  codex-observer capture [EventName]   Record one hook event from stdin JSON
  codex-observer status                Print current observer status
  codex-observer ask "现在在干嘛？"       Answer from visible evidence
  codex-observer timeline              Print recent events
  codex-observer sessions              List known sessions
  codex-observer serve --port 8765      Start local read-only dashboard

Options:
  --home <dir>       Override observer store (default: ~/.codex-observer)
  --session <id>     Query a specific session
  --json             Print JSON
  --quiet            Suppress capture output for hook usage
  --limit <n>        Timeline event limit
`);
}
