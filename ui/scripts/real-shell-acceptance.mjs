#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node
// End-to-end `!` commands against the real Forgerie API. It creates its own
// scratch session in a temp folder and archives it afterwards. One short
// prompt makes Pi save the session so the catalog lists it; that prompt costs
// normal model usage. The shell commands themselves cost nothing.
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
const cwd = await mkdtemp(join(tmpdir(), "forgerie-shell-e2e-"));
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
const records = async (id) => (await call(`/api/sessions/${id}/messages?${query()}`)).messages.filter((m) => m.role === "bashExecution");

const session = await call("/api/sessions", { cwd });
const id = session.id ?? session.sessionId;
assert.ok(id, `No session id in ${JSON.stringify(session)}`);
step("created scratch session", { id });
await call(`/api/sessions/${id}/prompt`, { cwd, text: "Automated UI test. Reply with the single word OK and do nothing else." });
await waitUntil("session listed", async () => (await call("/api/sessions/all")).sessions.some((s) => s.id === id));
await waitUntil("first run ends", async () => !(await status(id)).isStreaming);

const profile = await mkdtemp(join(tmpdir(), "aui-real-shell-"));
const port = await getFreePort();
const chrome = launchChrome(process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim(), port, profile);
let cdp;
try {
  await waitForDebugger(port);
  cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES.find((p) => p.name === "folded-portrait"), colorScheme: "dark" });
  cdp.listeners.set("Runtime.exceptionThrown", [(event) => result.errors.push(event.exceptionDetails.text)]);
  const until = (expression, timeoutMs = 30_000) => waitUntil(expression, () => evaluate(cdp, expression), timeoutMs)
    .catch(async (error) => { throw new Error(`${error.message}\nPage: ${await evaluate(cdp, "document.body.innerText.slice(-800)")}`); });
  const rows = () => evaluate(cdp, `[...document.querySelectorAll('.shell-run')].map(row => ({
    command: row.querySelector('.shell-command').textContent, status: row.querySelector('.shell-status').textContent,
    output: row.querySelector('.shell-output')?.textContent ?? '', context: !!row.querySelector('.shell-context') }))`);
  const run = async (text) => {
    await evaluate(cdp, "document.querySelector('[aria-label=\"Message\"]').focus()");
    await cdp.send("Input.insertText", { text });
    await pressCombo(cdp, "enter");
  };
  const open = async () => {
    const url = new URL(app); url.searchParams.set("session", id);
    await cdp.send("Page.navigate", { url: url.href });
    await until("['Connected', 'Running shell command'].includes(document.querySelector('.connection-status')?.textContent)");
  };

  await open();
  await run("!echo hi; echo err >&2; exit 3");
  await until("[...document.querySelectorAll('.shell-status')].at(-1)?.textContent === 'exit 3'");
  assert.equal(await evaluate(cdp, "document.querySelector('[aria-label=\"Message\"]').value"), "");
  assert.deepEqual((await rows()).at(-1), { command: "$ echo hi; echo err >&2; exit 3", status: "exit 3", output: "hi\nerr\n", context: false });
  step("! ran live and reported its exit status", (await rows()).at(-1));

  await run("!!printf 'a\\nb\\n'");
  await until("[...document.querySelectorAll('.shell-status')].at(-1)?.textContent === 'exit 0'");
  assert.deepEqual((await rows()).at(-1), { command: "$ printf 'a\\nb\\n'", status: "exit 0", output: "a\nb\n", context: true });
  step("!! ran excluded from context", (await rows()).at(-1));

  const live = await rows();
  await open();
  await until(`document.querySelectorAll('.shell-run').length === ${live.length}`);
  assert.deepEqual(await rows(), live);
  assert.equal((await records(id)).length, 2);
  step("reload shows the saved records once, unchanged", { rows: live.length });

  // Join while a command runs: the row stays one row and finishes with the full output.
  await run("!for i in 1 2 3 4 5 6; do echo line $i; sleep 0.6; done");
  await until("[...document.querySelectorAll('.shell-output')].at(-1)?.textContent.includes('line 2')");
  await open();
  await until("[...document.querySelectorAll('.shell-status')].at(-1)?.textContent === 'running'", 5000);
  assert.equal(await evaluate(cdp, "document.querySelector('.session-header .connection-status').textContent"), "Running shell command");
  await until("[...document.querySelectorAll('.shell-status')].at(-1)?.textContent === 'exit 0'");
  const joined = await rows();
  assert.equal(joined.length, live.length + 1);
  assert.equal(joined.at(-1).output, "line 1\nline 2\nline 3\nline 4\nline 5\nline 6\n");
  step("join during a running command kept one row and the full output", joined.at(-1));
  await open();
  await until(`document.querySelectorAll('.shell-run').length === ${live.length + 1}`);
  assert.equal((await rows()).at(-1).command, "$ for i in 1 2 3 4 5 6; do echo line $i; sleep 0.6; done");
  step("the next load names the command from its saved record", (await rows()).at(-1));
  assert.deepEqual(result.errors, []);
  const output = resolve("verification/local");
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "real-shell-acceptance.json"), JSON.stringify(result, null, 2));
} finally {
  await call(`/api/sessions/${id}/archive`, { cwd }).catch((error) => console.error(`Archive failed: ${error.message}`));
  cdp?.close(); chrome.kill("SIGTERM"); await sleep(300);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
