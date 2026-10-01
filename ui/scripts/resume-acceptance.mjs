#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node
// Uses one model prompt in a scratch Pi session. A controlled bash producer
// keeps the run alive during reload and second-tab attachment. No existing
// session is prompted, and the browser must send no mutating API requests.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const repo = process.env.FORGERIE_ROOT ?? resolve("../..");
const { launchChrome, getFreePort, waitForDebugger, evaluate, sleep } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));
const api = process.env.API_URL ?? "http://127.0.0.1:8504";
const app = process.env.APP_URL ?? "http://127.0.0.1:8510/";
const cwd = await mkdtemp(join(tmpdir(), "forgerie-resume-"));
const profile = await mkdtemp(join(tmpdir(), "aui-resume-chrome-"));
const out = resolve("verification/local/resume");
await mkdir(out, { recursive: true });
const release = join(cwd, "release");
const producer = join(cwd, "producer.sh");
const invocations = join(cwd, "invocations");
await writeFile(producer, `#!/usr/bin/env nix
#! nix shell nixpkgs#bash --command bash
set -eu
printf 'started\\n' >> '${invocations}'
for tick in {1..180}; do
  printf 'resume progress %s\\n' "$tick"
  if [ -f '${release}' ]; then
    printf 'RESUME_PRODUCER_DONE\\n'
    exit 0
  fi
  sleep 1
done
exit 1
`, { mode: 0o755 });
const result = { sessionId: undefined, steps: [], mutations: [], errors: [], captures: [] };
const step = (name) => { result.steps.push(name); console.log(name); };
let id;
let chrome;
const tabs = [];
async function call(path, body) {
  const response = await fetch(api + path, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`);
  return response.json();
}
async function until(label, check, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(100);
  }
  throw new Error(`Timed out: ${label}`);
}
const query = () => new URLSearchParams({ cwd });
const status = () => call(`/api/sessions/${id}/status?${query()}`);
const history = () => call(`/api/sessions/${id}/messages?${query()}`);
const displayed = (cdp) => evaluate(cdp, `({
  status: document.querySelector('.connection-status')?.textContent,
  answer: [...document.querySelectorAll('.message-assistant .message-text')].map(node => node.textContent).join('\\n'),
  stop: !!document.querySelector('[aria-label="Stop generating"]'),
  overflow: document.documentElement.scrollWidth > innerWidth
})`);
async function open(port, posture, scheme) {
  const cdp = await openPosturePage({ debugPort: port, posture, colorScheme: scheme });
  tabs.push(cdp);
  await cdp.send("Network.enable");
  cdp.listeners.set("Runtime.exceptionThrown", [(event) => result.errors.push(event.exceptionDetails.text)]);
  cdp.listeners.set("Network.requestWillBeSent", [({ request }) => {
    if (request.method !== "GET" && new URL(request.url).pathname.startsWith("/api/")) result.mutations.push(request.url);
  }]);
  const url = new URL(app); url.searchParams.set("session", id);
  await cdp.send("Page.navigate", { url: url.href });
  await until("running session in new tab", async () => (await displayed(cdp)).status === "Running");
  return cdp;
}
try {
  const created = await call("/api/sessions", { cwd });
  id = created.id ?? created.sessionId;
  assert.ok(id, "Scratch session ID required");
  result.sessionId = id;
  await call(`/api/sessions/${id}/prompt`, { cwd, text:
    `This is an automated transport test. Use the bash tool exactly once to execute ${producer}. `
    + `Do not use other tools, do not edit files, and wait for that command to finish. `
    + `After it finishes, reply with exactly RESUME_ACCEPTANCE_OK.` });
  await until("producer started", async () => (await readFile(invocations, "utf8").catch(() => "")) === "started\n", 120_000);
  await until("scratch session persisted", async () => (await history()).messages.some((message) => message.role === "assistant"), 30_000);
  assert.equal((await status()).isStreaming, true);
  step("one scratch prompt started a server-owned producer");
  const chromeBin = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout?.trim();
  assert.ok(chromeBin, "Chromium is required");
  const port = await getFreePort();
  chrome = launchChrome(chromeBin, port, profile);
  await waitForDebugger(port);
  const primary = await open(port, FOLD8_POSTURES[2], "dark");
  assert.equal((await displayed(primary)).stop, true);
  const reloaded = primary.waitForEvent("Page.loadEventFired", 20_000);
  await primary.send("Page.reload", { ignoreCache: true });
  await reloaded;
  await until("reload resumes same running session", async () => (await displayed(primary)).status === "Running");
  assert.equal((await displayed(primary)).stop, true);
  step("reload attached to the active run without another prompt");
  const follower = await open(port, FOLD8_POSTURES[0], "light");
  assert.equal((await displayed(follower)).stop, true);
  step("second tab attached independently");
  await primary.send("Page.navigate", { url: "about:blank" });
  assert.equal((await status()).isStreaming, true);
  assert.equal((await displayed(follower)).status, "Running");
  step("closing the first reader did not cancel the producer");
  // Use the same real viewport harness as capture-postures.mjs. These are
  // independent readers in every posture/theme, not API interception fixtures.
  for (const scheme of ["dark", "light"]) {
    for (const posture of FOLD8_POSTURES) {
      const tab = await open(port, posture, scheme);
      assert.equal((await displayed(tab)).overflow, false);
      await evaluate(tab, `document.fonts.ready.then(() => true)`);
      const path = join(out, `${posture.name}-${scheme}.png`);
      const { data } = await tab.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
      await writeFile(path, Buffer.from(data, "base64"));
      result.captures.push(path);
      await tab.send("Page.navigate", { url: "about:blank" });
    }
  }
  await writeFile(release, "finish\n");
  await until("producer and assistant finished", async () => !(await status()).isStreaming, 120_000);
  await until("follower saw the final answer", async () => {
    const state = await displayed(follower);
    return state.status === "Connected" && state.answer.includes("RESUME_ACCEPTANCE_OK");
  });
  const finishedReload = follower.waitForEvent("Page.loadEventFired", 20_000);
  await follower.send("Page.reload", { ignoreCache: true });
  await finishedReload;
  await until("finished run reload uses persisted history", async () => {
    const state = await displayed(follower);
    return state.status === "Connected" && state.answer.includes("RESUME_ACCEPTANCE_OK") && !state.stop;
  });
  const messages = (await history()).messages;
  assert.equal(messages.filter((message) => message.role === "user").length, 1);
  assert.equal(messages.filter((message) => message.role === "toolResult").length, 1);
  assert.equal(await readFile(invocations, "utf8"), "started\n");
  assert.deepEqual(result.mutations, []);
  assert.deepEqual(result.errors, []);
  step("follower and reload received the final answer; server persisted one tool result");
} finally {
  try {
    await writeFile(release, "finish\n");
    if (id) {
      if ((await status()).isStreaming) await call(`/api/sessions/${id}/abort`, { cwd });
      await until("scratch session idle for archive", async () => !(await status()).isStreaming);
      await call(`/api/sessions/${id}/archive`, { cwd });
    }
  } finally {
    // A backend cleanup failure must still stop Chromium and save this run's
    // evidence. Leave the API error observable instead of reporting success.
    for (const tab of tabs) tab.close();
    chrome?.kill("SIGTERM");
    try {
      await writeFile(join(out, "result.json"), JSON.stringify(result, null, 2));
    } finally {
      await sleep(300);
      if (chrome && chrome.exitCode === null) chrome.kill("SIGKILL");
      await Promise.all([rm(profile, { recursive: true, force: true }), rm(cwd, { recursive: true, force: true })]);
    }
  }
}
