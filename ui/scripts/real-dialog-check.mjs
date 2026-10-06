#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node
// Extension dialogs against the real Forgerie API and a real Pi extension.
// It creates a scratch folder with a test-only project extension
// (scripts/fixtures/dialog-probe-extension.ts), creates a session there, and
// archives it afterwards. One short prompt makes Pi save the session so the
// catalog lists it; that prompt costs normal model usage. The dialogs cost nothing.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const repo = process.env.FORGERIE_ROOT ?? resolve("../..");
const { launchChrome, getFreePort, waitForDebugger, evaluate, sleep } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage, pressCombo } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));
const api = process.env.API_URL ?? "http://127.0.0.1:8504";
const app = new URL(process.env.APP_URL ?? "http://127.0.0.1:8510/");
const cwd = await mkdtemp(join(tmpdir(), "forgerie-dialog-e2e-"));
await mkdir(join(cwd, ".pi/extensions"), { recursive: true });
await copyFile(join(dirname(fileURLToPath(import.meta.url)), "fixtures/dialog-probe-extension.ts"), join(cwd, ".pi/extensions/dialog-probe.ts"));
const result = { cwd, steps: [], errors: [] };
const step = (name, detail = {}) => { result.steps.push({ name, ...detail }); console.log(name, JSON.stringify(detail)); };
async function call(path, body) {
  const response = await fetch(api + path, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${text}`);
  return JSON.parse(text);
}
async function waitUntil(label, check, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await sleep(150);
  }
}
const query = () => new URLSearchParams({ cwd });
const status = (id) => call(`/api/sessions/${id}/status?${query()}`);
const pageState = `JSON.stringify({ draft: document.querySelector("textarea")?.value, status: document.querySelector(".connection-status")?.textContent,
  alerts: [...document.querySelectorAll("[role=alert]")].map((node) => node.textContent) })`;
const probeResult = () => readFile(join(cwd, "dialog-probe-result.json"), "utf8").then(JSON.parse, () => undefined);

const session = await call("/api/sessions", { cwd });
const id = session.id ?? session.sessionId;
assert.ok(id, `No session id in ${JSON.stringify(session)}`);
step("created scratch session with the probe extension", { id });
await call(`/api/sessions/${id}/prompt`, { cwd, text: "Automated UI test. Reply with the single word OK and do nothing else." });
await waitUntil("session listed", async () => (await call("/api/sessions/all")).sessions.some((s) => s.id === id));
await waitUntil("first run ends", async () => !(await status(id)).isStreaming);

const profile = await mkdtemp(join(tmpdir(), "aui-real-dialog-"));
const port = await getFreePort();
const chrome = launchChrome(process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim(), port, profile);
let cdp;
try {
  await waitForDebugger(port);
  cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES.find((p) => p.name === "folded-portrait"), colorScheme: "dark" });
  cdp.listeners.set("Runtime.exceptionThrown", [(event) => result.errors.push(event.exceptionDetails.text)]);
  const until = (expression, timeoutMs = 30_000) => waitUntil(expression, () => evaluate(cdp, expression), timeoutMs)
    .catch(async (error) => { throw new Error(`${error.message}\nPage: ${await evaluate(cdp, pageState)}\nAPI: ${JSON.stringify((await status(id)).pendingDialogs ?? [])}`); });
  const title = () => evaluate(cdp, "document.querySelector('.dialog-layer .ask-question')?.textContent ?? null");
  const type = async (text) => {
    await evaluate(cdp, "document.querySelector('[aria-label=\"Message\"]').focus()");
    await pressCombo(cdp, "ctrl+a");
    await cdp.send("Input.insertText", { text });
  };
  const open = async () => {
    const url = new URL(app); url.searchParams.set("session", id);
    await cdp.send("Page.navigate", { url: url.href });
    await until("['Connected', 'Waiting for you', 'Running'].includes(document.querySelector('.connection-status')?.textContent)");
  };
  await open();
  // The first Enter picks the command from the slash list; the second sends it.
  await type("/dialog-probe");
  await until("[...document.querySelectorAll('[role=option]')].some(option => option.textContent.includes('dialog-probe'))");
  await pressCombo(cdp, "enter");
  await until("document.querySelector('textarea').value === '/dialog-probe '");
  await pressCombo(cdp, "enter");
  await until("document.querySelector('textarea').value === ''");
  await sleep(25_000); // Longer than the old 20-second client timeout, so a waiting command must not fail.
  await until("document.querySelector('.dialog-layer .ask-question')?.textContent === 'Deploy the probe?'");
  assert.equal((await status(id)).pendingDialogs?.[0]?.kind, "confirm");
  assert.equal(await evaluate(cdp, "document.querySelector('.connection-status').textContent"), "Waiting for you");
  step("/dialog-probe opened a real confirm in the input bar", { title: await title() });

  // A reload rehydrates the open dialog from status alone.
  await open();
  await until("document.querySelector('.dialog-layer .ask-question')?.textContent === 'Deploy the probe?'");
  step("a reload shows the same open dialog");

  await evaluate(cdp, "[...document.querySelectorAll('.dialog-confirm button')].find(b => b.textContent === 'Yes').click()");
  await until("document.querySelector('.dialog-layer .ask-question')?.textContent === 'Pick a probe target'");
  await type("unsent chat");
  await evaluate(cdp, "[...document.querySelectorAll('.dialog-head button')].find(b => b.textContent === 'Skip').click()");
  await until("document.querySelector('.dialog-layer .ask-question')?.textContent === 'Name the probe'");
  assert.equal(await evaluate(cdp, "document.querySelector('[aria-label=\"Message\"]').value"), "");
  assert.equal(await evaluate(cdp, "document.querySelector('[aria-label=\"Message\"]').placeholder"), "probe-name");
  step("Yes answered the confirm, Skip closed the select, and the input dialog took the input");

  await type("probe-1"); await pressCombo(cdp, "enter");
  const answers = await waitUntil("probe result", probeResult, 20_000);
  assert.deepEqual(answers, { confirmed: true, target: null, name: "probe-1" });
  await until("!document.querySelector('.dialog-layer')");
  assert.equal(await evaluate(cdp, "document.querySelector('[aria-label=\"Message\"]').value"), "unsent chat");
  assert.deepEqual((await status(id)).pendingDialogs ?? [], []);
  step("the extension received every answer, and the chat draft came back", { answers });

  assert.deepEqual(result.errors, []);
  const output = resolve("verification/local");
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "real-dialog-check.json"), JSON.stringify(result, null, 2));
} finally {
  await call(`/api/sessions/${id}/abort`, { cwd }).catch(() => {});
  await call(`/api/sessions/${id}/archive`, { cwd }).catch((error) => console.error(`Archive failed: ${error.message}`));
  cdp?.close(); chrome.kill("SIGTERM"); await sleep(300);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
