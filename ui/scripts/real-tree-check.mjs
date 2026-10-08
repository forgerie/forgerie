#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node
// Real-session check of the session tree. It never moves SESSION_ID: it forks
// SESSION_ID from its second user message, moves only the fork back to the
// first user message, then archives the fork. No prompt is sent and no model runs.
// SESSION_ID must be idle and hold at least two user messages.
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
const id = process.env.SESSION_ID;
assert.ok(id, "Set SESSION_ID");
const app = process.env.APP_URL ?? "http://127.0.0.1:8510/";
const out = resolve("verification/local/real-tree");
await mkdir(out, { recursive: true });

const api = (path) => new URL(`/api${path}`, app);
const catalog = await (await fetch(api("/sessions/all"))).json();
const session = catalog.sessions.find((item) => item.id === id);
assert.ok(session, "Session must exist");
const query = new URLSearchParams({ cwd: session.cwd });
const history = async (sessionId) => (await (await fetch(api(`/sessions/${sessionId}/messages?${query}`))).json()).total;
const originalTotal = await history(id);

const profile = await mkdtemp(join(tmpdir(), "aui-real-tree-"));
const port = await getFreePort();
const chromeBin = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout?.trim();
const chrome = launchChrome(chromeBin, port, profile);
const result = { session: id, originalTotal, errors: [] };
let forkId;
let cdp;
async function until(check, what, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (!(await evaluate(cdp, check))) {
    if (Date.now() >= deadline) {
      const status = await evaluate(cdp, `({ status: document.querySelector(".connection-status")?.textContent, error: document.querySelector(".notice, .tree-notice")?.textContent, url: location.href })`);
      assert.fail(`Timed out: ${what} ${JSON.stringify(status)}`);
    }
    await sleep(100);
  }
}
const connected = "document.querySelector('.connection-status')?.textContent === 'Connected'";
const openTree = async () => {
  await until(`${connected} && !document.querySelector('button[aria-label=\"Session tree\"]').disabled`, "idle session");
  await evaluate(cdp, "document.querySelector('button[aria-label=\"Session tree\"]').click()");
  await until("document.querySelectorAll('dialog.tree-dialog [role=treeitem]').length > 0", "tree rows");
};
const userRows = "[...document.querySelectorAll('dialog.tree-dialog [role=treeitem]')]";
const press = (label) => evaluate(cdp, `[...document.querySelectorAll('dialog.tree-dialog button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)}).click()`);
try {
  await waitForDebugger(port);
  cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES[2], colorScheme: "dark" });
  cdp.listeners.set("Runtime.exceptionThrown", [(event) => result.errors.push(event.exceptionDetails.text)]);
  await cdp.send("Page.navigate", { url: new URL(`/?session=${encodeURIComponent(id)}`, app).href });

  // 1. The tree opens on the user lens with the real history.
  await openTree();
  result.userRows = await evaluate(cdp, `${userRows}.length`);
  assert.ok(result.userRows >= 2, "need two user rows");
  const second = await evaluate(cdp, `${userRows}[1].querySelector('.tree-summary').textContent`);
  await cdp.send("Page.captureScreenshot", { format: "png" }).then(({ data }) => writeFile(join(out, "open.png"), Buffer.from(data, "base64")));

  // 2. Fork before the second user message: a new session opens with that message as its draft.
  await evaluate(cdp, `${userRows}[1].click()`);
  await press("Fork");
  await until(`new URLSearchParams(location.search).get('session') !== ${JSON.stringify(id)}`, "fork opened");
  forkId = await evaluate(cdp, "new URLSearchParams(location.search).get('session')");
  await until(connected, "fork connected");
  await until("document.querySelector('[data-composer-input]')?.value.length > 0", "fork draft");
  result.forkDraftMatches = second.startsWith((await evaluate(cdp, "document.querySelector('[data-composer-input]').value")).slice(0, 40).trimEnd());
  assert.ok(result.forkDraftMatches, "fork draft is the forked message");
  const forkTotal = await history(forkId);
  result.forkTotal = forkTotal;
  assert.ok(forkTotal < originalTotal, "fork holds less history than the original");

  // 3. In the fork only: continue from the first user message. Its text returns and the transcript reloads.
  await evaluate(cdp, "(() => { const t = document.querySelector('[data-composer-input]'); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await openTree();
  const first = await evaluate(cdp, `${userRows}[0].querySelector('.tree-summary').textContent`);
  await evaluate(cdp, `${userRows}[0].click()`);
  await press("Continue from here");
  await until("!document.querySelector('dialog.tree-dialog')", "navigator closed");
  await until("document.querySelector('[data-composer-input]')?.value.length > 0", "editor text returned");
  result.continueTextMatches = first.startsWith((await evaluate(cdp, "document.querySelector('[data-composer-input]').value")).slice(0, 40).trimEnd());
  assert.ok(result.continueTextMatches, "continued text is the first message");
  await until(connected, "fork reloaded");
  await until("document.querySelectorAll('.message').length === 0", "transcript moved to before the first message");
  await cdp.send("Page.captureScreenshot", { format: "png" }).then(({ data }) => writeFile(join(out, "continued.png"), Buffer.from(data, "base64")));

  // 4. The original never moved.
  result.originalAfter = await history(id);
  assert.equal(result.originalAfter, originalTotal, "original session history changed");
  assert.deepEqual(result.errors, []);
} finally {
  if (forkId && forkId !== id) {
    const archived = await fetch(api(`/sessions/${encodeURIComponent(forkId)}/archive`), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: session.cwd }) });
    result.forkArchived = archived.ok;
    result.forkId = forkId;
  }
  await writeFile(join(out, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  cdp?.close(); chrome.kill("SIGTERM"); await sleep(200);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
