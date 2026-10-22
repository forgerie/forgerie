#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Capture the backlog suggestion parts at desktop 1440 x 900, phone 412 x 915, small phone 320 x 640 and the four
// Fold 8 postures, in the dark and light schemes. It loads the Caliper frames (/__caliper/frame) with the scheme emulated.
// A card state is set inside a stand-in for the session pane: .session-shell (the app's size container) with a header's
// room, a transcript with the reading column, and a composer's room, so the 42rem rule that pins the choices sees the
// real height. Each capture reports whether the page or a sheet body spills sideways, and for a card, whether its
// first choice is inside the transcript's visible area without a scroll.
// Run from ui/ with the Caliper dev server up (scripts/caliper-dev.mjs):
//   APP_URL=http://localhost:5173/ scripts/suggestion-shots.mjs
// PARTS ("file#State file#State ..."), SCHEMES and SIZES narrow the run. One image pixel is one CSS pixel.
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
const repo = process.env.FORGERIE_ROOT ?? resolve("..");
const { launchChrome, getFreePort, waitForDebugger, evaluate, sleep } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));
const out = resolve(process.env.OUT ?? "verification/local/suggestions");
await mkdir(out, { recursive: true });
const base = process.env.APP_URL ?? "http://localhost:5173/";
const card = "src/backlog/suggestions/SuggestionCard.organism.part.tsx";
const parts = (process.env.PARTS ?? [
  ...["default", "OpenGitHub", "Editing", "Filing", "Filed", "Started", "StartedNeedsYou", "LaunchFailed", "LaunchFailedUnrecorded", "Duplicate", "Failed", "AzureNote",
    "Dismissed", "Reading", "LongWords", "NoContext"].map((state) => `${card}#${state}`),
  "src/backlog/suggestions/SuggestionsSheet.organism.part.tsx#default",
  "src/backlog/suggestions/SuggestionsSheet.organism.part.tsx#NothingOpen",
  "src/backlog/suggestions/SuggestionsSheet.organism.part.tsx#Trouble",
  "src/backlog/suggestions/SuggestionsSheet.organism.part.tsx#Many",
  "src/backlog/suggestions/SuggestedInChats.organism.part.tsx#default",
  "src/backlog/suggestions/SuggestedInChats.organism.part.tsx#Trouble",
  "src/backlog/suggestions/SuggestionModelField.molecule.part.tsx#Chosen",
  "src/backlog/suggestions/SuggestionsOpener.atom.part.tsx#OpenAndWorking",
  "src/backlog/suggestions/SuggestionsOpener.atom.part.tsx#NeedsYou",
].join(" ")).split(" ").filter(Boolean);
const schemes = (process.env.SCHEMES ?? "dark,light").split(",");
const SIZES = [
  { name: "desktop", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 412, height: 915, mobile: true },
  { name: "small-phone", width: 320, height: 640, mobile: true },
  ...FOLD8_POSTURES.map((posture) => ({ name: `fold-${posture.name}`, width: posture.width, height: posture.height, mobile: true })),
];
// The real thread with the real cards and header, from verification/suggestions-preview.html: one capture per scenario,
// with the newest card scrolled into view, and the sheet open in "sheet".
const scenarios = (process.env.SCENARIOS ?? "suggested,github,filed,started,many,duplicate,failed,azure,sheet,long").split(",").filter(Boolean);
const sizes = (process.env.SIZES ?? SIZES.map((size) => size.name).join(",")).split(",");
const profile = await mkdtemp(join(tmpdir(), "suggestion-shots-"));
const port = await getFreePort();
const chrome = launchChrome(process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim(), port, profile);
const overflow = `(() => ({
  page: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  sheet: [...document.querySelectorAll('.sheet-dialog-body')].some((node) => node.scrollWidth > node.clientWidth + 1),
}))()`;
// The session pane around a card: a header's room, the transcript with its reading column, and a composer's room.
const inShell = `(() => {
  const root = document.querySelector('#root') ?? document.body.firstElementChild;
  if (!root || !document.querySelector('.decision-card, .readout-line')) return false;
  const shell = document.createElement('div');
  shell.className = 'session-shell';
  shell.style.blockSize = '100dvh';
  const header = document.createElement('div');
  header.style.cssText = 'flex: none; block-size: var(--header-size); border-block-end: 1px solid var(--line)';
  const transcript = document.createElement('div');
  transcript.className = 'transcript';
  const column = document.createElement('div');
  column.className = 'thread-column';
  const composer = document.createElement('div');
  composer.style.cssText = 'flex: none; block-size: 5.5rem; margin: var(--space-2) auto; inline-size: min(calc(100% - 2 * var(--gutter)), var(--thread-max-width)); border: 1px solid var(--line); border-radius: var(--radius-thread)';
  document.body.style.margin = '0';
  const content = [...root.childNodes];
  root.replaceChildren(shell);
  column.append(...content);
  transcript.append(column);
  shell.append(header, transcript, composer);
  return true;
})()`;
const choiceInView = `(() => {
  const transcript = document.querySelector('.transcript');
  const button = document.querySelector('.decision-card .action-footer-button');
  if (!transcript || !button) return {};
  const box = transcript.getBoundingClientRect();
  const at = button.getBoundingClientRect();
  return { firstChoiceInView: at.top >= box.top - 0.5 && at.bottom <= box.bottom + 0.5 };
})()`;
try {
  await waitForDebugger(port);
  for (const scheme of schemes) {
    for (const name of sizes) {
      const size = SIZES.find((candidate) => candidate.name === name);
      if (!size) throw new Error(`Unknown size ${name}`);
      const cdp = await openPosturePage({ debugPort: port, posture: { name: size.name, width: size.width, height: size.height }, colorScheme: scheme });
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: size.mobile });
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
        const shelled = part === card && await evaluate(cdp, inShell);
        await sleep(500);
        const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
        const file = join(out, `${part.split("/").pop().split(".")[0]}-${state}-${name}-${scheme}.png`);
        await writeFile(file, Buffer.from(data, "base64"));
        console.log(file, JSON.stringify({ ...await evaluate(cdp, overflow), ...(shelled ? await evaluate(cdp, choiceInView) : {}) }));
      }
      for (const scene of scenarios) {
        const url = new URL(`/verification/suggestions-preview.html?scenario=${scene}`, base);
        await cdp.send("Page.navigate", { url: url.href });
        const deadline = Date.now() + 15_000;
        while (!(await evaluate(cdp, `document.querySelector('[data-suggestion] .decision-card, [data-suggestion] .readout-line, .sheet-dialog') !== null`))) {
          if (Date.now() > deadline) throw new Error(`Preview did not render: ${url.href}`);
          await sleep(100);
        }
        await evaluate(cdp, `document.fonts.ready.then(() => true)`);
        await sleep(400);
        await evaluate(cdp, `(() => { const cards = document.querySelectorAll('[data-suggestion]'); cards[cards.length - 1]?.scrollIntoView({ block: 'end' }); return true; })()`);
        await sleep(300);
        const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
        const file = join(out, `chat-${scene}-${name}-${scheme}.png`);
        await writeFile(file, Buffer.from(data, "base64"));
        console.log(file, JSON.stringify(await evaluate(cdp, overflow)));
      }
      await cdp.close?.();
    }
  }
} finally {
  chrome.kill();
  await sleep(1000);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
