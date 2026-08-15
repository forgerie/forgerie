#!/usr/bin/env node
/**
 * Sweeps every press point on a grid, in every posture, and reports the
 * largest fan each posture can seat from anywhere on screen.
 *
 * A positional fan can be pressed into a corner, where the arc that stays on
 * screen collapses. That is the one failure an anchored fan does not have, and
 * finding it by hand means holding the tablet and pressing near a corner until
 * something looks wrong — neither exhaustive nor repeatable.
 *
 * The gate is `REQUIRED_COUNT`: that many targets must seat from every press
 * point in every posture. Anything above it is reported as headroom, not
 * demanded, because the smallest posture is allowed to carry fewer panels.
 *
 * Usage: node check-fan.mjs [--shift-sweep] [--radial-sweep]
 *
 * `--shift-sweep` reports what each `shift` value buys and costs, so the number
 * can be chosen from a table rather than from repeated guesses.
 *
 * `--radial-sweep` reports how much of each screen the Radial variant can open
 * on without losing an icon to the edge. Radial refuses to move its centre, so
 * clipping is a permanent property of it rather than a bug, and the only
 * honest thing to do is measure the size of the cost.
 */

import { FAN_DEFAULTS, angleDistance, bearingOf, fanMetrics, fanPoints, layoutFan, selectionAt } from "./fan.js";
import { radialGeometry } from "./variants/radial.js";

/** Every posture must seat this many targets from any press point. */
const REQUIRED_COUNT = 5;

// From AGENTS.md: measured CSS viewports for the acceptance device. The Tab
// Ultra 11 is unmeasured, so its entry is a plausible landscape stand-in and
// is labelled as such rather than presented as fact.
const POSTURES = [
  { name: "fold unfolded portrait", width: 704, height: 783 },
  { name: "fold unfolded landscape", width: 932, height: 553 },
  { name: "fold folded portrait", width: 475, height: 638 },
  { name: "fold folded landscape", width: 711, height: 374 },
  { name: "tab-ultra (unmeasured)", width: 1280, height: 800 },
];

const COUNTS = [3, 4, 5, 6, 7];
const STEP = 7;

/** @returns a failure string, or undefined when this press point is sound. */
function checkPress(press, viewport, count) {
  const metrics = fanMetrics(viewport);
  const inset = FAN_DEFAULTS.marginPx + metrics.targetRadiusPx;
  const layout = layoutFan(press, viewport, count);
  if (layout === undefined) return "no layout";
  if (layout.points.length !== count) return `seated ${layout.points.length} of ${count}`;

  const points = fanPoints(layout);
  for (const point of points) {
    const off = point.x < inset - 0.5
      || point.x > viewport.width - inset + 0.5
      || point.y < inset - 0.5
      || point.y > viewport.height - inset + 0.5;
    if (off) return `target at (${point.x.toFixed(0)},${point.y.toFixed(0)}) off screen`;
  }

  // Every target must be selectable by pointing straight at it, or a target
  // exists that the finger can never reach.
  for (let index = 0; index < points.length; index += 1) {
    if (selectionAt(layout, points[index]) !== index) return `target ${index} unreachable at its own centre`;
  }

  // Adjacent targets must stay far enough apart to be told apart on screen...
  for (let index = 1; index < points.length; index += 1) {
    const chord = Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
    if (chord < metrics.minChordPx - 0.5) return `targets ${index - 1}/${index} only ${chord.toFixed(0)}px apart`;
  }

  // ...and far enough apart in the angle the thumb has to resolve them in.
  // An offset fan looks well spaced on its own arc while asking the finger to
  // pick between targets a few degrees apart, so both are measured.
  const seen = points.map((point) => bearingOf(point.x - press.x, point.y - press.y));
  for (let index = 1; index < seen.length; index += 1) {
    const gap = angleDistance(seen[index - 1], seen[index]);
    if (gap < FAN_DEFAULTS.minPointingGapDeg - 0.5) return `targets ${index - 1}/${index} only ${gap.toFixed(1)}° apart from the finger`;
  }

  return undefined;
}

/** Tightest angle the thumb has to resolve two neighbours in, at one press. */
function tightestPointingGap(press, viewport, count) {
  const layout = layoutFan(press, viewport, count);
  if (layout === undefined) return undefined;
  const seen = layout.points.map((point) => bearingOf(point.x - press.x, point.y - press.y));
  let tightest = 180;
  for (let index = 1; index < seen.length; index += 1) {
    tightest = Math.min(tightest, angleDistance(seen[index - 1], seen[index]));
  }
  return tightest;
}

