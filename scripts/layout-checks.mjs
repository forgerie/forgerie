#!/usr/bin/env node
// Measures real surfaces in a real layout engine, at the Fold postures.
//
//   node scripts/layout-checks.mjs
//   node scripts/layout-checks.mjs --require-browser   # CI: absence is failure
//
// The DOM suite runs under happy-dom, which does no layout. It can assert that
// a rule is written down; it cannot assert that the rule produces the right
// box. Everything here is a box measurement, so it survives a rewrite of the
// stylesheet that keeps the reading behaviour.
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { build } from "vite";
import { appTokensPlugin } from "./lib/app-token-css.mjs";
import { evaluate, findChrome, getFreePort, launchChrome, sleep, waitForDebugger } from "./lib/cdp.mjs";
import { FOLD8_POSTURES } from "./lib/fold8-postures.mjs";
import { GRID_STRETCH_PROBE } from "./lib/grid-stretch-probe.mjs";
import { INBOX_FLOOR_PROBE } from "./lib/inbox-floor-probe.mjs";
import { openPosturePage } from "./lib/posture-page.mjs";
import { TRANSCRIPT_LAYOUT_PROBE } from "./lib/transcript-layout-probe.mjs";

/**
 * The widest authored space between two transcript rows, plus room for a
 * descender. A stretched grid clears this by an order of magnitude, so the
 * threshold does not need to track the stylesheet's exact rhythm.
 */
const MAX_ROW_GAP_PX = 48;

/** A pill control that has not been inflated by its row. */
const MAX_HISTORY_BUTTON_PX = 48;

/** How far the last row may sit above the scroller's bottom padding. */
const MAX_TAIL_SLACK_PX = 8;

/** How far off centre an empty transcript may sit. */
const MAX_EMPTY_OFFSET_PX = 8;

/** Rounding slack for a box that should match another box exactly. */
const BOX_SLACK_PX = 1;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const chromeBin = args.chromeBin ?? process.env["CHROME_BIN"] ?? findChrome();
  if (chromeBin === undefined) {
    if (args.requireBrowser) fail("Chromium not found and --require-browser was set.");
    process.stdout.write("Chromium not found; skipping layout checks. Pass --require-browser to make this a failure.\n");
    return 0;
  }

  const tempRoot = await mkdtemp(join(tmpdir(), "forgerie-layout-"));
  const fixtureDir = join(tempRoot, "fixture");
  await buildFixture(fixtureDir);

  // Chromium refuses module scripts over file://, and the fixture is a real
  // module build, so it is served the way the app is served.
  const server = await serveDirectory(fixtureDir);
  const debugPort = await getFreePort();
  const chrome = launchChrome(chromeBin, debugPort, join(tempRoot, "profile"));
  const failures = [];

  try {
    await waitForDebugger(debugPort);
    const url = `${server.origin}/index.html`;
    for (const posture of FOLD8_POSTURES) {
      const cdp = await openPosturePage({ debugPort, posture, colorScheme: "dark" });
      try {
        const loaded = cdp.waitForEvent("Page.loadEventFired", 20000).catch(() => undefined);
        await cdp.send("Page.navigate", { url });
        await loaded;
        await sleep(400);

        const states = JSON.parse(String(await evaluate(cdp, "JSON.stringify(window.transcriptStates)")));
        for (const state of states) {
          await evaluate(cdp, `window.mountTranscript(${JSON.stringify(state)})`);
          await sleep(150);
          const where = `${posture.name}/${state}`;
          const measured = JSON.parse(String(await evaluate(cdp, TRANSCRIPT_LAYOUT_PROBE)));
          const stretched = JSON.parse(String(await evaluate(cdp, GRID_STRETCH_PROBE)));
          if (args.dump === state || args.dump === "all") {
            process.stdout.write(`\n--- ${where}\n${JSON.stringify({ measured, stretched }, undefined, 1)}\n`);
          }
          failures.push(...check({ where, state, measured, stretched }));
          process.stderr.write(`${where}: checked\n`);
        }

        const inboxStates = JSON.parse(String(await evaluate(cdp, "JSON.stringify(window.inboxStates)")));
        const shelfContentPx = JSON.parse(String(await evaluate(cdp, "JSON.stringify(window.inboxShelfContentPx)")));
        for (const state of inboxStates) {
          await evaluate(cdp, `window.mountInbox(${JSON.stringify(state)})`);
          await sleep(150);
          const where = `${posture.name}/inbox-${state}`;
          const measured = JSON.parse(String(await evaluate(cdp, INBOX_FLOOR_PROBE)));
          if (args.dump === state || args.dump === "all") {
            process.stdout.write(`\n--- ${where}\n${JSON.stringify(measured, undefined, 1)}\n`);
          }
          failures.push(...checkInboxFloor({ where, contentPx: shelfContentPx[state], measured }));
          process.stderr.write(`${where}: checked\n`);
        }
      } finally {
        cdp.close();
      }
    }
  } finally {
    chrome.kill("SIGTERM");
    await sleep(300);
    if (chrome.exitCode === null) chrome.kill("SIGKILL");
    await server.close();
    await rm(tempRoot, { recursive: true, force: true });
  }

  if (failures.length === 0) {
    process.stdout.write("Layout checks passed.\n");
    return 0;
  }
  process.stdout.write(`\n${String(failures.length)} layout check failure(s):\n\n`);
  for (const failure of failures) process.stdout.write(`  ${failure}\n`);
  process.stdout.write("\n");
  return 1;
}

