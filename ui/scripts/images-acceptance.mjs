#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Fixture-only: drives the reply gallery and image viewer with real input in
// every Fold posture and theme. Calls no API and costs no model replies.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const repo = process.env.FORGERIE_ROOT ?? resolve("../..");
const { getFreePort, launchChrome, sleep, waitForDebugger, evaluate } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));
const base = process.env.IMAGES_URL ?? "http://127.0.0.1:8516";
const chromeBin = process.env.CHROME_BIN ?? execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
const profile = await mkdtemp(join(tmpdir(), "aui-images-browser-"));
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
  await cdp.send("Page.navigate", { url: `${base}/verification/preview.html?scenario=images` });
  await loaded;
  return cdp;
}
const viewer = (cdp) => evaluate(cdp, `(() => {
  const d = document.querySelector("dialog.image-viewer");
  if (!d?.open) return null;
  const img = d.querySelector(".viewer-stage img");
  const controls = [...d.querySelectorAll("button")].map((b) => b.getBoundingClientRect());
  return { count: d.querySelector(".viewer-count").textContent, caption: d.querySelector(".viewer-caption").textContent,
    scale: d.querySelector(".viewer-scale").textContent, transform: img.style.transform,
    controlsInside: controls.every((r) => r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight),
    pageScale: visualViewport.scale, focus: document.activeElement?.getAttribute("aria-label") };
})()`);
const stageCentre = (cdp) => evaluate(cdp, `(() => { const r = document.querySelector(".viewer-stage").getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);

try {
  await waitForDebugger(port);
  for (const scheme of ["light", "dark"]) {
    for (const posture of FOLD8_POSTURES) {
      const name = `${scheme}-${posture.name}`;
      const cdp = await open(posture, scheme);
      await wait(() => evaluate(cdp, `document.querySelectorAll(".image-gallery").length === 2`), `${name}: galleries`);
      // The last gallery is the seven-image reply.
      const gallery = await evaluate(cdp, `(() => {
        const g = [...document.querySelectorAll(".image-gallery")].at(-1);
        g.scrollIntoView({ block: "center" });
        const grid = g.querySelector(".gallery-grid");
        const tiles = [...grid.querySelectorAll(".gallery-tile")];
        const more = grid.querySelector(".gallery-more");
        return { tiles: tiles.length, more: more?.getAttribute("aria-label") ?? null,
          minTile: Math.min(...tiles.map((t) => t.getBoundingClientRect().width)),
          overflows: grid.scrollWidth > grid.clientWidth + 1, rows: new Set(tiles.map((t) => Math.round(t.getBoundingClientRect().top))).size };
      })()`);
      assert.equal(gallery.overflows, false, `${name}: gallery stays inside its column`);
      assert.equal(gallery.rows, 1, `${name}: one row of tiles`);
      assert.ok(gallery.minTile >= 95.5, `${name}: tiles keep the minimum size (${gallery.minTile})`);
      const hidden = 7 - (gallery.more ? gallery.tiles - 1 : gallery.tiles);
      assert.equal(gallery.more, hidden > 0 ? `Show ${hidden} more images` : null, `${name}: overflow tile names what it hides`);

      // The overflow tile opens the first hidden image, in the full set.
      const opener = gallery.more ?? "Open unfolded-portrait.png";
      await evaluate(cdp, `(() => { const b = document.querySelector('[aria-label=${JSON.stringify(opener)}]'); b.focus(); b.click(); })()`);
      await wait(async () => (await viewer(cdp)) !== null, `${name}: viewer opens`);
      let state = await viewer(cdp);
      assert.equal(state.count, `${gallery.more ? 7 - hidden + 1 : 1} of 7`, `${name}: opens at the chosen image`);
      assert.equal(state.controlsInside, true, `${name}: every viewer control is inside the window`);

      // Wheel zoom uses its own non-passive listener; the page must not zoom.
      const centre = await stageCentre(cdp);
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: centre.x, y: centre.y, deltaX: 0, deltaY: -300 });
      await wait(async () => (await viewer(cdp)).scale !== "100%", `${name}: wheel zoom`);
      // A real two-finger pinch zooms the image, never the page.
      await evaluate(cdp, `document.querySelector('[aria-label="Reset zoom"]').click()`);
      await cdp.send("Input.synthesizePinchGesture", { x: centre.x, y: centre.y, scaleFactor: 2.5, gestureSourceType: "touch" });
      state = await viewer(cdp);
      assert.notEqual(state.scale, "100%", `${name}: pinch zooms the image`);
      assert.equal(state.pageScale, 1, `${name}: pinch never zooms the page`);

      // A one-finger swipe left moves to the next image once zoom is reset.
      await evaluate(cdp, `document.querySelector('[aria-label="Reset zoom"]').click()`);
      const before = (await viewer(cdp)).count;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: centre.x + 80, y: centre.y }] });
      for (let step = 1; step <= 6; step++) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: centre.x + 80 - step * 30, y: centre.y }] });
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await sleep(100);
      state = await viewer(cdp);
      assert.ok(state, `${name}: the swipe did not close the viewer`);
      const expected = Number(before.split(" ")[0]) < 7 ? `${Number(before.split(" ")[0]) + 1} of 7` : before;
      assert.equal(state.count, expected, `${name}: swipe moves to the next image`);

      // Escape closes and returns focus to the opener.
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await wait(async () => (await viewer(cdp)) === null, `${name}: Escape closes`);
      const focus = await evaluate(cdp, `document.activeElement?.getAttribute("aria-label")`);
      assert.equal(focus, opener, `${name}: focus returns to the opener`);
      results.push({ name, tiles: gallery.tiles, hidden, minTile: Math.round(gallery.minTile) });
      cdp.close();
    }
  }
  assert.deepEqual(apiRequests, [], "the fixture must never call the API");
  assert.deepEqual(errors, [], "no page exceptions");
  console.log(JSON.stringify(results, null, 2));
  console.log("images acceptance: passed");
} finally {
  chrome.kill();
  await rm(profile, { recursive: true, force: true });
}
