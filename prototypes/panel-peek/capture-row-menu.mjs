/**
 * Open a session row's commands the way a finger does and photograph the
 * result. Drives a real browser through CDP rather than asserting on a DOM
 * snapshot, so the menu is checked where it actually paints.
 *
 * Usage: node capture-row-menu.mjs [url] [outDir]
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const URL_ARG = process.argv[2] ?? "http://127.0.0.1:8504/";
// A session must be open before the composer, and so the summon control, exists.
const SESSION_ARG = process.env["FORGERIE_SESSION"] ?? "";
const OUT = process.argv[3] ?? "/tmp/fg-row-menu";
const PORT = 9333;
const POSTURES = [
  { name: "folded-portrait", width: 499, height: 789 },
  { name: "desktop", width: 1440, height: 900 },
];

mkdirSync(OUT, { recursive: true });

let nextId = 0;

const chrome = spawn("chromium", [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--hide-scrollbars",
  `--remote-debugging-port=${String(PORT)}`,
  "about:blank",
], { stdio: "ignore" });

process.on("exit", () => { chrome.kill(); });

const target = await waitForTarget();

for (const posture of POSTURES) {
  await capture(target, posture);
}

chrome.kill();

async function capture(wsTargetUrl, posture) {
  const socket = await connect(wsTargetUrl);
  await send(socket, "Emulation.setDeviceMetricsOverride", {
    width: posture.width,
    height: posture.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send(socket, "Page.enable", {});
  const url = SESSION_ARG === "" ? URL_ARG : `${URL_ARG}?session=${SESSION_ARG}`;
  await send(socket, "Page.navigate", { url });
  await delay(6000);

  // Hold a finger on the first inbox row, exactly as a person would.
  const opened = await evaluate(socket, holdFirstRowScript());
  await delay(600);

  const shot = await send(socket, "Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}/${posture.name}.png`, Buffer.from(shot.data, "base64"));
  console.log(`${posture.name}: menu=${String(opened)} -> ${OUT}/${posture.name}.png`);
  socket.close();
}

function holdFirstRowScript() {
  return `(async () => {
    const app = document.querySelector("pi-web-app");
    // On a shell that shows one surface, the inbox has to be summoned first.
    if (app.shadowRoot.querySelector(".shell.overlay-navigation") !== null) {
      deepQuery(app, ".composer-summon")?.click();
      await new Promise((r) => setTimeout(r, 400));
      const tabs = deepQuery(app, "app-mobile-main-tabs");
      for (const button of tabs?.shadowRoot.querySelectorAll("button") ?? []) {
        if (/session|inbox/i.test(button.textContent ?? "")) { button.click(); break; }
      }
      await new Promise((r) => setTimeout(r, 600));
    }
    const panel = deepQuery(app, "session-inbox-panel");
    if (panel === null) return "no-panel";
    const row = panel.shadowRoot.querySelector(".row");
    if (row === null) return "no-row";
    const box = row.getBoundingClientRect();
    const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
    const down = new PointerEvent("pointerdown", { bubbles: true, composed: true, pointerId: 1, pointerType: "touch", ...at });
    row.dispatchEvent(down);
    await new Promise((r) => setTimeout(r, 700));
    row.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, composed: true, pointerId: 1, pointerType: "touch", ...at }));
    await new Promise((r) => setTimeout(r, 200));
    return panel.shadowRoot.querySelector("#inbox-row-menu") === null ? "closed" : "open";

    function deepQuery(root, selector) {
      if (root === null || root === undefined) return null;
      const shadow = root.shadowRoot ?? root;
      const direct = shadow.querySelector(selector);
      if (direct !== null) return direct;
      for (const child of shadow.querySelectorAll("*")) {
        if (child.shadowRoot === null || child.shadowRoot === undefined) continue;
        const found = deepQuery(child, selector);
        if (found !== null) return found;
      }
      return null;
    }
  })()`;
}

async function evaluate(socket, expression) {
  const result = await send(socket, "Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  return result.result?.value ?? "unknown";
}

async function waitForTarget() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${String(PORT)}/json/list`);
      const targets = await response.json();
      const page = targets.find((entry) => entry.type === "page");
      if (page !== undefined) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome is not listening yet.
    }
    await delay(200);
  }
  throw new Error("Chromium never opened its debugging port");
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => { resolve(socket); });
    socket.addEventListener("error", reject);
  });
}

function send(socket, method, params) {
  const id = (nextId += 1);
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      socket.removeEventListener("message", onMessage);
      if (message.error !== undefined) reject(new Error(`${method}: ${message.error.message}`));
      else resolve(message.result);
    };
    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify({ id, method, params }));
  });
}
