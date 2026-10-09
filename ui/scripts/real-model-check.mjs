#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Model and thinking level against the real Forgerie API. It creates its own
// scratch session in a temp folder and archives it afterwards. One short
// prompt makes Pi save the session so the catalog lists it; that prompt costs
// normal model usage. Changing the model and level costs nothing.
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
const cwd = await mkdtemp(join(tmpdir(), "forgerie-model-e2e-"));
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

const session = await call("/api/sessions", { cwd });
const id = session.id ?? session.sessionId;
assert.ok(id, `No session id in ${JSON.stringify(session)}`);
step("created scratch session", { id });
await call(`/api/sessions/${id}/prompt`, { cwd, text: "Automated UI test. Reply with the single word OK and do nothing else." });
await waitUntil("session listed", async () => (await call("/api/sessions/all")).sessions.some((s) => s.id === id));
await waitUntil("first run ends", async () => !(await status(id)).isStreaming);
const { models } = await call(`/api/sessions/${id}/models?${query()}`);
const before = await status(id);
const target = models.find((model) => model.reasoning === true && !(model.provider === before.model?.provider && model.id === before.model?.id));
assert.ok(target, "No second reasoning model to switch to");

const profile = await mkdtemp(join(tmpdir(), "aui-real-model-"));
const port = await getFreePort();
const chrome = launchChrome(process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim(), port, profile);
let cdp;
try {
  await waitForDebugger(port);
  cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES.find((p) => p.name === "folded-portrait"), colorScheme: "dark" });
  cdp.listeners.set("Runtime.exceptionThrown", [(event) => result.errors.push(event.exceptionDetails.text)]);
  const until = (expression, timeoutMs = 30_000) => waitUntil(expression, () => evaluate(cdp, expression), timeoutMs)
    .catch(async (error) => { throw new Error(`${error.message}\nPage: ${await evaluate(cdp, "document.body.innerText.slice(-800)")}`); });
  const trigger = () => evaluate(cdp, "document.querySelector('.model-trigger').textContent");
  const open = async () => {
    const url = new URL(app); url.searchParams.set("session", id);
    await cdp.send("Page.navigate", { url: url.href });
    await until("document.querySelector('.connection-status')?.textContent === 'Connected' && !!document.querySelector('.model-trigger')");
  };
  await open();
  assert.ok((await trigger()).includes(before.model.name ?? before.model.id), `trigger: ${await trigger()}`);
  step("the trigger names Pi's model and level", { trigger: await trigger(), model: before.model.id, level: before.thinkingLevel });

  await evaluate(cdp, "document.querySelector('.model-trigger').click()");
  await until("!!document.querySelector('.floating-panel .option-row') && document.querySelectorAll('.model-levels button').length > 1");
  const rows = await evaluate(cdp, "document.querySelectorAll('.option-row').length");
  assert.equal(rows, models.filter((model) => model.provider && model.id).length);
  const levels = await evaluate(cdp, "[...document.querySelectorAll('.model-levels button')].map(button => button.textContent)");
  step("the panel lists every model Pi offers, and the current model's levels", { rows, levels });

  const low = await evaluate(cdp, "(() => { const button = [...document.querySelectorAll('.model-levels button')].find(button => button.getAttribute('aria-pressed') === 'false'); button.click(); return button.textContent; })()");
  await waitUntil("level saved", async () => (await status(id)).thinkingLevel !== before.thinkingLevel);
  await until(`document.querySelector('.model-trigger').textContent.includes(${JSON.stringify(low)})`);
  step("a level change reached Pi and the trigger follows", { level: (await status(id)).thinkingLevel, trigger: await trigger() });

  await evaluate(cdp, `[...document.querySelectorAll('.option-row')].find(row => row.querySelector('.option-row-name').textContent.startsWith(${JSON.stringify((target.name ?? target.id).replace(/ \(latest\)$/, ""))}))?.click()`);
  await waitUntil("model saved", async () => (await status(id)).model?.id === target.id);
  await until("!document.querySelector('.floating-panel')");
  step("a model change reached Pi and closed the panel", { model: (await status(id)).model.id, trigger: await trigger() });

  await open();
  const after = await status(id);
  assert.ok((await trigger()).includes((after.model.name ?? after.model.id).replace(/ \(latest\)$/, "")));
  step("a reload shows Pi's saved choice", { trigger: await trigger() });

  assert.deepEqual(result.errors, []);
  const output = resolve("verification/local");
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "real-model-check.json"), JSON.stringify(result, null, 2));
} finally {
  await call(`/api/sessions/${id}/archive`, { cwd }).catch((error) => console.error(`Archive failed: ${error.message}`));
  cdp?.close(); chrome.kill("SIGTERM"); await sleep(300);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
