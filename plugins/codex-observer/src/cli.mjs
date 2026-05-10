import http from "node:http";
import { buildObserverAgentBrief } from "./agent-brief.mjs";
import { readPackageVersion } from "./config.mjs";
import { appendEvent, listSessions, readSessionEvents } from "./event-store.mjs";
import { normalizeHookEvent } from "./normalize.mjs";
import { answerQuestion } from "./ask.mjs";
import { streamDeepSeekChat } from "./chat.mjs";
import { formatStatus, formatTimeline } from "./format.mjs";
import { buildStatus } from "./status.mjs";
import { publicSettings, readSettings, saveProviderSettings } from "./settings.mjs";

const dashboardServers = new Map();

export async function runCli(argv) {
  const { command, args, options } = parseArgs(argv);

  if (command === "version" || options.version) {
    console.log(await readPackageVersion());
    return;
  }

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

  if (command === "agent-brief") {
    const brief = buildObserverAgentBrief({
      home: options.home,
      sessionId: options.sessionId,
      dashboardUrl: options.dashboardUrl,
    });
    if (options.json) console.log(JSON.stringify({ brief }, null, 2));
    else console.log(brief);
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
    else if (value === "--version" || value === "-v") options.version = true;
    else if (value === "--home") options.home = argv[++index];
    else if (value === "--session") options.sessionId = argv[++index];
    else if (value === "--limit") options.limit = argv[++index];
    else if (value === "--port") options.port = Number(argv[++index]);
    else if (value === "--event") options.event = argv[++index];
    else if (value === "--dashboard-url") options.dashboardUrl = argv[++index];
    else if (!command) command = value;
    else args.push(value);
  }

  return { command, args, options };
}

export async function startDashboardServer(options = {}) {
  const port = options.port || 8765;
  const key = `${options.home || ""}:${port}`;
  const active = dashboardServers.get(key);
  if (active?.server?.listening) return active;

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
      if (url.pathname === "/api/settings" && request.method === "GET") {
        return json(response, publicSettings(await readSettings(options)));
      }
      if (url.pathname === "/api/settings" && request.method === "POST") {
        const body = await readRequestJson(request);
        return json(response, await saveProviderSettings(body, options));
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
      if (url.pathname === "/api/chat" && request.method === "POST") {
        return await chat(response, await readRequestJson(request), options);
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(dashboardHtml());
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: error.message }));
    }
  });

  await listen(server, port);
  const dashboard = { server, port, url: `http://127.0.0.1:${port}/` };
  dashboardServers.set(key, dashboard);
  return dashboard;
}

async function serve(options) {
  const dashboard = await startDashboardServer(options);
  console.log(`Codex Observer listening at ${dashboard.url}`);
}

async function chat(response, body, options) {
  const { events } = await readSessionEvents(options);
  const status = buildStatus(events);
  const settings = await readSettings(options);
  const providerId = settings.activeProvider;
  const provider = settings.providers[providerId];

  if (providerId !== "deepseek") {
    return jsonError(response, 501, {
      error: "Only DeepSeek chat is implemented right now.",
      provider: providerId,
    });
  }
  if (!provider?.apiKey) {
    return jsonError(response, 409, {
      error: "DeepSeek API key is not configured.",
      provider: providerId,
    });
  }

  try {
    response.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    await streamDeepSeekChat({
      apiKey: provider.apiKey,
      question: body.question,
      history: body.history,
      status,
      events,
      write: (chunk) => response.write(chunk),
    });
    response.end();
  } catch (error) {
    if (!response.headersSent) {
      return jsonError(response, 502, { error: error.message });
    }
    response.write(`\n\n请求失败：${error.message}`);
    response.end();
  }
}

async function listen(server, port) {
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    if (error?.code === "EADDRINUSE") {
      throw new Error(`Port ${port} is already in use. Try: codex-observer serve --port ${port + 1}`);
    }
    if (error?.code === "EACCES" || error?.code === "EPERM") {
      throw new Error(`Cannot listen on 127.0.0.1:${port}: ${error.message}`);
    }
    throw error;
  }
}

function json(response, value) {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value, null, 2));
}

