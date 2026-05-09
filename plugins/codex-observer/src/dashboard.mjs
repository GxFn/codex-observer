import { spawn } from "node:child_process";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

export const DEFAULT_DASHBOARD_PORT = 8765;

export function resolveDashboardPort(explicitPort) {
  const port = Number(explicitPort || process.env.CODEX_OBSERVER_DASHBOARD_PORT || DEFAULT_DASHBOARD_PORT);
  return Number.isFinite(port) && port > 0 ? port : DEFAULT_DASHBOARD_PORT;
}

export function dashboardUrl(port = DEFAULT_DASHBOARD_PORT) {
  return `http://127.0.0.1:${port}/`;
}

export async function isDashboardReady(port = DEFAULT_DASHBOARD_PORT, timeoutMs = 300) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${dashboardUrl(port)}api/status`, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function isPortListening(port = DEFAULT_DASHBOARD_PORT, timeoutMs = 250) {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const done = (listening) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

export async function ensureDashboardProcess(options = {}) {
  const port = resolveDashboardPort(options.port);
  const url = dashboardUrl(port);

  if (await isDashboardReady(port)) return { port, url, ready: true, started: false };

  if (await isPortListening(port)) {
    return {
      port,
      url,
      ready: false,
      started: false,
      message: `Port ${port} is already in use by another service.`,
    };
  }

  const cliPath = fileURLToPath(new URL("../bin/codex-observer.mjs", import.meta.url));
  const args = [cliPath, "serve", "--port", String(port)];
  if (options.home) args.push("--home", options.home);

  const child = spawn(process.execPath, args, {
    detached: true,
    env: { ...process.env },
    stdio: "ignore",
  });
  child.unref();

  const deadline = Date.now() + Number(options.waitUntilReadyMs || 1500);
  while (Date.now() < deadline) {
    if (await isDashboardReady(port, 200)) return { port, url, ready: true, started: true };
    await delay(100);
  }

  return { port, url, ready: false, started: true };
}
