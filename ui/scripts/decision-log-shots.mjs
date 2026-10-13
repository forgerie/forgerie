#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Capture the decision log's Caliper parts at the four Fold 8 postures, in the dark and light schemes.
// caliper-render draws one scheme; this loads the same frames (/__caliper/frame) with the scheme emulated.
// Each capture reports whether the page or a sheet body spills sideways, which no state may. A sheet whose body
// scrolls is shot again at its end ("-end").
// Run from ui/ with the Caliper dev server up (scripts/caliper-dev.mjs):
//   APP_URL=http://localhost:5173/ scripts/decision-log-shots.mjs
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
const out = resolve(process.env.OUT ?? "verification/local/decision-log");
await mkdir(out, { recursive: true });
const base = process.env.APP_URL ?? "http://localhost:5173/";
const parts = (process.env.PARTS ?? [
  "src/decisions/DecisionsSheet.organism.part.tsx#default",
  "src/decisions/DecisionsSheet.organism.part.tsx#Empty",
  "src/decisions/DecisionsSheet.organism.part.tsx#Loading",
  "src/decisions/DecisionsSheet.organism.part.tsx#ReadFailed",
  "src/decisions/DecisionsSheet.organism.part.tsx#Overturning",
  "src/decisions/DecisionsSheet.organism.part.tsx#OverturnFailed",
  "src/workflows/WorkflowRunSheet.organism.part.tsx#default",
  "src/workflows/WorkflowRunSheet.organism.part.tsx#NoDecisions",
  "src/workflows/WorkflowRunSheet.organism.part.tsx#DecisionsUnread",
  "src/childAgents/ChildEntryView.molecule.part.tsx#Escalated",
  "src/ui/BadgeButton.atom.part.tsx#QuietCount",
].join(" ")).split(" ");
const schemes = (process.env.SCHEMES ?? "dark,light").split(",");
const postures = (process.env.POSTURES ?? FOLD8_POSTURES.map((posture) => posture.name).join(",")).split(",");
const profile = await mkdtemp(join(tmpdir(), "decision-shots-"));
const port = await getFreePort();
const chrome = launchChrome(process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim(), port, profile);
const overflow = `(() => ({
  page: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  sheet: [...document.querySelectorAll('.sheet-dialog-body')].some((node) => node.scrollWidth > node.clientWidth + 1),
}))()`;
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
        await sleep(600);
        const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
        const file = join(out, `${part.split("/").pop().split(".")[0]}-${state}-${name}-${scheme}.png`);
        await writeFile(file, Buffer.from(data, "base64"));
        console.log(file, JSON.stringify(await evaluate(cdp, overflow)));
        // A sheet whose body scrolls gets a second shot at its end, where a run sheet keeps its decisions.
        const scrolled = await evaluate(cdp, `(() => { const body = document.querySelector('.sheet-dialog-body');
          if (!body || body.scrollHeight <= body.clientHeight + 1) return false; body.scrollTop = body.scrollHeight; return true; })()`);
        if (scrolled) {
          await sleep(300);
          const { data: end } = await cdp.send("Page.captureScreenshot", { format: "png" });
          await writeFile(file.replace(/\.png$/u, "-end.png"), Buffer.from(end, "base64"));
          console.log(file.replace(/\.png$/u, "-end.png"));
        }
      }
      await cdp.close?.();
    }
  }
} finally {
  chrome.kill();
  await sleep(1000);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
