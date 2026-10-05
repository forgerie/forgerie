#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node
// Sending while working, against the real Forgerie API and Pi's real queue.
// It creates its own scratch session in a temp folder and archives it
// afterwards. Each run asks the agent to sleep in bash, so a queue can form;
// the prompts cost normal model usage.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
const repo = process.env.FORGERIE_ROOT ?? resolve("../..");
const { launchChrome, getFreePort, waitForDebugger, evaluate, sleep } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage, pressCombo } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));
const api = process.env.API_URL ?? "http://127.0.0.1:8504";
const app = new URL(process.env.APP_URL ?? "http://127.0.0.1:8510/");
const cwd = await mkdtemp(join(tmpdir(), "forgerie-queue-e2e-"));
const result = { cwd, steps: [], errors: [] };
const step = (name, detail = {}) => { result.steps.push({ name, ...detail }); console.log(name, JSON.stringify(detail)); };
async function call(path, body) {
  const response = await fetch(api + path, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${text}`);
  return JSON.parse(text);
}
async function waitUntil(label, check, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await sleep(200);
  }
}
const query = () => new URLSearchParams({ cwd });
const status = (id) => call(`/api/sessions/${id}/status?${query()}`);
const userTexts = async (id) => (await call(`/api/sessions/${id}/messages?${query()}`)).messages
  .filter((m) => m.role === "user")
  .map((m) => typeof m.content === "string" ? m.content : m.content.filter((p) => p.type === "text").map((p) => p.text).join(""));
const SLOW = "Automated UI test. Use the bash tool to run `sleep 25`. After it finishes, reply with the single word DONE and do nothing else.";
const FOLLOW = "Automated UI test follow-up. Reply with the single word OK and do nothing else.";
const STEER = "Automated UI test steer. When you reply, reply with the single word STEERED and do nothing else.";
const DROPPED = "Automated UI test. This queued message must return to the draft.";

const session = await call("/api/sessions", { cwd });
const id = session.id ?? session.sessionId;
assert.ok(id, `No session id in ${JSON.stringify(session)}`);
step("created scratch session", { id });
await call(`/api/sessions/${id}/prompt`, { cwd, text: "Automated UI test. Reply with the single word OK and do nothing else." });
await waitUntil("session listed", async () => (await call("/api/sessions/all")).sessions.some((s) => s.id === id));
await waitUntil("first run ends", async () => !(await status(id)).isStreaming);

const profile = await mkdtemp(join(tmpdir(), "aui-real-queue-"));
const port = await getFreePort();
const chrome = launchChrome(process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim(), port, profile);
let cdp;
try {
  await waitForDebugger(port);
  cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES.find((p) => p.name === "folded-portrait"), colorScheme: "dark" });
  cdp.listeners.set("Runtime.exceptionThrown", [(event) => result.errors.push(event.exceptionDetails.text)]);
  const until = (expression, timeoutMs = 60_000) => waitUntil(expression, () => evaluate(cdp, expression), timeoutMs)
    .catch(async (error) => { throw new Error(`${error.message}\nPage: ${await evaluate(cdp, "document.body.innerText.slice(-800)")}`); });
  const rows = () => evaluate(cdp, "[...document.querySelectorAll('section.queue .queue-item')].map(row => row.querySelector('.queue-kind').textContent + ': ' + row.querySelector('.queue-text').textContent)");
  const draft = () => evaluate(cdp, "document.querySelector('[aria-label=\"Message\"]').value");
  const type = async (text) => {
    await evaluate(cdp, "document.querySelector('[aria-label=\"Message\"]').focus()");
    await pressCombo(cdp, "ctrl+a");
    await cdp.send("Input.insertText", { text });
  };
  const open = async () => {
    const url = new URL(app); url.searchParams.set("session", id);
    await cdp.send("Page.navigate", { url: url.href });
    await until("document.querySelector('.connection-status')?.textContent === 'Connected'");
  };

  await open();
  await type(SLOW); await pressCombo(cdp, "enter");
  await until("!!document.querySelector('[aria-label=\"Stop generating\"]')");
  await waitUntil("agent streams", async () => (await status(id)).isStreaming);
  await sleep(4000);
  step("agent run started from the composer");

  await type(FOLLOW); await pressCombo(cdp, "enter");
  await until(`[...document.querySelectorAll('.queue-text')].some(n => n.textContent === ${JSON.stringify(FOLLOW)})`);
  assert.equal(await draft(), "");
  await type(STEER); await pressCombo(cdp, "ctrl+shift+enter");
  await until(`[...document.querySelectorAll('.queue-text')].some(n => n.textContent === ${JSON.stringify(STEER)})`);
  const queued = await rows();
  const server = (await status(id)).queuedMessages;
  assert.deepEqual(server.map((m) => m.kind).sort(), ["followUp", "steer"]);
  assert.equal(queued.length, 2);
  step("Enter queued a follow-up and Ctrl+Shift+Enter queued a steer; Pi lists both", { queued, server });

  await waitUntil("queue drains and runs end", async () => { const s = await status(id); return !s.isStreaming && s.queuedMessages.length === 0; }, 180_000);
  await until("document.querySelectorAll('section.queue .queue-item').length === 0");
  const texts = await userTexts(id);
  const steerAt = texts.indexOf(STEER), followAt = texts.indexOf(FOLLOW);
  assert.ok(steerAt > 0 && followAt > 0, `history: ${JSON.stringify(texts)}`);
  assert.ok(steerAt < followAt, "the steer reaches the agent before the follow-up");
  step("Pi delivered the steer, then the follow-up; the queue list emptied", { order: texts.slice(-3) });

  // Stop returns queued work to the draft, ahead of what is typed.
  await type(SLOW); await pressCombo(cdp, "enter");
  await waitUntil("agent streams again", async () => (await status(id)).isStreaming);
  await sleep(4000);
  await type(DROPPED); await pressCombo(cdp, "enter");
  await until(`[...document.querySelectorAll('.queue-text')].some(n => n.textContent === ${JSON.stringify(DROPPED)})`);
  await type("typed after");
  await evaluate(cdp, "document.querySelector('[aria-label=\"Stop generating\"]').click()");
  await waitUntil("run stops", async () => !(await status(id)).isStreaming);
  await until(`document.querySelector('[aria-label="Message"]').value.startsWith(${JSON.stringify(DROPPED)})`, 15_000);
  const restored = await draft();
  assert.ok(restored.startsWith(DROPPED), `draft: ${JSON.stringify(restored)}`);
  assert.equal((await status(id)).queuedMessages.length, 0);
  assert.ok(!(await userTexts(id)).includes(DROPPED));
  step("Stop returned the queued message to the draft ahead of the typed text", { draft: restored });

  assert.deepEqual(result.errors, []);
  const output = resolve("verification/local");
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "real-queue-acceptance.json"), JSON.stringify(result, null, 2));
} finally {
  await call(`/api/sessions/${id}/abort`, { cwd }).catch(() => {});
  await call(`/api/sessions/${id}/archive`, { cwd }).catch((error) => console.error(`Archive failed: ${error.message}`));
  cdp?.close(); chrome.kill("SIGTERM"); await sleep(300);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