function check({ where, state, measured, stretched }) {
  const failures = [];
  if (measured.error !== undefined) return [`${where}: ${measured.error}`];

  // Applies to every state: no grid inside the transcript may pull its rows
  // apart. This is the class of defect, not the one instance of it.
  for (const finding of stretched.filter((entry) => entry.kind === "spread")) {
    failures.push(`${where}: ${finding.path} spreads ${String(finding.rows)} rows by ${String(finding.spreadPx)}px`);
  }

  for (const gap of measured.gaps) {
    if (gap.px > MAX_ROW_GAP_PX) {
      failures.push(`${where}: ${String(Math.round(gap.px))}px between "${gap.after}" and "${gap.before}" (max ${String(MAX_ROW_GAP_PX)})`);
    }
  }

  if (measured.loadButtonHeight !== undefined && measured.loadButtonHeight > MAX_HISTORY_BUTTON_PX) {
    failures.push(`${where}: history button is ${String(Math.round(measured.loadButtonHeight))}px tall (max ${String(MAX_HISTORY_BUTTON_PX)})`);
  }

  if (state === "short") {
    // A transcript shorter than its scroller hangs from the composer, so the
    // slack collects above it and never between its rows.
    const tailSlack = measured.clientHeight - measured.padBottom - measured.lastRowBottom;
    if (tailSlack > MAX_TAIL_SLACK_PX) {
      failures.push(`${where}: last row ends ${String(Math.round(tailSlack))}px above the scroller floor (max ${String(MAX_TAIL_SLACK_PX)})`);
    }
  }

  if (state === "tall") {
    // The spacer has to collapse, or the first message sits above the scroll
    // origin where scrolling never reaches it.
    if (measured.firstRowTop > measured.padTop + 1) {
      failures.push(`${where}: first row starts ${String(Math.round(measured.firstRowTop))}px in, past the ${String(measured.padTop)}px scroll origin`);
    }
  }

  if (state === "empty") {
    const offset = Math.abs(measured.emptyStateCentreOffset ?? Number.POSITIVE_INFINITY);
    if (offset > MAX_EMPTY_OFFSET_PX) {
      failures.push(`${where}: empty transcript sits ${String(Math.round(offset))}px off centre (max ${String(MAX_EMPTY_OFFSET_PX)})`);
    }
  }

  return failures;
}

