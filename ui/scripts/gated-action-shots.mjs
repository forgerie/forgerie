#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Capture the gated action card's Caliper parts at the four Fold 8 postures, in the dark and light schemes.
// caliper-render draws one scheme; this loads the same frames (/__caliper/frame) with the scheme emulated.
// Each capture reports whether the page spills sideways, which no state may.
// A `#Pinned…` state is also set inside a stand-in for the session pane: a size container the height of the screen, with
// the header's and the composer's room around the dock, as the session lays it out. The dock then takes its real share
// of the height, and the capture reports whether Approve and run is inside the dock's visible area without a scroll.
// Run from ui/ with the Caliper dev server up (scripts/caliper-dev.mjs):
//   APP_URL=http://localhost:5173/ scripts/gated-action-shots.mjs
// PARTS ("file#State file#State ..."), SCHEMES and POSTURES narrow the run. One image pixel is one CSS pixel.
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
const repo = process.env.FORGERIE_ROOT ?? resolve("..");
const { launchChrome, getFreePort, waitForDebugger, evaluate, sleep } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));
const out = resolve(process.env.OUT ?? "verification/local/gated-actions");
await mkdir(out, { recursive: true });
const base = process.env.APP_URL ?? "http://localhost:5173/";
const card = "src/gatedActions/GatedActionCard.organism.part.tsx";
const parts = (process.env.PARTS ?? [
  ...["default", "LongCommand", "MessageInYourName", "Approving", "ChoiceFailed", "Running", "Ran", "Failed", "Refused", "ReadOnly", "Gone", "Pinned", "PinnedLongCommand"]
    .map((state) => `${card}#${state}`),
  "src/ui/CommandBlock.molecule.part.tsx#default",
  "src/ui/CommandBlock.molecule.part.tsx#LongCommand",
  "src/ui/CommandBlock.molecule.part.tsx#CutOutput",
  "src/ui/DecisionCard.molecule.part.tsx#PinnedChoices",
  "src/ui/DecisionCard.molecule.part.tsx#ClosedFailed",
].join(" ")).split(" ");
const schemes = (process.env.SCHEMES ?? "dark,light").split(",");
const postures = (process.env.POSTURES ?? FOLD8_POSTURES.map((posture) => posture.name).join(",")).split(",");
const profile = await mkdtemp(join(tmpdir(), "gated-shots-"));
const port = await getFreePort();
const chrome = launchChrome(process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim(), port, profile);
const overflow = `(() => ({ page: document.documentElement.scrollWidth > document.documentElement.clientWidth }))()`;
// The session pane around the dock: .session-shell is the app's own size container (theme.css). The header keeps its
// token height; the composer's room is a stand-in of a resting composer's height. The transcript takes what is left.
const inShell = `(() => {
  const dock = document.querySelector('.pinned-dock');
  if (!dock) return false;
  const shell = document.createElement('div');
  shell.className = 'session-shell';
  shell.style.blockSize = '100dvh';
  const header = document.createElement('div');
  header.style.cssText = 'flex: none; block-size: var(--header-size); border-block-end: 1px solid var(--line)';
  const transcript = document.createElement('div');
  transcript.style.cssText = 'flex: 1; min-block-size: 0';
  const foot = document.createElement('div');
  foot.style.cssText = 'flex: none; display: flex; flex-direction: column; padding-inline: var(--gutter); inline-size: min(100%, calc(var(--thread-max-width) + 2 * var(--gutter))); margin-inline: auto; box-sizing: border-box';
  const composer = document.createElement('div');
  composer.style.cssText = 'flex: none; block-size: 5.5rem; margin-block: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-thread)';
  document.body.style.margin = '0';
  dock.replaceWith(shell);
  foot.append(dock, composer);
  shell.append(header, transcript, foot);
  return true;
})()`;
const approveInView = `(() => {
  const items = document.querySelector('.pinned-dock-items');
  const button = [...document.querySelectorAll('.pinned-dock button')].find((node) => node.textContent === 'Approve and run');
  if (!items || !button) return { approveInView: false };
  const box = items.getBoundingClientRect();
  const at = button.getBoundingClientRect();
  return { dockHeight: Math.round(document.querySelector('.pinned-dock').getBoundingClientRect().height), scrollTop: items.scrollTop,
    approveInView: at.top >= box.top - 0.5 && at.bottom <= box.bottom + 0.5 };
})()`;
try {
  await waitForDebugger(port);
  for (const scheme of schemes) {
    for (const name of postures) {
      const posture = FOLD8_POSTURES.find((candidate) => candidate.name === name);
      if (!posture) throw new Error(`Unknown posture ${name}`);
      const cdp = await openPosturePage({ debugPort: port, posture, colorScheme: scheme });
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 1, mobile: true });
      for (const spec of parts) {
        const [part, state = "default"] = spec.split("#");
        const url = new URL(`/__caliper/frame?part=${encodeURIComponent(part)}&state=${encodeURIComponent(state)}`, base);
        await cdp.send("Page.navigate", { url: url.href });
        const deadline = Date.now() + 15_000;
        while (!(await evaluate(cdp, `document.body !== null && document.body.innerText.trim().length > 0`))) {
          if (Date.now() > deadline) throw new Error(`Part did not render: ${url.href}`);
          await sleep(100);
        }
        await evaluate(cdp, `document.fonts.ready.then(() => true)`);
        const pinned = state.startsWith("Pinned") && await evaluate(cdp, inShell);
        await sleep(600);
        const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
        const file = join(out, `${part.split("/").pop().split(".")[0]}-${state}-${name}-${scheme}.png`);
        await writeFile(file, Buffer.from(data, "base64"));
        console.log(file, JSON.stringify({ ...await evaluate(cdp, overflow), ...(pinned ? await evaluate(cdp, approveInView) : {}) }));
      }
      await cdp.close?.();
    }
  }
} finally {
  chrome.kill();
  await sleep(1000);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
