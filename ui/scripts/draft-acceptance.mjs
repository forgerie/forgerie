#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Draft protection against the real Forgerie API, in a real browser.
// It creates one scratch session with an open ask: one model prompt, plus the
// model's reply after Skip. The second session is an existing one, opened
// read-only. Its typed draft lives only in this run's temporary browser profile.
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
const shots = resolve("verification/local/drafts");
const cwd = await mkdtemp(join(tmpdir(), "forgerie-drafts-e2e-"));
const result = { cwd, steps: [], postures: [], mutations: [], errors: [] };
const step = (name, detail = {}) => { result.steps.push({ name, ...detail }); console.log(name, JSON.stringify(detail)); };
const OTHER_DRAFT = "Unsent draft for the other session";
const NOTE = "partial note typed before the switch";

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
    await sleep(150);
  }
}
const query = () => new URLSearchParams({ cwd });
const status = (id) => call(`/api/sessions/${id}/status?${query()}`);
const askPrompt = `This is an automated UI test. Call the ask_user tool exactly once, alone, with exactly these two questions and nothing else: `
  + `{"id":"color","question":"Which color should the draft test use?","options":[{"value":"red","label":"Red"},{"value":"blue","label":"Blue"}]} and `
  + `{"id":"note","question":"Any note for the draft test?","options":[]}. After you receive the answers, reply with the single word OK.`;

const session = await call("/api/sessions", { cwd });
const id = session.id ?? session.sessionId;
assert.ok(id, `No session id in ${JSON.stringify(session)}`);
step("created scratch session", { id });
await call(`/api/sessions/${id}/prompt`, { cwd, text: askPrompt });
await waitUntil("ask opens", async () => (await status(id)).pendingAsk);
await waitUntil("run ends", async () => !(await status(id)).isStreaming);
const catalog = await waitUntil("session listed", async () => {
  const all = await call("/api/sessions/all");
  return all.sessions.some((s) => s.id === id) && all;
}, 30_000);
const other = process.env.OTHER_SESSION ?? catalog.sessions
  .filter((s) => s.id !== id && s.persisted && s.messageCount > 0 && s.messageCount < 100)
  .sort((a, b) => String(b.modified).localeCompare(String(a.modified)))[0]?.id;
assert.ok(other, "No existing session to open read-only. Set OTHER_SESSION.");
step("opened read-only", { other });