/**
 * The inbox floor: an opened shelf is shown at the height its content asks
 * for, the board gives up that space until it reaches its floor, and a shelf
 * the panel cannot hold is compressed onto its own scroller rather than pushed
 * past the panel's edge where nothing can reach it.
 */
function checkInboxFloor({ where, contentPx, measured }) {
  const failures = [];
  if (measured.error !== undefined) return [`${where}: ${measured.error}`];
  const { board, floorPx, panel, shelfScroll, shelves } = measured;

  if (floorPx === undefined) return [`${where}: the panel declares no --inbox-board-floor`];

  if (shelves.bottom > panel.bottom + BOX_SLACK_PX) {
    failures.push(`${where}: the shelf ends ${String(Math.round(shelves.bottom - panel.bottom))}px past the panel floor`);
  }

  if (board.height < floorPx - BOX_SLACK_PX) {
    failures.push(`${where}: the board is ${String(Math.round(board.height))}px tall, under its ${String(floorPx)}px floor`);
  }

  const room = Math.min(contentPx, panel.bottom - shelves.top);
  if (shelves.height + BOX_SLACK_PX < room) {
    failures.push(`${where}: the shelf opened to ${String(Math.round(shelves.height))}px of the ${String(Math.round(room))}px the panel could give it`);
  }

  // The shelf's own scroller has to reach the bottom of the shelf, or the
  // shelf is holding space it does not show anything in.
  if (shelfScroll.bottom + BOX_SLACK_PX < shelves.bottom) {
    failures.push(`${where}: the shelf's scroller stops ${String(Math.round(shelves.bottom - shelfScroll.bottom))}px above the shelf's own floor`);
  }

  // Compression is only allowed to cost reachability, never content: a shelf
  // squeezed under its content height has to be scrollable.
  if (shelfScroll.clientHeight + BOX_SLACK_PX < contentPx && shelfScroll.scrollHeight <= shelfScroll.clientHeight) {
    failures.push(`${where}: the shelf is compressed to ${String(Math.round(shelfScroll.clientHeight))}px and cannot be scrolled`);
  }

  // Sideways is never a scroller: the shelf column takes the panel's width.
  if (shelfScroll.scrollWidth > shelfScroll.clientWidth + BOX_SLACK_PX) {
    failures.push(`${where}: the shelf overflows sideways by ${String(Math.round(shelfScroll.scrollWidth - shelfScroll.clientWidth))}px`);
  }

  return failures;
}

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

async function serveDirectory(directory) {
  const server = createServer((request, response) => {
    const requested = new URL(request.url ?? "/", "http://localhost").pathname;
    const filePath = resolve(directory, `.${requested === "/" ? "/index.html" : requested}`);
    if (!filePath.startsWith(resolve(directory))) {
      response.statusCode = 403;
      response.end();
      return;
    }
    stat(filePath).then(
      () => {
        response.setHeader("Content-Type", CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream");
        createReadStream(filePath).pipe(response);
      },
      () => {
        response.statusCode = 404;
        response.end();
      },
    );
  });
  await new Promise((ready) => { server.listen(0, "127.0.0.1", ready); });
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    close: () => new Promise((done) => { server.close(done); }),
  };
}

async function buildFixture(outDir) {
  await build({
    configFile: false,
    root: resolve("scripts/layout"),
    base: "./",
    logLevel: "error",
    plugins: [appTokensPlugin()],
    build: { outDir, emptyOutDir: true },
  });
}

function parseArgs(argv) {
  const parsed = { requireBrowser: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--require-browser") parsed.requireBrowser = true;
    else if (arg === "--dump") parsed.dump = argv[++i];
    else if (arg === "--chrome-bin") parsed.chromeBin = argv[++i];
    else fail(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

process.exitCode = await main();