function sweep(viewport, count) {
  let checked = 0;
  let firstFailure;
  let failed = 0;
  let tightest = 180;
  for (let x = 0; x <= viewport.width; x += STEP) {
    for (let y = 0; y <= viewport.height; y += STEP) {
      checked += 1;
      const press = { x, y };
      const gap = tightestPointingGap(press, viewport, count);
      if (gap !== undefined) tightest = Math.min(tightest, gap);
      const problem = checkPress(press, viewport, count);
      if (problem === undefined) continue;
      failed += 1;
      firstFailure ??= `(${x},${y}): ${problem}`;
    }
  }
  return { checked, failed, firstFailure, tightest };
}

if (process.argv.includes("--shift-sweep")) {
  shiftSweep();
  process.exit(0);
}

if (process.argv.includes("--radial-sweep")) {
  radialSweep();
  process.exit(0);
}

/**
 * Share of press points where every Radial icon can be drawn.
 *
 * 'thumb zone' is the outer half of the screen below the middle — where a
 * right hand actually presses — and is the number that decides whether the
 * variant is usable, since the full-screen figure is dragged down by corners
 * nobody presses in.
 */
function radialSweep() {
  console.log("\nRadial: what each wedge count costs");
  console.log("'wedge' is the angular width of one target \u2014 the arc variants'");
  console.log("worst measured pointing gap is 16\u00b0, for comparison.");
  console.log("'icons' is the share of thumb-zone presses that can draw every icon.\n");
  console.log("count  wedge   icons: unfold-P  unfold-L  fold-P  fold-L  tab   worst");

  for (const count of [4, 6, 8, 10, 12]) {
    const shares = [];
    let worst = count;

    for (const posture of POSTURES) {
      const viewport = { width: posture.width, height: posture.height };
      let complete = 0;
      let total = 0;

      for (let x = 0; x <= posture.width; x += 7) {
        for (let y = 0; y <= posture.height; y += 7) {
          const { wedges } = radialGeometry({ press: { x, y }, viewport, count, anchor: 180 });
          const drawn = wedges.filter((wedge) => wedge.glyphRadius !== undefined).length;
          worst = Math.min(worst, drawn);
          if (x < posture.width * 0.5 || y < posture.height * 0.45) continue;
          total += 1;
          if (drawn === count) complete += 1;
        }
      }
      shares.push(total === 0 ? 0 : (complete / total) * 100);
    }

    const cells = shares.map((share) => `${share.toFixed(0)}%`.padStart(8)).join("  ");
    console.log(`${String(count).padStart(5)}  ${`${(360 / count).toFixed(0)}\u00b0`.padStart(5)}   ${cells}  ${String(worst).padStart(4)}/${count}`);
  }
  console.log("");
}

/**
 * What moving the fan off the finger buys and costs, across the whole range.
 *
 * 'clearance' is the gap between the press point and the nearest disc edge:
 * how far the discs sit from the hand that pressed. 'tightest' is the angle
 * the thumb must resolve neighbours in. They move in opposite directions, and
 * the useful shift is wherever those two stop trading well.
 */
