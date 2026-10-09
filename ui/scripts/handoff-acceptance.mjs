#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Fixture-only: checks handoff and spawn doors with real input in every Fold
// posture and theme. Calls no API and costs no model replies.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { hitRect } from "./lib/hit.mjs";
const repo = process.env.FORGERIE_ROOT ?? resolve("../..");
const { getFreePort, launchChrome, sleep, waitForDebugger, evaluate } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));
const base = process.env.HANDOFF_URL ?? "http://127.0.0.1:8517";
const chromeBin = process.env.CHROME_BIN ?? execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
const profile = await mkdtemp(join(tmpdir(), "aui-handoff-browser-"));
const port = await getFreePort();
const chrome = launchChrome(chromeBin, port, profile);
const errors = [];
const apiRequests = [];
const results = [];

async function wait(check, what, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await sleep(50); }
  throw new Error(`Timed out: ${what}`);
}
async function open(posture, scheme) {
  const cdp = await openPosturePage({ debugPort: port, posture, colorScheme: scheme });
  await cdp.send("Network.enable");
  cdp.listeners.set("Runtime.exceptionThrown", [({ exceptionDetails }) => errors.push(exceptionDetails.exception?.description ?? exceptionDetails.text)]);
  cdp.listeners.set("Network.requestWillBeSent", [({ request }) => {
    if (new URL(request.url).pathname.startsWith("/api/")) apiRequests.push(request.url);
  }]);
  const loaded = cdp.waitForEvent("Page.loadEventFired", 20000);
  await cdp.send("Page.navigate", { url: `${base}/verification/preview.html?scenario=handoff` });
  await loaded;
  return cdp;
}
// Geometry of each door: its line, its button, and the button's hit rectangle.
const doors = (cdp) => evaluate(cdp, `(() => {
  const hit = ${hitRect};
  const column = document.querySelector(".thread-column").getBoundingClientRect();
  return [...document.querySelectorAll(".session-door")].map((door) => {
    const summary = door.querySelector(":scope > details > summary").getBoundingClientRect();
    const button = door.querySelector(".session-door-open");
    const box = button.getBoundingClientRect();
    const label = button.querySelector("span");
    return { text: button.textContent, title: button.title, line: door.querySelector(".trace-text").textContent,
      sameRow: Math.abs(box.top - summary.top) < 2, inside: box.left >= column.left - 0.5 && box.right <= column.right + 0.5,
      labelClipped: label.scrollWidth > label.clientWidth + 1, hit: hit(button), drawnHeight: box.height,
      x: box.left + box.width / 2, y: box.top + box.height / 2 };
  });
})()`);
async function tap(cdp, x, y) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}
const opened = (cdp) => evaluate(cdp, `document.documentElement.dataset.openedSession ?? null`);

try {
  await waitForDebugger(port);
  for (const scheme of ["light", "dark"]) {
    for (const posture of FOLD8_POSTURES) {
      const name = `${scheme}-${posture.name}`;
      const cdp = await open(posture, scheme);
      await wait(() => evaluate(cdp, `document.querySelectorAll(".session-door").length === 2`), `${name}: two doors`);
      const overflow = await evaluate(cdp, `(() => { const t = document.querySelector(".transcript"); return t.scrollWidth > t.clientWidth + 1; })()`);
      assert.equal(overflow, false, `${name}: no horizontal overflow`);

      // The failed handoff earns no door and stays counted in its activity.
      const failed = await evaluate(cdp, `[...document.querySelectorAll("details.chain-of-thought > summary .trace-label")].map((n) => n.textContent)`);
      assert.ok(failed.includes("reasoning, 1 failed"), `${name}: the failed handoff stays in the activity (${failed})`);

      const before = await doors(cdp);
      assert.deepEqual(before.map((door) => door.text), ["Open session", "Open in forgerie-documentation-site"], `${name}: door labels`);
      assert.equal(before[1].title, "Open the created session in /home/simon/code/forgerie-documentation-site", `${name}: full workspace path`);
      for (const [index, door] of before.entries()) {
        assert.equal(door.sameRow, true, `${name}: door ${index} sits on its tool line`);
        assert.equal(door.inside, true, `${name}: door ${index} stays inside the column`);
        assert.ok(door.hit.height >= 43.5 && door.hit.width >= 43.5, `${name}: door ${index} keeps a full touch target (${door.hit.width}x${door.hit.height})`);
      }

      // A real pointer press opens the session; Enter opens the other.
      await evaluate(cdp, `document.querySelectorAll(".session-door")[0].scrollIntoView({ block: "center" })`);
      const [first] = await doors(cdp);
      await tap(cdp, first.x, first.y);
      await wait(async () => (await opened(cdp)) === "01a0f7f2", `${name}: pointer opens the handoff session`);
      await evaluate(cdp, `document.querySelectorAll(".session-door-open")[1].focus()`);
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await wait(async () => (await opened(cdp)) === "01a0f801", `${name}: Enter opens the spawned session`);

      // Expanding the call keeps the door beside its line and the body inside the column.
      await evaluate(cdp, `(() => { const d = document.querySelector(".session-door > details"); d.open = true; })()`);
      await wait(() => evaluate(cdp, `document.querySelectorAll(".session-door .trace-pre").length === 2`), `${name}: call body opens`);
      const expanded = await evaluate(cdp, `(() => {
        const column = document.querySelector(".thread-column").getBoundingClientRect();
        return [...document.querySelectorAll(".session-door .trace-pre")].every((pre) => pre.getBoundingClientRect().right <= column.right + 0.5);
      })()`);
      assert.equal(expanded, true, `${name}: expanded body stays inside the column`);
      const after = await doors(cdp);
      assert.equal(after[0].sameRow, true, `${name}: door stays on its line while expanded`);

      results.push({ name, labelClipped: before.map((door) => door.labelClipped), drawnHeight: before[0].drawnHeight });
      cdp.close();
    }
  }
  assert.deepEqual(apiRequests, [], "the fixture must never call the API");
  assert.deepEqual(errors, [], "no page exceptions");
  console.log(JSON.stringify(results, null, 2));
  console.log("handoff acceptance: passed");
} finally {
  chrome.kill();
  // Chromium can still be writing its profile just after the kill.
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
