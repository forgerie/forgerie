#!/usr/bin/env node
// Captures the radial menu mid-gesture across the Fold 8 posture matrix.
//
// The wheel exists only while a finger is down, so `capture-postures.mjs`
// cannot photograph it: a static shot of the shell proves the shell still
// renders and nothing more. This drives a real press-and-hold through the
// browser's own input pipeline, waits past the arm delay, slides to a wedge,
// and shoots the open wheel.
//
//   CHROME_BIN=$(command -v chromium) \
//     node scripts/capture-radial.mjs --url http://127.0.0.1:8505/ --out /tmp/radial
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  evaluate,
  findChrome,
  getFreePort,
  launchChrome,
  openPage,
  sleep,
  waitForDebugger,
} from "./lib/cdp.mjs";
import { FOLD8_POSTURES } from "./lib/fold8-postures.mjs";

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};

const url = readArg("--url", "http://127.0.0.1:8505/");
const outDir = readArg("--out", "/tmp/forgerie-radial");
/** Past ROW_PRESS.holdMs, with room for the render that follows it. */
const HOLD_MS = 800;

await mkdir(outDir, { recursive: true });

// `findChrome` probes with `sh -lc`, and a login shell does not inherit the
// PATH that `nix shell` sets up, so the override is how this runs on a Nix box.
const chromeBin = process.env["CHROME_BIN"] ?? findChrome();
if (chromeBin === undefined) throw new Error("No Chromium found. Set CHROME_BIN.");

const debugPort = await getFreePort();
const userDataDir = await mkdtemp(join(tmpdir(), "forgerie-radial-"));
const chrome = launchChrome(chromeBin, debugPort, userDataDir);

try {
  await waitForDebugger(debugPort);
  for (const posture of FOLD8_POSTURES) await capture(posture);
} finally {
  chrome.kill();
  // Chromium keeps writing its profile for a moment after the signal, so a
  // straight rm races it and throws ENOTEMPTY over a directory nobody needs.
  await sleep(500);
  await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
}

/**
 * Reports the open wheel, or names whatever swallowed the press.
 *
 * A refusal is a legitimate outcome — the wheel declines over the shell's own
 * chrome — so the failure path has to say which element took it. Otherwise a
 * blank result costs another run to investigate.
 */
function inspectScript(pressX, pressY) {
  return `(() => {
    const app = document.querySelector("pi-web-app");
    const menu = app && app.shadowRoot ? app.shadowRoot.querySelector("app-radial-menu") : null;
    if (!menu) {
      let node = document.elementFromPoint(${pressX}, ${pressY});
      const path = [];
      while (node && path.length < 4) {
        const cls = typeof node.className === "string" && node.className ? "." + node.className.split(" ")[0] : "";
        path.push(node.tagName.toLowerCase() + cls);
        node = node.parentElement;
      }
      return "no wheel - press landed on " + (path.join(" < ") || "nothing");
    }
    const root = menu.shadowRoot;
    const wedges = root.querySelectorAll(".wedge").length;
    const hubNode = root.querySelector(".hub");
    const hub = hubNode ? hubNode.textContent.trim() : "";
    const live = root.querySelector(".wedge.on:not(.off)") ? "live" : "reserved";
    return wedges + " wedges, hub: " + hub + " (" + live + ")";
  })()`;
}

async function capture(posture) {
  const cdp = await openPage(debugPort);

  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: posture.width,
    height: posture.height,
    deviceScaleFactor: 1,
    mobile: true,
    screenWidth: posture.width,
    screenHeight: posture.height,
  });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await cdp.send("Page.enable", {});
  await cdp.send("Page.navigate", { url });
  await sleep(4500);

  // Press low in the main area. The middle is where the empty state puts its
  // "new session" button, and the wheel declines over a button by design, so a
  // centred press photographs a refusal rather than the menu.
  const x = Math.round(posture.width * 0.62);
  const y = Math.round(posture.height * 0.74);

  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
  await sleep(HOLD_MS);
  // Straight left is slot zero, the inbox. It is the one wedge that is live
  // whether or not a workspace is selected, so the capture shows the chosen
  // state rather than the reserved one.
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - 90, y, id: 1 }] });
  await sleep(250);

  const state = await evaluate(cdp, inspectScript(x, y));

  const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(outDir, `radial-${posture.name}.png`), Buffer.from(shot.data, "base64"));

  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  console.log(`${posture.name.padEnd(20)} ${posture.width}x${posture.height}  ${state}`);
  cdp.close();
}
