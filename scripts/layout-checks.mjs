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
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluate, findChrome, getFreePort, launchChrome, sleep, waitForDebugger } from "./lib/cdp.mjs";
import { buildFixture, serveDirectory } from "./lib/fixture-site.mjs";
import { FOLD8_POSTURES } from "./lib/fold8-postures.mjs";
import { GRID_STRETCH_PROBE } from "./lib/grid-stretch-probe.mjs";
import { INBOX_COLUMNS_PROBE } from "./lib/inbox-columns-probe.mjs";
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

/** How far two rows' shared column edge may differ before the list reads as ragged. */
const MAX_COLUMN_DRIFT_PX = 0.6;

/**
 * The least a title may be given on a one-line row, as a share of the pane
 * and as a character count, whichever is smaller. Mirrors the board's
 * --row-title-floor; the stylesheet is what is being checked, so the number
 * is restated here rather than read from it.
 */
const TITLE_FLOOR_PANE_SHARE = 0.5;
const TITLE_FLOOR_CH = 26;

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
          const columns = JSON.parse(String(await evaluate(cdp, INBOX_COLUMNS_PROBE)));
          if (args.dump === state || args.dump === "all") {
            process.stdout.write(`\n--- ${where}\n${JSON.stringify({ measured, columns }, undefined, 1)}\n`);
          }
          failures.push(...checkInboxFloor({ where, contentPx: shelfContentPx[state], measured }));
          failures.push(...checkInboxColumns({ where, columns }));
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

/**
 * The inbox is one table. Rows differ in project name, live work, pin and
 * timestamp length, and none of that is allowed to move a column: every row
 * starts its title, its live-work counts and its mark at the same x, and ends
 * its timestamp at the same x. The location chip shares a column with the
 * rows of its own shape, because a two-line row keeps its location under the
 * title by design.
 */
function checkInboxColumns({ where, columns }) {
  if (columns.error !== undefined) return [`${where}: ${columns.error}`];
  const rows = columns.rows;
  if (rows.length < 2) return [`${where}: ${String(rows.length)} row(s) measured, too few to compare columns`];

  const failures = [];
  const shared = [
    { column: "title", edge: "left" },
    { column: "work", edge: "left" },
    { column: "mark", edge: "left" },
    { column: "mark", edge: "right" },
    { column: "time", edge: "right" },
  ];
  for (const { column, edge } of shared) {
    failures.push(...driftFailures({ where, rows, column, edge, scope: "the board" }));
  }

  for (const shape of [...new Set(rows.map((row) => row.shape))]) {
    failures.push(...driftFailures({
      where,
      rows: rows.filter((row) => row.shape === shape),
      column: "location",
      edge: "left",
      scope: `${shape} rows`,
    }));
  }

  failures.push(...titleFloorFailures({ where, columns }));
  failures.push(...actionOverMarkFailures({ where, columns }));
  return failures;
}

/**
 * The row's action draws where its pin was, so revealing it moves nothing.
 * The action is positioned inside the mark's grid area, and the mark's box is
 * offset from that area by its own margin; the two have to agree or the
 * glyph appears to jump under the pointer.
 */
function actionOverMarkFailures({ where, columns }) {
  const failures = [];
  for (const row of columns.rows) {
    if (row.mark === undefined || row.action === undefined) continue;
    const drift = Math.max(Math.abs(row.mark.left - row.action.left), Math.abs(row.mark.right - row.action.right));
    if (drift <= MAX_COLUMN_DRIFT_PX) continue;
    failures.push(`${where}: ${row.id}'s action sits ${String(Math.round(drift * 10) / 10)}px off its mark (mark ${String(row.mark.left)}-${String(row.mark.right)}, action ${String(row.action.left)}-${String(row.action.right)})`);
  }
  return failures;
}

/**
 * The title is the readout the row exists for, so it is the chip that yields:
 * on a one-line row the title keeps at least its floor and the location chip
 * takes what is left. A chip that pushed a title under the floor is the
 * thirteen-character title this check was written against.
 */
function titleFloorFailures({ where, columns }) {
  const floorPx = Math.min(columns.paneWidth * TITLE_FLOOR_PANE_SHARE, columns.titleChPx * TITLE_FLOOR_CH);
  const failures = [];
  for (const row of columns.rows) {
    if (row.shape !== "one-line" || row.title === undefined) continue;
    const width = row.title.right - row.title.left;
    if (width + BOX_SLACK_PX >= floorPx) continue;
    failures.push(`${where}: ${row.id}'s title is ${String(Math.round(width))}px wide, under its ${String(Math.round(floorPx))}px floor`);
  }
  return failures;
}

function driftFailures({ where, rows, column, edge, scope }) {
  const measured = rows
    .map((row) => ({ id: row.id, value: row[column]?.[edge] }))
    .filter((entry) => entry.value !== undefined);
  if (measured.length < 2) return [];

  const values = measured.map((entry) => entry.value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (high - low <= MAX_COLUMN_DRIFT_PX) return [];
  const lowest = measured.find((entry) => entry.value === low);
  const highest = measured.find((entry) => entry.value === high);
  return [`${where}: the ${column} column's ${edge} edge drifts ${String(Math.round((high - low) * 10) / 10)}px across ${scope} (${lowest.id} at ${String(low)}, ${highest.id} at ${String(high)})`];
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