function jsonError(response, statusCode, value) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
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
    :root { color-scheme: light dark; --accent: #111111; --button-text: #ffffff; --line: color-mix(in srgb, CanvasText 12%, transparent); --muted: color-mix(in srgb, CanvasText 58%, transparent); --soft: color-mix(in srgb, CanvasText 5%, transparent); --bubble: color-mix(in srgb, CanvasText 7%, transparent); --composer-bg: color-mix(in srgb, CanvasText 5%, transparent); }
    @media (prefers-color-scheme: dark) { :root { --accent: #f4f4f5; --button-text: #111111; --bubble: color-mix(in srgb, CanvasText 12%, transparent); --composer-bg: #1f1f1f; } }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: Canvas; color: CanvasText; }
    button, input, select, textarea { font: inherit; }
    button { border: 1px solid var(--accent); border-radius: 999px; background: var(--accent); color: var(--button-text); cursor: pointer; min-height: 42px; padding: 0 16px; }
    button.secondary { background: Canvas; border-color: transparent; color: CanvasText; }
    button.secondary:hover { background: var(--soft); border-color: var(--line); }
    button:disabled { cursor: wait; opacity: .65; }
    input, select { background: Canvas; border: 1px solid var(--line); border-radius: 12px; color: CanvasText; min-width: 0; padding: 12px 14px; width: 100%; }
    textarea { background: transparent; border: 0; color: CanvasText; line-height: 1.45; max-height: 180px; min-width: 0; outline: 0; padding: 13px 0 13px 16px; resize: none; width: 100%; }
    h1 { font-size: 18px; line-height: 1.2; margin: 0; letter-spacing: 0; }
    .app { min-height: 100%; }
    .chat-view { min-height: 100vh; display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; }
    .chat-header { align-items: center; background: Canvas; display: flex; justify-content: space-between; gap: 14px; padding: 12px 18px; position: sticky; top: 0; z-index: 2; }
    .header-actions { align-items: center; display: flex; gap: 10px; min-width: 0; }
    .mode-pill { color: var(--muted); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .api-key-button { min-height: 34px; padding: 0 12px; }
    .dialog-backdrop { background: color-mix(in srgb, #000 48%, transparent); display: grid; inset: 0; padding: 18px; place-items: center; position: fixed; z-index: 10; }
    .dialog-backdrop[hidden] { display: none; }
    .settings-panel { background: Canvas; border: 1px solid var(--line); border-radius: 18px; box-shadow: 0 18px 60px color-mix(in srgb, #000 34%, transparent); display: grid; gap: 16px; padding: 18px; width: min(100%, 460px); }
    .settings-head { align-items: center; display: flex; justify-content: space-between; gap: 12px; }
    .settings-form { display: grid; gap: 13px; }
    .field { display: grid; gap: 7px; }
    .label { color: var(--muted); font-size: 12px; }
    .settings-actions { display: grid; grid-template-columns: 1fr auto; gap: 10px; }
    .feedback { color: var(--muted); font-size: 13px; min-height: 20px; }
    .feedback.error { color: #b91c1c; }
    .activity { color: var(--muted); display: grid; font-size: 12px; gap: 4px; margin: 0 auto; padding: 0 18px 8px; width: min(100%, 820px); }
    .status-line { display: flex; gap: 8px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .state { color: CanvasText; font-weight: 600; }
    .event-stream { display: block; list-style: none; margin: 0; overflow: hidden; padding: 0; text-overflow: ellipsis; white-space: nowrap; }
    .event-stream li { display: none; }
    .event-stream li:first-child { display: block; overflow: hidden; text-overflow: ellipsis; }
    .messages { align-content: start; display: grid; gap: 22px; margin: 0 auto; overflow-y: auto; padding: 32px 18px 28px; width: min(100%, 820px); }
    .message { line-height: 1.62; max-width: min(720px, 86%); overflow-wrap: anywhere; white-space: pre-wrap; }
    .message.assistant { justify-self: start; padding: 0 2px; }
    .message.user { background: var(--bubble); border-radius: 22px; justify-self: end; padding: 10px 16px; }
    .composer-wrap { background: Canvas; padding: 12px 18px 18px; position: sticky; bottom: 0; }
    .composer { align-items: end; background: var(--composer-bg); border: 1px solid var(--line); border-radius: 28px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; margin: 0 auto; max-width: 820px; overflow: hidden; padding: 0 8px 0 0; width: min(100%, 820px); }
    .send-button { align-items: center; aspect-ratio: 1; border-radius: 999px; display: inline-grid; font-size: 18px; height: 34px; justify-items: center; margin: 6px 0; min-height: 34px; padding: 0; width: 34px; }
    @media (max-width: 760px) {
      .chat-header { padding: 12px 14px; }
      .status-line { align-items: stretch; display: grid; }
      .mode-pill { max-width: 150px; }
      .message { max-width: 100%; }
      .composer { grid-template-columns: minmax(0, 1fr) auto; }
      .settings-actions { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main class="app">
    <section class="chat-view" id="chat-view">
      <header class="chat-header">
        <h1>Codex Observer</h1>
        <div class="header-actions">
          <span class="mode-pill" id="mode-pill">Local observer</span>
          <button type="button" class="secondary api-key-button" id="open-settings">API key</button>
        </div>
      </header>
      <section class="activity" aria-label="Activity stream">
        <div class="status-line">
          <span><span class="state" id="state">Loading</span> <span id="last-update"></span></span>
          <span id="risk-line">暂未发现风险</span>
        </div>
        <ol class="event-stream" id="event-stream"></ol>
      </section>
      <section class="messages" id="messages" aria-live="polite">
        <article class="message assistant">我在这里看着当前 Codex timeline。你可以直接问我现在在做什么、有没有卡住、刚才为什么运行某个命令。</article>
      </section>
      <form id="ask-form" class="composer-wrap">
        <div class="composer">
          <textarea id="question" rows="1" placeholder="问 Codex Observer"></textarea>
          <button id="send-question" class="send-button" aria-label="发送">↑</button>
        </div>
      </form>
    </section>
    <section class="dialog-backdrop" id="settings-dialog" hidden>
      <form class="settings-panel" id="settings-form">
        <div class="settings-head">
          <h1>API key</h1>
          <button type="button" class="secondary api-key-button" id="close-settings">关闭</button>
        </div>
        <label class="field">
          <span class="label">Provider</span>
          <select id="provider" aria-label="Provider"></select>
        </label>
        <label class="field">
          <span class="label">API key</span>
          <input id="api-key" type="password" autocomplete="off" spellcheck="false" placeholder="API key" />
        </label>
        <div class="settings-actions">
          <button type="submit" id="save-key">保存</button>
          <button type="button" class="secondary" id="clear-key">清除</button>
        </div>
        <div class="feedback" id="settings-feedback" aria-live="polite"></div>
      </form>
    </section>
  </main>
  <script>
    let settings = null;
    let busy = false;
    const chatHistory = [];

    async function refresh() {
      const [status, timeline] = await Promise.all([
        fetch('/api/status').then(r => r.json()),
        fetch('/api/timeline?limit=12').then(r => r.json())
      ]);
      document.querySelector('#state').textContent = status.stateLabel || '空闲';
      document.querySelector('#last-update').textContent = status.lastEventAt ? '· ' + status.lastEventAt : '· no events';
      document.querySelector('#risk-line').textContent = status.risks?.length ? status.risks.join(' ') : '暂未发现风险';
      renderEvents(timeline);
    }
    async function loadSettings() {
      settings = await fetch('/api/settings').then(r => r.json());
      const provider = document.querySelector('#provider');
      provider.textContent = '';
      for (const entry of Object.entries(settings.providers)) {
        const option = document.createElement('option');
        option.value = entry[0];
        option.textContent = entry[1].label;
        provider.append(option);
      }
      provider.value = settings.activeProvider || 'openai';
      updateSettingsStatus();
    }
    function updateSettingsStatus() {
      if (!settings) return;
      const providerId = document.querySelector('#provider').value;
      const current = settings.providers[providerId];
      const source = current?.source === 'env' ? current.envName : current?.source === 'local' ? 'local' : 'none';
      const label = current?.configured ? current.label + ' · ' + source : 'Local observer';
      document.querySelector('#mode-pill').textContent = label;
      document.querySelector('#clear-key').hidden = !current?.configured;
      setSettingsFeedback(current?.configured ? '已配置 · ' + source : '未配置');
    }
    async function saveSettings(body) {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || '保存失败');
      }
      settings = await response.json();
      document.querySelector('#api-key').value = '';
      updateSettingsStatus();
    }
    function setSettingsFeedback(text, kind = '') {
      const feedback = document.querySelector('#settings-feedback');
      feedback.textContent = text;
      feedback.className = 'feedback' + (kind ? ' ' + kind : '');
    }
    function openSettings() {
      document.querySelector('#settings-dialog').hidden = false;
      setSettingsFeedback('');
      updateSettingsStatus();
      document.querySelector('#api-key').focus();
    }
    function closeSettings() {
      document.querySelector('#settings-dialog').hidden = true;
    }
    function renderEvents(events) {
      const stream = document.querySelector('#event-stream');
      stream.textContent = '';
      if (!events.length) {
        const item = document.createElement('li');
        item.textContent = 'No observer events recorded yet.';
        stream.append(item);
        return;
      }
      for (const event of events.slice(-8).reverse()) {
        const item = document.createElement('li');
        item.textContent = (event.summary || event.event || 'event') + (event.command ? ' · ' + event.command : '');
        stream.append(item);
      }
    }
    function addMessage(role, text) {
      const message = document.createElement('article');
      message.className = 'message ' + role;
      message.textContent = text || '';
      document.querySelector('#messages').append(message);
      message.scrollIntoView({ block: 'end' });
      return message;
    }
    async function streamText(target, text) {
      target.textContent = '';
      for (let index = 0; index < text.length; index += 8) {
        target.textContent += text.slice(index, index + 8);
        target.scrollIntoView({ block: 'end' });
        await new Promise(resolve => setTimeout(resolve, 8));
      }
    }
    async function askLocalObserver(question) {
      const result = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question })
      }).then(r => r.json());
      return result.answer || '';
    }
    async function streamModelObserver(question, target) {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question, history: chatHistory.slice(-8) })
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        if (response.status === 409 || response.status === 501) {
          const local = await askLocalObserver(question);
          await streamText(target, local);
          return local;
        }
        throw new Error(error.error || '模型请求失败');
      }
      if (!response.body) {
        const text = await response.text();
        target.textContent = text;
        return text;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let text = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        text += chunk;
        target.textContent += chunk;
        target.scrollIntoView({ block: 'end' });
      }
      const rest = decoder.decode();
      if (rest) {
        text += rest;
        target.textContent += rest;
      }
      return text;
    }
    document.querySelector('#open-settings').addEventListener('click', openSettings);
    document.querySelector('#close-settings').addEventListener('click', closeSettings);
    document.querySelector('#settings-dialog').addEventListener('click', (event) => {
      if (event.target.id === 'settings-dialog') closeSettings();
    });
    document.querySelector('#provider').addEventListener('change', updateSettingsStatus);
    document.querySelector('#settings-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const providerId = document.querySelector('#provider').value;
      const apiKey = document.querySelector('#api-key').value.trim();
      if (!apiKey && !settings?.providers?.[providerId]?.configured) {
        setSettingsFeedback('请输入 API key。', 'error');
        document.querySelector('#api-key').focus();
        return;
      }
      const button = document.querySelector('#save-key');
      button.disabled = true;
      button.textContent = '保存中';
      setSettingsFeedback('正在保存到本地配置...');
      try {
        await saveSettings({ provider: providerId, apiKey });
        setSettingsFeedback('已保存。');
      } catch (error) {
        setSettingsFeedback(error?.message || String(error), 'error');
      } finally {
        button.disabled = false;
        button.textContent = '保存';
      }
    });
    document.querySelector('#clear-key').addEventListener('click', async () => {
      const button = document.querySelector('#clear-key');
      button.disabled = true;
      setSettingsFeedback('正在清除本地 key...');
      try {
        await saveSettings({
          provider: document.querySelector('#provider').value,
          clearKey: true
        });
        setSettingsFeedback('已清除。');
      } catch (error) {
        setSettingsFeedback(error?.message || String(error), 'error');
      } finally {
        button.disabled = false;
      }
    });
    document.querySelector('#ask-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy) return;
      const input = document.querySelector('#question');
      const question = input.value.trim();
      if (!question) return;
      busy = true;
      document.querySelector('#send-question').disabled = true;
      input.value = '';
      addMessage('user', question);
      const assistant = addMessage('assistant', '');
      try {
        const answer = await streamModelObserver(question, assistant);
        chatHistory.push({ role: 'user', content: question }, { role: 'assistant', content: answer });
      } catch (error) {
        assistant.textContent = '请求失败：' + (error?.message || String(error));
      } finally {
        busy = false;
        document.querySelector('#send-question').disabled = false;
        input.focus();
      }
    });
    document.querySelector('#question').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        document.querySelector('#ask-form').requestSubmit();
      }
    });
    loadSettings();
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
  codex-observer agent-brief           Print a prompt for a read-only Observer sub-agent
  codex-observer timeline              Print recent events
  codex-observer sessions              List known sessions
  codex-observer serve --port 8765      Start local read-only dashboard
  codex-observer version               Print CLI version

Options:
  --home <dir>       Override observer store (default: ~/.codex-observer)
  --session <id>     Query a specific session
  --json             Print JSON
  --quiet            Suppress capture output for hook usage
  --limit <n>        Timeline event limit
  --dashboard-url <url>
                     Include a dashboard URL in agent-brief output
  --version, -v      Print CLI version
`);
}
