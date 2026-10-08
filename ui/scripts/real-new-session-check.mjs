#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node
// New sessions through the real app and API. In a scratch folder it starts one
// session from the dialog, then a second in Rapidfire from Ctrl+Enter. Each sends
// one short first message (normal model usage). Both are archived afterwards.
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
const cwd = await mkdtemp(join(tmpdir(), "forgerie-new-e2e-"));
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
const profile = await mkdtemp(join(tmpdir(), "aui-real-new-"));
const port = await getFreePort();
const chrome = launchChrome(process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim(), port, profile);
let cdp;
let id;
let rapidId;
try {
  await waitForDebugger(port);
  cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES.find((p) => p.name === "folded-portrait"), colorScheme: "dark" });
  cdp.listeners.set("Runtime.exceptionThrown", [(event) => result.errors.push(event.exceptionDetails.text)]);
  const until = (expression, timeoutMs = 60_000) => waitUntil(expression, () => evaluate(cdp, expression), timeoutMs);
  const url = new URL(app); url.searchParams.set("new", cwd);
  await cdp.send("Page.navigate", { url: url.href });
  await until("!!document.querySelector('dialog.ns-dialog[open]') && !!document.querySelector('.model-trigger') && !document.querySelector('.model-trigger').textContent.startsWith('No model')");
  const label = await evaluate(cdp, "document.querySelector('.destination-value').textContent");
  assert.equal(label, cwd.split("/").at(-1));
  step("the composer opened in the folder from the URL, with Pi's default model", { label, model: await evaluate(cdp, "document.querySelector('.model-trigger').textContent") });

  await evaluate(cdp, "document.querySelector('.model-trigger').click()");
  await until("[...document.querySelectorAll('.model-levels button')].some(b => b.textContent === 'Low')");
  await evaluate(cdp, "[...document.querySelectorAll('.model-levels button')].find(b => b.textContent === 'Low').click()");
  await until("document.querySelector('.model-levels [aria-pressed=true]')?.textContent === 'Low' && !document.querySelector('.model-panel [aria-busy=true]')");
  await sleep(100);
  await pressCombo(cdp, "escape");
  await until("!document.querySelector('.model-panel') && document.querySelector('.model-trigger').textContent.includes('Low')");

  const shownModel = await evaluate(cdp, "document.querySelector('.model-trigger-name').textContent");
  await evaluate(cdp, "document.querySelector('.ns-dialog [data-composer-input]').focus()");
  await cdp.send("Input.insertText", { text: "Automated UI test. Reply with the single word OK and do nothing else." });
  await pressCombo(cdp, "ctrl+enter");
  await until("new URLSearchParams(location.search).has('session')", 90_000);
  id = await evaluate(cdp, "new URLSearchParams(location.search).get('session')");
  assert.equal(await evaluate(cdp, "new URLSearchParams(location.search).has('new')"), false);
  step("Send created the session and opened it", { id });

  // The started session replaced its composer in history, so Back does not land on an empty composer.
  const backTarget = await evaluate(cdp, "history.length");
  await evaluate(cdp, "history.back()");
  await sleep(800);
  assert.equal(await evaluate(cdp, "!!document.querySelector('dialog.ns-dialog')"), false, "Back reopened the dialog");
  await evaluate(cdp, "history.forward()");
  await until(`new URLSearchParams(location.search).get("session") === ${JSON.stringify(id)}`);
  step("Back from the started session does not reopen the empty composer", { historyLength: backTarget });

  const status = await waitUntil("run ends", async () => { const s = await call(`/api/sessions/${id}/status?${new URLSearchParams({ cwd })}`); return s.isStreaming ? undefined : s; });
  assert.equal(status.thinkingLevel, "low");
  assert.ok(shownModel.startsWith(status.model?.name ?? status.model?.id ?? "?"), `bar showed ${shownModel}, Pi started ${status.model?.id}`);
  await until("[...document.querySelectorAll('.message')].some(node => node.textContent.includes('OK'))", 60_000);
  const listed = (await call("/api/sessions/all")).sessions.find((session) => session.id === id);
  assert.ok(listed, "the new session is in the catalog");
  assert.equal(listed.cwd, cwd);
  step("Pi started it with the chosen level, the reply arrived, and the catalog lists it", { thinkingLevel: status.thinkingLevel, model: status.model?.id });

  // Rapidfire: Ctrl+Enter opens the dialog where the reader is; Send starts in the background and keeps it open.
  await evaluate(cdp, "document.activeElement?.blur()");
  await pressCombo(cdp, "ctrl+enter");
  await until("!!document.querySelector('dialog.ns-dialog[open]') && !document.querySelector('.ns-dialog .model-trigger').textContent.startsWith('No model')");
  await evaluate(cdp, "document.querySelector('.ns-chips [aria-pressed]').click()");
  await until("document.querySelector('.ns-chips [aria-pressed]').getAttribute('aria-pressed') === 'true'");
  await evaluate(cdp, "document.querySelector('.ns-dialog [data-composer-input]').focus()");
  await cdp.send("Input.insertText", { text: "Automated Rapidfire test. Reply with the single word OK." });
  await pressCombo(cdp, "ctrl+enter");
  await until("document.querySelector('.ns-launch')?.dataset.state === 'starting'", 10_000);
  const pendingRow = await evaluate(cdp, "!!document.querySelector('.ns-dialog') && document.querySelector('.ns-dialog [data-composer-input]').value === ''");
  assert.equal(pendingRow, true, "the dialog stayed open with an empty bar");
  await until("document.querySelector('.ns-launch')?.dataset.state === 'started'", 90_000);
  assert.equal(await evaluate(cdp, "new URLSearchParams(location.search).get('session')"), id, "Rapidfire moved the reader");
  rapidId = (await call("/api/sessions/all")).sessions.filter((session) => session.cwd === cwd && session.id !== id).map((session) => session.id)[0];
  assert.ok(rapidId, "the Rapidfire session is in the catalog");
  step("Rapidfire started a second session in the background and kept the dialog open", { rapidId });

  assert.deepEqual(result.errors, []);
  const output = resolve("verification/local");
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "real-new-session-check.json"), JSON.stringify(result, null, 2));
} finally {
  // The Rapidfire reply may still be running; the server refuses to archive until it ends.
  if (rapidId) await waitUntil("Rapidfire run ends", async () => !(await call(`/api/sessions/${rapidId}/status?${new URLSearchParams({ cwd })}`)).isStreaming).catch(() => {});
  if (rapidId) await call(`/api/sessions/${rapidId}/archive`, { cwd }).catch((error) => console.error(`Archive failed: ${error.message}`));
  if (id) await call(`/api/sessions/${id}/archive`, { cwd }).catch((error) => console.error(`Archive failed: ${error.message}`));
  cdp?.close(); chrome.kill("SIGTERM"); await sleep(300);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
