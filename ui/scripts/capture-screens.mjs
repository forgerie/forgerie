#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium --command node
// Capture every main screen of the browser app at the four Fold 8 postures, in both colour schemes.
// The decomposition compares these before and after each step (ui/docs/decomposition.md).
//
//   ui/scripts/capture-screens.mjs --url http://localhost:5173/ --out /tmp/shots/before
//   ui/scripts/capture-screens.mjs --url ... --out ... --only session,changes
//
// It reads the live Forgerie behind the dev server and never sends a prompt. Live data (times,
// pull-request checks, the git diff) can change between two runs, so explain each difference.
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluate, findChrome, getFreePort, launchChrome, sleep, waitForDebugger } from "../../scripts/lib/cdp.mjs";
import { FOLD8_POSTURES } from "../../scripts/lib/fold8-postures.mjs";
import { drivePage, openPosturePage } from "../../scripts/lib/posture-page.mjs";

/**
 * Sessions chosen for their content. Compare a before and an after run made at the same time,
 * from two dev servers: a session that is still working changes between two runs made apart.
 */
const RICH_SESSION = "01a0ef0c-343b-70d6-902d-d26b3d5b1af9"; // idle since 2026-10-05; markdown, code, tool calls; cwd has a git diff
const PR_SESSION = "01a11d81-59e3-704e-ae16-6293088bbf28"; // the one session with linked pull requests (korri-os/korri#71, #72); it is often working
const FOLDER = "/home/simonwjackson/code/sandbox/forgerie";

/**
 * Each screen: a query string, a selector that proves the screen loaded, and optionally a button to
 * press, found by an aria-label prefix. A frame whose ready selector never appears is an error, not
 * a picture: a cold dev server reloads the page while it optimizes dependencies, and a fixed wait
 * then captures a skeleton or a blank page.
 */
const SESSION_READY = ".connection-status:not(:empty)";
const SCREENS = {
  inbox: { query: "", ready: ".picker-row" },
  session: { query: `?session=${RICH_SESSION}`, settled: SESSION_READY, ready: SESSION_READY },
  sessions: { query: `?session=${RICH_SESSION}`, settled: SESSION_READY, press: "Sessions", optional: true, ready: ".picker-row" },
  "new-session": { query: `?session=${RICH_SESSION}&new=${encodeURIComponent(FOLDER)}`, ready: "dialog[open]" },
  changes: { query: `?session=${RICH_SESSION}`, settled: SESSION_READY, press: "Review changes", ready: ".file-tree" },
  "pull-request": { query: `?session=${PR_SESSION}`, settled: SESSION_READY, press: "Pull request", ready: ".pr-body" },
  "model-menu": { query: `?session=${RICH_SESSION}`, settled: SESSION_READY, press: "Model and thinking level", ready: ".floating-panel" },
  settings: { query: "?settings=root", ready: ".settings-sections" },
  "settings-models": { query: "?settings=models", ready: ".models-search" },
  "settings-plugins": { query: "?settings=plugins", ready: ".agent-list" },
  "settings-agents": { query: "?settings=agents", ready: ".agent-list" },
  backlog: { query: "?backlog", ready: ".bl-rows, .bl-empty, .bl-problems" },
};

const args = parseArgs(process.argv.slice(2));
// findChrome() asks a login shell, which drops the Chromium that this script's nix shell put on PATH.
const onPath = spawnSync("sh", ["-c", "command -v chromium"], { encoding: "utf8" }).stdout.trim();
const chromeBin = process.env.CHROME_BIN ?? (onPath || findChrome());
if (!chromeBin) fail("Chromium not found. Set CHROME_BIN.");
const names = args.only ?? Object.keys(SCREENS);
for (const name of names) if (!SCREENS[name]) fail(`Unknown screen ${name}. Screens: ${Object.keys(SCREENS).join(", ")}`);

const tempRoot = await mkdtemp(join(tmpdir(), "forgerie-screens-"));
const port = await getFreePort();
const chrome = launchChrome(chromeBin, port, join(tempRoot, "profile"));
const problems = [];
try {
  await waitForDebugger(port);
  await mkdir(args.out, { recursive: true });
  for (const scheme of ["dark", "light"]) {
    for (const name of names) {
      const screen = SCREENS[name];
      for (const posture of FOLD8_POSTURES) {
        const file = join(args.out, `${name}.${scheme}.${posture.name}.png`);
        const cdp = await openPosturePage({ debugPort: port, posture, colorScheme: scheme });
        try {
          await drivePage(cdp, { url: new URL(screen.query, args.url).href, settle: args.settle, label: `${name} ${posture.name}` });
          const where = `${name} ${scheme} ${posture.name}`;
          // A session is loaded when its status reads Connected, Running and so on, not Connecting.
          if (screen.settled && !(await waitFor(cdp, `${screen.settled}`, (text) => text && text !== "Connecting"))) problems.push(`${where}: session never connected`);
          if (screen.press) {
            const pressed = await evaluate(cdp, `(() => {
              const target = [...document.querySelectorAll("button[aria-label]")]
                .find((button) => button.getAttribute("aria-label").startsWith(${JSON.stringify(screen.press)}) && button.getClientRects().length > 0);
              if (!target) return false;
              target.click();
              return true;
            })()`);
            if (pressed) await sleep(args.settle);
            else if (!screen.optional) problems.push(`${where}: no visible button "${screen.press}…"`);
          }
          if (!(await waitFor(cdp, screen.ready))) problems.push(`${where}: "${screen.ready}" never appeared`);
          await sleep(500);
          const { data } = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
          await writeFile(file, Buffer.from(data, "base64"));
          process.stdout.write(`${file}\n`);
        } finally {
          cdp.close();
        }
      }
    }
  }
} finally {
  chrome.kill("SIGTERM");
  await sleep(300);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(tempRoot, { recursive: true, force: true });
}
for (const problem of problems) process.stderr.write(`${problem}\n`);
if (problems.length) process.exitCode = 1;

/** Poll for a selector, and optionally a test on its text, for up to 20 s. Survives a page reload. */
async function waitFor(cdp, selector, test = () => true) {
  for (let tries = 0; tries < 40; tries += 1) {
    let text;
    try {
      text = await evaluate(cdp, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.textContent.trim() || "(present)" : null; })()`);
    } catch { text = null; }
    if (text !== null && text !== undefined && test(text)) return true;
    await sleep(500);
  }
  return false;
}

function parseArgs(argv) {
  const parsed = { settle: 2500 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--url") parsed.url = argv[++i];
    else if (arg === "--out") parsed.out = argv[++i];
    else if (arg === "--only") parsed.only = argv[++i].split(",");
    else if (arg === "--settle") parsed.settle = Number(argv[++i]);
    else fail(`Unknown argument: ${arg}`);
  }
  if (!parsed.url || !parsed.out) fail("--url and --out are required.");
  return parsed;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
