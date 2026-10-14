#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Capture the issue lines at the four Fold 8 postures, in the dark and light schemes: the old issue proposal's line and
// the event sentence it and the file_issue line use (their Caliper parts, /__caliper/frame), and the `issues` preview,
// where both sit in a real thread beside their neighbours: `issues` at the filing, `issues-old` at the old lines. Each
// capture reports whether the page spills sideways, which none may, and every line's height in lines of text.
// Run from ui/ with the Caliper dev server up (scripts/caliper-dev.mjs):
//   APP_URL=http://localhost:5173/ scripts/issue-line-shots.mjs
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
const out = resolve(process.env.OUT ?? "verification/local/issue-lines");
await mkdir(out, { recursive: true });
const base = process.env.APP_URL ?? "http://localhost:5173/";
const line = "src/issues/OldIssueProposalLine.molecule.part.tsx";
const sentence = "src/ui/EventSentence.molecule.part.tsx";
const parts = (process.env.PARTS ?? [
  ...["default", "Dismissed", "Undecided", "Untitled", "Unlinked", "LongTitle"].map((state) => `${line}#${state}`),
  ...["default", "Plain", "Hollow", "LongWords"].map((state) => `${sentence}#${state}`),
  "preview#issues", "preview#issues-old",
].join(" ")).split(" ");
const schemes = (process.env.SCHEMES ?? "dark,light").split(",");
const postures = (process.env.POSTURES ?? FOLD8_POSTURES.map((posture) => posture.name).join(",")).split(",");
const profile = await mkdtemp(join(tmpdir(), "issue-shots-"));
const port = await getFreePort();
const chrome = launchChrome(process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim(), port, profile);
const measure = `(() => ({ spills: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  lines: [...document.querySelectorAll('.event-sentence-text')].map((node) => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight))) }))()`;
// The preview opens at its end, where the parent files its issue; `issues-old` scrolls the old lines into view.
const showOld = `(() => { document.querySelector('.event-sentence')?.scrollIntoView({ block: 'start' }); return true; })()`;
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
        const preview = part === "preview";
        const url = preview ? new URL(`/verification/preview.html?scenario=${encodeURIComponent(state)}`, base)
          : new URL(`/__caliper/frame?part=${encodeURIComponent(part)}&state=${encodeURIComponent(state)}`, base);
        await cdp.send("Page.navigate", { url: url.href });
        const deadline = Date.now() + 15_000;
        while (!(await evaluate(cdp, `document.querySelector('.event-sentence') !== null`))) {
          if (Date.now() > deadline) throw new Error(`No issue line rendered: ${url.href}`);
          await sleep(100);
        }
        await evaluate(cdp, `document.fonts.ready.then(() => true)`);
        if (preview && state === "issues-old") await evaluate(cdp, showOld);
        await sleep(600);
        const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
        const file = join(out, `${preview ? "preview" : part.split("/").pop().split(".")[0]}-${state}-${name}-${scheme}.png`);
        await writeFile(file, Buffer.from(data, "base64"));
        console.log(file, JSON.stringify(await evaluate(cdp, measure)));
      }
      await cdp.close?.();
    }
  }
} finally {
  chrome.kill();
  await sleep(1000);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
