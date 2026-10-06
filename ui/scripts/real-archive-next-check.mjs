#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node
// Real-session check of "Archive and next". It never archives SESSION_ID: it
// forks SESSION_ID into a throwaway session, opens the fork, presses
// "Archive and next", and checks that the fork is archived and the app moved
// to the next waiting session (or to the list). The fork stays archived.
// No prompt is sent and no model runs. SESSION_ID must be idle.
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
const out = resolve("verification/local/real-archive-next");
await mkdir(out, { recursive: true });

const api = (path) => new URL(`/api${path}`, app);
const post = async (path, body) => {
  const response = await fetch(api(path), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await response.json();
  assert.ok(response.ok, `${path}: ${JSON.stringify(json)}`);
  return json;
};
const catalog = async () => (await (await fetch(api("/sessions/all"))).json()).sessions;
const session = (await catalog()).find((item) => item.id === id);
assert.ok(session, "Session must exist");

// A throwaway fork at the original's current leaf.
const tree = await post(`/sessions/${id}/commands/run`, { cwd: session.cwd, text: "/tree" });
assert.equal(tree.type, "tree");
const leaf = tree.tree.activeLeafId;
const leafKind = tree.tree.nodes.find((node) => node.id === leaf)?.kind;
assert.ok(leaf && leafKind !== "user", "The original's current entry must not be a user message");
const fork = await post(`/sessions/${id}/tree/fork`, { cwd: session.cwd, entryId: leaf, expectedLeafId: leaf });
assert.equal(fork.cancelled, false);
const forkId = fork.session.id;
const result = { session: id, forkId, errors: [] };

const profile = await mkdtemp(join(tmpdir(), "aui-real-archive-"));
const port = await getFreePort();
const chromeBin = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout?.trim();
const chrome = launchChrome(chromeBin, port, profile);
let cdp;
async function until(check, what, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (!(await evaluate(cdp, check))) {
    if (Date.now() >= deadline) assert.fail(`Timed out: ${what} ${JSON.stringify(await evaluate(cdp, "({ url: location.href, status: document.querySelector('.connection-status')?.textContent })"))}`);
    await sleep(100);
  }
}
const shot = async (name) => { const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }); await writeFile(join(out, name), Buffer.from(data, "base64")); };
try {
  await waitForDebugger(port);
  cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES[2], colorScheme: "dark" });
  cdp.listeners.set("Runtime.exceptionThrown", [(event) => result.errors.push(event.exceptionDetails.text)]);
  await cdp.send("Page.navigate", { url: new URL(`/?session=${encodeURIComponent(forkId)}`, app).href });
  const button = "document.querySelector('button[aria-label=\"Archive and next\"]')";
  await until(`document.querySelector('.connection-status')?.textContent === 'Connected' && ${button} && !${button}.disabled`, "button ready");
  await shot("before.png");
  await evaluate(cdp, `${button}.click()`);
  await until(`new URLSearchParams(location.search).get('session') !== ${JSON.stringify(forkId)}`, "moved on");
  result.openedNext = await evaluate(cdp, "new URLSearchParams(location.search).get('session')");
  result.sheet = await evaluate(cdp, "document.querySelector('.app-shell')?.dataset.sheet");
  result.toast = await evaluate(cdp, "document.querySelector('.picker-toast')?.textContent ?? ''");
  assert.ok(result.toast.includes("Archived"), "undo offer shows");
  await sleep(400);
  await shot("after.png");
  result.forkArchived = (await catalog()).find((item) => item.id === forkId)?.archived === true;
  assert.equal(result.forkArchived, true, "fork archived");
  result.originalArchived = (await catalog()).find((item) => item.id === id)?.archived === true;
  assert.equal(result.originalArchived, false, "original untouched");
  assert.deepEqual(result.errors, []);
} finally {
  await writeFile(join(out, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  cdp?.close(); chrome.kill("SIGTERM"); await sleep(200);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
