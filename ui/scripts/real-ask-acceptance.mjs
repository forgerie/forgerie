#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// End-to-end ask_user check against the real Forgerie API. It creates its own
// scratch session, so no existing session is prompted. Each run sends two
// prompts to the default model and costs normal model usage.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
const repo = process.env.FORGERIE_ROOT ?? resolve("../..");
const { launchChrome, getFreePort, waitForDebugger, evaluate, sleep } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));
const api = process.env.API_URL ?? "http://127.0.0.1:8504";
const app = new URL(process.env.APP_URL ?? "http://127.0.0.1:8510/");
const cwd = await mkdtemp(join(tmpdir(), "forgerie-ask-e2e-"));
const result = { cwd, steps: [], errors: [] };
const step = (name, detail = {}) => { result.steps.push({ name, ...detail }); console.log(name, JSON.stringify(detail)); };

async function call(path, body) {
  const response = await fetch(api + path, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${text}`);
  return JSON.parse(text);
}
async function waitUntil(label, check, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await sleep(250);
  }
}
const query = () => new URLSearchParams({ cwd });
const status = (id) => call(`/api/sessions/${id}/status?${query()}`);
const lastRecord = async (id) => (await call(`/api/sessions/${id}/messages?${query()}`)).messages
  .findLast((m) => m.role === "custom" && m.customType === "pi-web.ask.answers");
const askPrompt = (tag) => `This is an automated UI test. Call the ask_user tool exactly once, alone, with exactly these two questions and nothing else: `
  + `{"id":"color-${tag}","question":"Which color should the ${tag} test use?","options":[{"value":"red","label":"Red"},{"value":"blue","label":"Blue"}]} and `
  + `{"id":"note-${tag}","question":"Any note for the ${tag} test?","options":[]}. After you receive the answers, reply with the single word OK.`;

const session = await call("/api/sessions", { cwd });
const id = session.id ?? session.sessionId;
assert.ok(id, `No session id in ${JSON.stringify(session)}`);
step("created scratch session", { id });
// The first ask is opened before any browser loads. The catalog lists a new
// session only once it is persisted, which the first prompt does.
await call(`/api/sessions/${id}/prompt`, { cwd, text: askPrompt("first") });
await waitUntil("first ask opens", async () => (await status(id)).pendingAsk);
await waitUntil("first run ends", async () => !(await status(id)).isStreaming);
await waitUntil("session listed", async () => (await call("/api/sessions/all")).sessions.some((s) => s.id === id), 30_000);

const profile = await mkdtemp(join(tmpdir(), "aui-real-ask-"));
const port = await getFreePort();
const chromeBin = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout?.trim();
const chrome = launchChrome(chromeBin, port, profile);
let cdp;
try {
  await waitForDebugger(port);
  cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES.find((p) => p.name === "folded-portrait"), colorScheme: "dark" });
  cdp.listeners.set("Runtime.exceptionThrown", [(event) => result.errors.push(event.exceptionDetails.text)]);
  const until = (expression, timeoutMs) => waitUntil(expression, () => evaluate(cdp, expression), timeoutMs)
    .catch(async (error) => { throw new Error(`${error.message}\nPage: ${await evaluate(cdp, `document.body.innerText.slice(0, 600)`)}`); });
  const shown = (label) => evaluate(cdp, `(() => { const n = document.querySelector('[aria-label="${label}"]');
    return !!n && n.getBoundingClientRect().height > 0; })()`);
  const click = (text) => evaluate(cdp, `[...document.querySelectorAll('button')].find((n) => n.textContent === ${JSON.stringify(text)}).click()`);

  // 1. Page load rehydrates the open ask from status; Skip dismisses it.
  const url = new URL(app); url.searchParams.set("session", id);
  await cdp.send("Page.navigate", { url: url.href });
  await until(`document.querySelector('.ask-question')?.textContent.startsWith('Which color should the first')`, 30_000);
  assert.equal(await shown("Send message"), false); assert.equal(await shown("Message"), true);
  step("page load rehydrated the open ask from status", { status: await evaluate(cdp, `document.querySelector('.connection-status').textContent`) });
  await click("Skip");
  await until(`!!document.querySelector('[aria-label="Message"]')`, 15_000);
  assert.equal((await lastRecord(id))?.details?.reason, "cancelled");
  step("Skip dismissed the ask", { reason: "cancelled" });
  await waitUntil("reply to the dismissal ends", async () => { const s = await status(id); return !s.isStreaming && !s.pendingAsk; });
  await until(`document.querySelector('.connection-status')?.textContent === 'Connected'`, 30_000);

  // 2. A live ask puts the composer into ask mode; answers reach the server; the draft returns.
  await evaluate(cdp, `document.querySelector('[aria-label="Message"]').focus()`);
  await cdp.send("Input.insertText", { text: "draft kept across the ask" });
  await call(`/api/sessions/${id}/prompt`, { cwd, text: askPrompt("second") });
  await until(`!!document.querySelector('[aria-label="Questions from the agent"]')`);
  assert.equal(await shown("Send message"), false); assert.equal(await shown("Message"), true);
  step("live ask.opened put the composer into ask mode", { askId: (await status(id)).pendingAsk?.askId });
  await evaluate(cdp, `[...document.querySelectorAll('.ask-option')].find((n) => n.textContent.startsWith('Blue')).querySelector('input').click()`);
  await click("Next");
  await until(`document.querySelector('.ask-question')?.textContent.startsWith('Any note')`, 5000);
  await evaluate(cdp, `document.querySelector('[aria-label="Message"]').focus()`);
  await cdp.send("Input.insertText", { text: "sent from the new UI" });
  await click("Send answers");
  await until(`!document.querySelector('[aria-label="Questions from the agent"]')`, 15_000);
  assert.equal(await shown("Message"), true);
  const draft = await evaluate(cdp, `document.querySelector('[aria-label="Message"]').value`);
  assert.equal(draft, "draft kept across the ask");
  const record = await lastRecord(id);
  assert.equal(record?.details?.reason, "submitted");
  const answers = record.details.questions.map((q) => ({ id: q.question.id, values: q.values, ...(q.otherText ? { otherText: q.otherText } : {}) }));
  assert.deepEqual(answers, [{ id: "color-second", values: ["blue"] }, { id: "note-second", values: [], otherText: "sent from the new UI" }]);
  step("submitted through the form", { reason: record.details.reason, answers, draft });
  await waitUntil("final run ends", async () => !(await status(id)).isStreaming);
  assert.deepEqual(result.errors, []);
  const output = resolve("verification/local");
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "real-ask-acceptance.json"), JSON.stringify(result, null, 2));
} finally {
  // Keep the scratch session out of the user's session list.
  await call(`/api/sessions/${id}/archive`, { cwd }).catch((error) => console.error(`Archive failed: ${error.message}`));
  cdp?.close(); chrome.kill("SIGTERM"); await sleep(300);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
