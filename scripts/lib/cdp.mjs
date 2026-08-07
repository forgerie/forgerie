// Shared Chrome DevTools Protocol client and Chromium discovery/launch helpers.
// Used by the marketing screenshot pipeline and the acceptance posture harness
// so there is exactly one CDP implementation to maintain.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";

export function findChrome() {
  return findExecutable(["chromium-browser", "chromium", "google-chrome", "google-chrome-stable"]);
}

export function findExecutable(candidates) {
  for (const candidate of candidates) {
    const result = spawnSync("sh", ["-lc", `command -v ${shellQuote(candidate)}`], { encoding: "utf8" });
    if (result.status === 0) return result.stdout.trim().split("\n")[0];
  }
  return undefined;
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

export function chromeArgs(debugPort, userDataDir, windowSize = "1440,900") {
  return [
    "--headless=new",
    `--remote-debugging-port=${debugPort}`,
    "--remote-debugging-address=127.0.0.1",
    "--remote-allow-origins=*",
    `--user-data-dir=${userDataDir}`,
    `--window-size=${windowSize}`,
    "--force-device-scale-factor=1",
    "--hide-scrollbars",
    "--disable-background-networking",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-features=Translate,MediaRouter,OptimizationHints",
    "--no-default-browser-check",
    "--no-first-run",
    "--no-sandbox",
    "about:blank",
  ];
}

export function launchChrome(chromeBin, debugPort, userDataDir, options = {}) {
  return spawn(chromeBin, chromeArgs(debugPort, userDataDir, options.windowSize), {
    stdio: "ignore",
    env: { ...process.env, ...options.env },
  });
}

export async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : undefined;
      server.close(() => {
        if (port === undefined) reject(new Error("Unable to allocate a port"));
        else resolve(port);
      });
    });
    server.on("error", reject);
  });
}

export async function openPage(debugPort) {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" });
  if (!response.ok) throw new Error(`Unable to create Chromium tab: ${response.status} ${response.statusText}`);
  const info = await response.json();
  return CDP.connect(info.webSocketDebuggerUrl);
}

export async function waitForDebugger(debugPort, timeoutMs = 20000) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (response.ok) return;
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(`Chromium debugger never became ready: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export async function evaluate(cdp, expression) {
  const response = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails !== undefined) throw new Error(`Browser evaluation failed: ${JSON.stringify(response.exceptionDetails)}`);
  return response.result?.value;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CDP {
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const cdp = new CDP(ws);
      ws.addEventListener("open", () => resolve(cdp), { once: true });
      ws.addEventListener("error", (event) => reject(event.error ?? new Error("CDP websocket error")), { once: true });
    });
  }

  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener("message", (event) => this.onMessage(event));
    ws.addEventListener("close", () => {
      for (const { reject } of this.pending.values()) reject(new Error("CDP websocket closed"));
      this.pending.clear();
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  waitForEvent(method, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanupListener();
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      const listener = (params) => {
        cleanupListener();
        resolve(params);
      };
      const cleanupListener = () => {
        clearTimeout(timer);
        const listeners = this.listeners.get(method) ?? [];
        this.listeners.set(method, listeners.filter((candidate) => candidate !== listener));
      };
      this.listeners.set(method, [...this.listeners.get(method) ?? [], listener]);
    });
  }

  close() {
    this.ws.close();
  }

  onMessage(event) {
    const message = JSON.parse(String(event.data));
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (pending === undefined) return;
      this.pending.delete(message.id);
      if (message.error !== undefined) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result ?? {});
      return;
    }
    if (message.method !== undefined) {
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {});
    }
  }
}