function shiftSweep() {
  // A press near an edge rotates the arc and often loses the shift. Reporting
  // only the all-points share would make the gesture look far more erratic
  // than it is in the part of the screen a thumb actually lands on.
  // The right-hand thumb zone is the one that matters for the default grip:
  // the outer half of the screen, below the middle. A shift that survives
  // there is a shift the reader will experience as constant.
  const INTERIOR_INSET = 80;
  console.log(`\nshift  clearance  tightest  applied  interior  thumb zone  seats ${REQUIRED_COUNT}`);
  for (let shift = 0; shift <= 88; shift += 8) {
    let clearance = Infinity;
    let tightest = 180;
    let ok = true;
    let applied = 0;
    let presses = 0;
    let interiorApplied = 0;
    let interiorPresses = 0;
    let thumbApplied = 0;
    let thumbPresses = 0;

    for (const posture of POSTURES) {
      const viewport = { width: posture.width, height: posture.height };
      const metrics = fanMetrics(viewport);
      for (let x = 0; x <= posture.width; x += 14) {
        for (let y = 0; y <= posture.height; y += 14) {
          const press = { x, y };
          const layout = layoutFan(press, viewport, REQUIRED_COUNT, { originOffsetPx: shift });
          if (layout === undefined) { ok = false; continue; }

          // A shift that is silently dropped at some press points makes the
          // gesture inconsistent, which is worse than never shifting at all.
          const shiftHeld = Math.hypot(layout.origin.x - x, layout.origin.y - y) > 0.5;
          presses += 1;
          if (shiftHeld) applied += 1;

          const interior = x >= INTERIOR_INSET && y >= INTERIOR_INSET
            && x <= posture.width - INTERIOR_INSET && y <= posture.height - INTERIOR_INSET;
          if (interior) {
            interiorPresses += 1;
            if (shiftHeld) interiorApplied += 1;
          }

          if (x >= posture.width * 0.5 && y >= posture.height * 0.45) {
            thumbPresses += 1;
            if (shiftHeld) thumbApplied += 1;
          }

          for (const point of layout.points) {
            clearance = Math.min(clearance, Math.hypot(point.x - x, point.y - y) - metrics.discPx / 2);
          }
          const seen = layout.points.map((point) => bearingOf(point.x - x, point.y - y));
          for (let index = 1; index < seen.length; index += 1) {
            tightest = Math.min(tightest, angleDistance(seen[index - 1], seen[index]));
          }
        }
      }
    }

    const flag = shift === FAN_DEFAULTS.originOffsetPx ? "  <- default" : "";
    const share = presses === 0 ? 0 : (applied / presses) * 100;
    const interiorShare = interiorPresses === 0 ? 0 : (interiorApplied / interiorPresses) * 100;
    const thumbShare = thumbPresses === 0 ? 0 : (thumbApplied / thumbPresses) * 100;
    console.log(`${String(shift).padStart(4)}px  ${clearance.toFixed(0).padStart(6)}px  ${tightest.toFixed(0).padStart(7)}\u00b0  ${share.toFixed(0).padStart(6)}%  ${interiorShare.toFixed(0).padStart(7)}%  ${thumbShare.toFixed(0).padStart(9)}%  ${ok ? "yes" : "no "}${flag}`);
  }
  console.log("");
}

const rows = [];
let totalChecked = 0;
let gateBroken = false;

for (const posture of POSTURES) {
  const viewport = { width: posture.width, height: posture.height };
  let maxCount = 0;
  let gateFailure;
  let tightest = 180;

  for (const count of COUNTS) {
    const result = sweep(viewport, count);
    totalChecked += result.checked;
    if (result.failed === 0) maxCount = count;
    if (count === REQUIRED_COUNT) {
      tightest = result.tightest;
      if (result.failed > 0) {
        gateBroken = true;
        gateFailure = `${result.failed}/${result.checked} press points fail — first ${result.firstFailure}`;
      }
    }
  }

  rows.push({ posture, maxCount, gateFailure, tightest });
}

const width = Math.max(...rows.map((row) => row.posture.name.length));
console.log("\nArc geometry — gates Discs and Labels only.");
console.log("Radial and Knob do not use this path: Radial divides a full circle,");
console.log("and Knob reads bearing with no seating at all. At the chosen eight");
console.log("slots the arc variants cannot open on the cover screen in landscape,");
console.log("which is one of the reasons Radial was chosen.");
console.log(`\nlargest fan that seats from every press point (gate: ${REQUIRED_COUNT})`);
console.log(`'tightest' is the smallest angle the thumb must resolve two neighbours in, at ${REQUIRED_COUNT} targets\n`);
for (const row of rows) {
  const size = `${row.posture.width}\u00d7${row.posture.height}`.padEnd(9);
  const verdict = row.maxCount >= REQUIRED_COUNT ? "ok  " : "FAIL";
  const disc = `${fanMetrics({ width: row.posture.width, height: row.posture.height }).discPx}px disc`;
  const gap = `${row.tightest.toFixed(0)}\u00b0 tightest`;
  console.log(`  ${verdict}  ${row.posture.name.padEnd(width)}  ${size}  ${row.maxCount} targets  ${disc}  ${gap}`);
  if (row.gateFailure !== undefined) console.log(`        ${row.gateFailure}`);
}

console.log(`\n${totalChecked} press points checked`);
process.exit(gateBroken ? 1 : 0);
