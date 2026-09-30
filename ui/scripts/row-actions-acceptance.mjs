// Row-actions acceptance against the live dev server (8510 -> 8504).
//
// Writes only to its own scratch session: it creates one in a temp directory,
// prompts it once so the catalog lists it ("Reply with OK"), then drives the
// picker's row commands on that row alone. It ends by deleting the scratch
// session for good through the picker, so nothing is left in the user's list.
// Every non-GET /api request the page sends is checked against the scratch id.
//   CHROME_BIN=$(command -v chromium) node scripts/row-actions-acceptance.mjs
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const repo = process.env.FORGERIE_ROOT ?? resolve("../..");
const { getFreePort, launchChrome, sleep, waitForDebugger, evaluate } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));

const api = process.env.API_URL ?? "http://127.0.0.1:8504";
const base = process.env.PICKER_URL ?? "http://127.0.0.1:8510/";
const chromeBin = process.env.CHROME_BIN;
if (!chromeBin) throw new Error("Set CHROME_BIN");
const out = "verification/local/row-actions";
await mkdir(out, { recursive: true });

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
    await sleep(200);
  }
}
const listed = async (id) => (await call("/api/sessions/all")).sessions.find((s) => s.id === id);

const cwd = await mkdtemp(join(tmpdir(), "forgerie-row-actions-"));
const created = await call("/api/sessions", { cwd });
const id = created.id ?? created.sessionId;
assert.ok(id, `No session id in ${JSON.stringify(created)}`);
console.log("scratch session", id, cwd);
await call(`/api/sessions/${id}/prompt`, { cwd, text: "This is an automated UI test. Reply with the single word OK and nothing else." });
await waitUntil("scratch run ends and is listed", async () => !(await call(`/api/sessions/${id}/status?${new URLSearchParams({ cwd })}`)).isStreaming && await listed(id), 120_000);