const profile = await mkdtemp(join(tmpdir(), "aui-drafts-"));
const port = await getFreePort();
const chromeBin = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout?.trim();
assert.ok(chromeBin, "Chromium is required");
const chrome = launchChrome(chromeBin, port, profile);
let cdp;
try {
  await waitForDebugger(port);
  cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES.find((p) => p.name === "folded-portrait"), colorScheme: "dark" });
  await cdp.send("Network.enable");
  cdp.listeners.set("Runtime.exceptionThrown", [(event) => result.errors.push(event.exceptionDetails.text)]);
  cdp.listeners.set("Network.requestWillBeSent", [(event) => {
    const path = new URL(event.request.url).pathname;
    if (event.request.method === "POST" && path.startsWith("/api/")) result.mutations.push(path);
  }]);
  // A document that is still navigating cannot be evaluated; that only means "not yet".
  const until = (label, expression, timeoutMs = 20_000) => waitUntil(label, () => evaluate(cdp, expression).catch(() => false), timeoutMs)
    .catch(async (error) => { throw new Error(`${error.message}\nPage: ${await evaluate(cdp, `document.body.innerText.slice(0, 400)`).catch(() => "")}`); });
  /** Reload, and judge only the new document: the old one still shows the state under test. */
  const reload = async (label, expression) => {
    await evaluate(cdp, `window.__beforeReload = true`);
    await cdp.send("Page.reload");
    await until(label, `!window.__beforeReload && (${expression})`, 30_000).catch(async (error) => {
      // Archiving the scratch session elsewhere closes its runtime, which drops the open ask.
      const server = await status(id).catch((reason) => ({ error: String(reason) }));
      throw new Error(`${error.message}\nServer: ${JSON.stringify({ pendingAsk: server.pendingAsk?.askId ?? null, error: server.error })}`);
    });
  };
  const read = () => evaluate(cdp, `({
    url: location.search, value: document.querySelector('[data-composer-input]')?.value,
    question: document.querySelector('.ask-question')?.textContent,
    checked: [...document.querySelectorAll('.ask-option input:checked')].map((n) => n.parentElement.textContent),
    status: document.querySelector('.connection-status')?.textContent,
  })`);
  const type = async (text) => {
    await evaluate(cdp, `document.querySelector('[data-composer-input]').focus()`);
    await cdp.send("Input.insertText", { text });
  };
  const visit = async (target) => {
    // Same path as the browser's back and forward buttons: App reads the URL on popstate.
    await evaluate(cdp, `(() => { const url = new URL(location.href); url.searchParams.set('session', ${JSON.stringify(target)});
      history.pushState({}, '', url); dispatchEvent(new PopStateEvent('popstate')); })()`);
  };
  const joined = `['Connected', 'Running', 'Waiting for you'].includes(document.querySelector('.connection-status')?.textContent)`;
  const onNote = `location.search.includes(${JSON.stringify(id)})`
    + ` && document.querySelector('.ask-question')?.textContent === 'Any note for the draft test?'`
    + ` && document.querySelector('[data-composer-input]')?.value === ${JSON.stringify(NOTE)}`;
  const onOther = `location.search.includes(${JSON.stringify(other)}) && ${joined} && !document.querySelector('.ask') && document.querySelector('[data-composer-input]')?.value === ${JSON.stringify(OTHER_DRAFT)}`;

  // 1. A chat draft in the other session.
  const url = new URL(app); url.searchParams.set("session", other);
  await cdp.send("Page.navigate", { url: url.href });
  await until("other session joins", joined, 30_000);
  await type(OTHER_DRAFT);
  step("typed a chat draft", await read());

  // 2. Switch to the scratch session: its ask takes the input, blank.
  step("server before the switch", { pendingAsk: (await status(id)).pendingAsk?.askId ?? null });
  await visit(id);
  await until("ask opens", `document.querySelector('.ask-question')?.textContent === 'Which color should the draft test use?'`, 30_000)
    .catch(async (error) => {
      const server = await status(id).catch((reason) => ({ error: String(reason) }));
      throw new Error(`${error.message}\nServer: ${JSON.stringify({ pendingAsk: server.pendingAsk?.askId ?? null, isStreaming: server.isStreaming })}\nPOSTs: ${JSON.stringify(result.mutations)}`);
    });
  assert.equal((await read()).value, "", "The other session's draft leaked into the ask");
  await evaluate(cdp, `[...document.querySelectorAll('.ask-option')].find((n) => n.textContent.startsWith('Blue')).querySelector('input').click()`);
  await evaluate(cdp, `document.querySelector('.ask-primary').click()`);
  await until("second question", `document.querySelector('.ask-question')?.textContent === 'Any note for the draft test?'`);
  await type(NOTE);
  step("answered partly", await read());

  // 3. Back, forward, and reload.
  await evaluate(cdp, `history.back()`);
  await until("back to the other session with its draft", onOther);
  step("back: chat draft restored", await read());
  await evaluate(cdp, `history.forward()`);
  await until("forward to the ask with its answers", onNote);
  await evaluate(cdp, `document.querySelector('[aria-label="Previous question"]').click()`);
  assert.deepEqual((await read()).checked, ["Blue"]);
  await evaluate(cdp, `document.querySelector('.ask-primary').click()`);
  await until("note restored again", onNote);
  step("forward: answers restored", await read());
  await reload("reload keeps the answers", onNote);
  step("reload: answers restored", await read());

  // 4. Every posture and scheme, each after its own reload.
  await mkdir(shots, { recursive: true });
  for (const scheme of ["light", "dark"]) {
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    for (const posture of FOLD8_POSTURES) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 2.625, mobile: true });
      await reload(`${posture.name} ${scheme} restore`, onNote);
      await evaluate(cdp, `document.fonts.ready.then(() => true)`);
      await sleep(250);
      const box = await evaluate(cdp, `(() => { const r = document.querySelector('[data-composer-input]').getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, overflow: document.documentElement.scrollWidth > innerWidth }; })()`);
      assert.ok(box.top >= 0 && box.bottom <= posture.height && box.left >= 0 && box.right <= posture.width, `${posture.name}: input outside ${JSON.stringify(box)}`);
      assert.equal(box.overflow, false);
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
      const file = join(shots, `${posture.name}-${scheme}.png`);
      await writeFile(file, Buffer.from(data, "base64"));
      result.postures.push({ posture: posture.name, scheme, input: box, file });
    }
  }

  // 5. The other session's chat draft at every posture, after a reload.
  await evaluate(cdp, `history.back()`);
  await until("other session again", onOther, 30_000);
  for (const posture of FOLD8_POSTURES) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 2.625, mobile: true });
    await reload(`${posture.name} chat draft restore`, onOther);
  }
  step("chat draft restored at every posture");

  // 6. Clean up through the UI: Skip closes the ask and its saved answers go; an emptied draft goes.
  await evaluate(cdp, `history.forward()`);
  await until("ask again", onNote, 30_000);
  await evaluate(cdp, `[...document.querySelectorAll('button')].find((n) => n.textContent === 'Skip').click()`);
  await until("ask closed", `!document.querySelector('.ask') && !!document.querySelector('[data-composer-input]')`, 30_000);
  await waitUntil("reply to the dismissal ends", async () => { const s = await status(id); return !s.isStreaming && !s.pendingAsk; });
  const leftAsk = await evaluate(cdp, `localStorage.getItem(${JSON.stringify(`forgerie.draft.v1:${id}`)})`);
  assert.equal(leftAsk, null, `Answers outlived the closed ask: ${leftAsk}`);
  await evaluate(cdp, `history.back()`);
  await until("other session for cleanup", onOther, 30_000);
  await evaluate(cdp, `document.querySelector('[data-composer-input]').select()`);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
  await until("draft emptied", `document.querySelector('[data-composer-input]').value === ''`);
  const keys = await evaluate(cdp, `Object.keys(localStorage)`);
  assert.deepEqual(keys.filter((key) => key.startsWith("forgerie.draft")), [], "An emptied draft left a record");
  step("cleanup left no draft records", { keys });

  assert.deepEqual(result.mutations, [`/api/sessions/${id}/ask/cancel`]);
  assert.deepEqual(result.errors, []);
  const output = resolve("verification/local");
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "draft-acceptance.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ postures: result.postures.length, mutations: result.mutations }, null, 2));
} finally {
  // Keep the scratch session out of the user's session list.
  await call(`/api/sessions/${id}/archive`, { cwd }).catch((error) => console.error(`Archive failed: ${error.message}`));
  cdp?.close(); chrome.kill("SIGTERM"); await sleep(300);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