const userDataDir = await mkdtemp(join(tmpdir(), "row-actions-"));
const port = await getFreePort();
const chrome = launchChrome(chromeBin, port, userDataDir);
const writes = [];
const errors = [];
const steps = [];
const step = (name, detail = {}) => { steps.push({ name, ...detail }); console.log(name, JSON.stringify(detail)); };
let deleted = false;
try {
  await waitForDebugger(port);
  const open = async (posture, colorScheme, url = base) => {
    const cdp = await openPosturePage({ debugPort: port, posture, colorScheme });
    await cdp.send("Network.enable");
    cdp.listeners.set("Runtime.exceptionThrown", [(event) => errors.push(`${posture.name}: ${event.exceptionDetails.text}`)]);
    cdp.listeners.set("Network.requestWillBeSent", [({ request }) => {
      const path = new URL(request.url).pathname;
      if (request.method !== "GET" && path.startsWith("/api/")) writes.push({ method: request.method, path, body: request.postData });
    }]);
    const loaded = cdp.waitForEvent("Page.loadEventFired", 20000).catch(() => undefined);
    await cdp.send("Page.navigate", { url });
    await loaded;
    return cdp;
  };
  const ready = async (cdp, predicate, what, tries = 100) => {
    for (let i = 0; i < tries; i += 1) { if (await evaluate(cdp, predicate)) return; await sleep(100); }
    throw new Error(`${what} never happened`);
  };
  const row = `document.querySelector('[data-session="${id}"]')`;
  const menuLabels = (cdp) => evaluate(cdp, `[...document.querySelectorAll('#picker-menu-${id} [role="menuitem"]')].map((b) => b.textContent)`);
  const clickItem = (cdp, command) => evaluate(cdp, `document.querySelector('#picker-menu-${id} [data-command="${command}"]').click()`);
  const shot = async (cdp, name) => {
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(out, `${name}.png`), Buffer.from(data, "base64"));
  };
  /** A real right click at the row's centre, through the browser's input pipeline. */
  const rightClick = async (cdp) => {
    const { x, y } = await evaluate(cdp, `(() => { const r = ${row}.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    for (const type of ["mousePressed", "mouseReleased"]) await cdp.send("Input.dispatchMouseEvent", { type, x, y, button: "right", clickCount: 1 });
  };
  const scrollToRow = (cdp) => evaluate(cdp, `(${row}.scrollIntoView({ block: "center" }), true)`);

  // 1. Menu and undo line at every posture and scheme: archive, then Undo.
  for (const colorScheme of ["dark", "light"]) {
    for (const posture of FOLD8_POSTURES) {
      const cdp = await open(posture, colorScheme);
      await ready(cdp, `!!${row}`, `${posture.name}: scratch row`);
      await scrollToRow(cdp);
      await rightClick(cdp);
      await ready(cdp, `!!document.getElementById("picker-menu-${id}")`, `${posture.name}: menu by right click`);
      const labels = await menuLabels(cdp);
      assert.deepEqual(labels, ["Pin to top", "ArchiveE", "Copy workspace path"], `${posture.name} menu`);
      const selectedAfterRightClick = await evaluate(cdp, `new URLSearchParams(location.search).get("session")`);
      assert.equal(selectedAfterRightClick, null, "right click must not open the session");
      await shot(cdp, `${posture.name}-${colorScheme}-menu`);
      await clickItem(cdp, "archive");
      await ready(cdp, `document.querySelector(".picker-toast")?.textContent.includes("Archived")`, `${posture.name}: undo line`);
      await shot(cdp, `${posture.name}-${colorScheme}-undo`);
      // Undo first: the offer lasts 5 s, and reading the 2.7 MB catalog to check the server can take longer.
      await evaluate(cdp, `document.querySelector(".picker-toast-undo").click()`);
      assert.ok(writes.some((write) => write.path === `/api/sessions/${id}/archive`), "archive request sent");
      await ready(cdp, `!!${row} && !document.querySelector(".picker-toast")`, `${posture.name}: undo restores the row`);
      await waitUntil("server restored", async () => (await listed(id))?.archived !== true, 5000);
      step("menu, archive, undo", { posture: posture.name, colorScheme });
      cdp.close();
    }
  }

  // 2. The full command set at folded portrait, the tightest posture.
  const posture = FOLD8_POSTURES.find((p) => p.name === "folded-portrait");
  const cdp = await open(posture, "dark");
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await ready(cdp, `!!${row}`, "scratch row");
  await scrollToRow(cdp);

  // A real touch hold opens the menu, and its release does not open the session.
  const { x, y } = await evaluate(cdp, `(() => { const r = ${row}.getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 }; })()`);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await sleep(800);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await ready(cdp, `!!document.getElementById("picker-menu-${id}")`, "menu by touch hold");
  await sleep(300);
  assert.equal(await evaluate(cdp, `new URLSearchParams(location.search).get("session")`), null, "a hold must not open the session");
  step("touch hold opens the menu without opening the session");

  await clickItem(cdp, "pin");
  await ready(cdp, `!!document.querySelector('[data-kind="pinned"] [data-session="${id}"]')`, "row moves to Pinned");
  assert.equal((await listed(id))?.pinned, true, "server pinned");
  await scrollToRow(cdp);
  await rightClick(cdp);
  await ready(cdp, `!!document.getElementById("picker-menu-${id}")`, "pinned menu");
  assert.deepEqual(await menuLabels(cdp), ["Unpin", "Copy workspace path"], "pinned menu");
  await shot(cdp, "folded-portrait-dark-pinned-menu");
  await clickItem(cdp, "unpin");
  await ready(cdp, `!!${row} && !document.querySelector('[data-kind="pinned"] [data-session="${id}"]')`, "row leaves Pinned");
  assert.notEqual((await listed(id))?.pinned, true, "server unpinned");
  step("pin and unpin");

  await scrollToRow(cdp);
  await rightClick(cdp);
  await ready(cdp, `!!document.getElementById("picker-menu-${id}")`, "menu for copy");
  await clickItem(cdp, "copyPath");
  await ready(cdp, `!!document.querySelector(".picker-toast")`, "copy result");
  const copied = await evaluate(cdp, `document.querySelector(".picker-toast").textContent`);
  // Headless Chromium has no system clipboard, so either result is recorded;
  // the refusal must still hand over the path.
  assert.ok(copied.includes("Copied workspace path") || copied.includes(cwd), `copy result names neither success nor the path: ${copied}`);
  step("copy workspace path", { toast: copied });
  await evaluate(cdp, `document.querySelector('.picker-toast [aria-label="Dismiss"]').click()`);

  // Open the session, then archive it with E from the list.
  await evaluate(cdp, `${row}.click()`);
  await ready(cdp, `new URLSearchParams(location.search).get("session") === "${id}"`, "session opens");
  await evaluate(cdp, `document.querySelector(".app-opener").click()`);
  await ready(cdp, `document.querySelector(".app-shell")?.dataset.sheet === "open"`, "sheet reopens");
  await evaluate(cdp, `(document.querySelector('[role="listbox"]').focus(), document.querySelector('[role="listbox"]').dispatchEvent(new KeyboardEvent("keydown", { key: "e", bubbles: true })), true)`);
  await ready(cdp, `document.querySelector(".picker-toast")?.textContent.includes("Archived")`, "E archives");
  assert.equal((await listed(id))?.archived, true, "server archived by E");
  step("E archives the open session");

  // The undo line leaves by itself after five seconds.
  await sleep(5600);
  assert.equal(await evaluate(cdp, `!!document.querySelector(".picker-toast")`), false, "undo line expires");
  step("undo line expires after 5 s");

  // Show archived, restore from the menu, archive again, then delete for good.
  await evaluate(cdp, `document.querySelector('[role="listbox"]').dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }))`);
  await ready(cdp, `!!document.querySelector('[data-kind="archived"] [data-session="${id}"]')`, "archived row shown");
  await scrollToRow(cdp);
  await rightClick(cdp);
  await ready(cdp, `!!document.getElementById("picker-menu-${id}")`, "archived menu");
  assert.deepEqual(await menuLabels(cdp), ["Restore", "Delete permanently", "Copy workspace path"], "archived menu");
  await clickItem(cdp, "restore");
  await ready(cdp, `!!${row} && !document.querySelector('[data-kind="archived"] [data-session="${id}"]')`, "restored row");
  assert.notEqual((await listed(id))?.archived, true, "server restored");
  step("restore from the menu");

  await scrollToRow(cdp);
  await rightClick(cdp);
  await ready(cdp, `!!document.getElementById("picker-menu-${id}")`, "menu before second archive");
  await clickItem(cdp, "archive");
  await ready(cdp, `!!document.querySelector('[data-kind="archived"] [data-session="${id}"]')`, "archived again");
  await scrollToRow(cdp);
  await rightClick(cdp);
  await ready(cdp, `!!document.getElementById("picker-menu-${id}")`, "delete menu");
  await clickItem(cdp, "delete");
  assert.equal(await evaluate(cdp, `document.querySelector('#picker-menu-${id} [data-command="delete"]').textContent`), "Delete for good?", "delete asks twice");
  assert.equal(await listed(id) !== undefined, true, "first press deletes nothing");
  await shot(cdp, "folded-portrait-dark-delete-confirm");
  await clickItem(cdp, "delete");
  await ready(cdp, `!${row}`, "row removed");
  await waitUntil("server deleted", async () => (await listed(id)) === undefined, 5000);
  deleted = true;
  assert.equal(await evaluate(cdp, `new URLSearchParams(location.search).get("session")`), null, "deleting the open session closes it");
  await shot(cdp, "folded-portrait-dark-deleted");
  step("delete asks twice, removes the row and the session, and closes it");
  cdp.close();
} finally {
  chrome.kill();
  await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  if (!deleted) {
    // Keep the scratch session out of the user's list whatever failed.
    await call(`/api/sessions/${id}/unpin`, { cwd }).catch(() => {});
    await call(`/api/sessions/${id}/archive`, { cwd }).catch(() => {});
    await call("/api/sessions/bulk/delete-archived", { sessions: [{ id, cwd }] }).catch((error) => console.error(`Cleanup failed: ${error.message}`));
  }
  await rm(cwd, { recursive: true, force: true }).catch(() => {});
}
const foreign = writes.filter((write) => !write.path.includes(id) && !(write.body ?? "").includes(id));
const failures = [
  ...errors.map((error) => `page exception ${error}`),
  ...foreign.map((write) => `write outside the scratch session: ${write.method} ${write.path}`),
];
await writeFile(join(out, "result.json"), JSON.stringify({ id, steps, writes, failures }, null, 2));
console.log(JSON.stringify({ steps: steps.length, writes: writes.length, failures }, null, 1));
process.exit(failures.length ? 1 : 0);
