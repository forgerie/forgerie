#!/usr/bin/env node
/**
 * Contrast ratios for the fan's own color pairs, against the floors in
 * docs/design-system.md §5: 4.5:1 for text, 3:1 for meaningful non-text.
 *
 * Usage: node check-contrast.mjs
 */

const COLORS = {
  canvas: "#0e1116",
  surface: "#161b22",
  raised: "#1d232c",
  line: "#2a323d",
  lineStrong: "#5c6878",
  text: "#d7dee8",
  dim: "#99a5b4",
  accent: "#6ea8fe",
  accentInk: "#0b1220",
  badge: "#a83a2a",
  white: "#ffffff",
  // canvas under scrim rgba(6,9,13,.72), pre-blended.
  scrimmed: "#080b0f",
};

const PAIRS = [
  ["target glyph on resting surface", "text", "raised", 4.5],
  ["glyph on selected surface", "accentInk", "accent", 4.5],
  ["caption text on resting chip", "text", "raised", 4.5],
  ["cancel hint on resting chip", "dim", "raised", 4.5],
  ["badge count on badge fill", "white", "badge", 4.5],
  ["selected target on scrim", "accent", "scrimmed", 3],
  ["pip, resting, on scrim", "lineStrong", "scrimmed", 3],
];

/**
 * A shape is identifiable if *either* its fill or its edge clears the floor.
 *
 * The resting target is a dark disc with a light border, so its fill measures
 * 1.25:1 against the scrim and its border 3.48:1. Requiring the fill would
 * force every target to be a pale blob; requiring neither would let the
 * targets vanish, which is the defect this file was written to catch. The
 * boundary is what makes the component findable, so the boundary is gated.
 */
const SHAPES = [
  { name: "resting target", fill: "raised", edge: "lineStrong", on: "scrimmed", floor: 3 },
  { name: "caption chip", fill: "raised", edge: "lineStrong", on: "scrimmed", floor: 3 },
  { name: "column menu", fill: "raised", edge: "lineStrong", on: "scrimmed", floor: 3 },
];

const channel = (value) => {
  const srgb = value / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
};

function luminance(hex) {
  const int = Number.parseInt(hex.slice(1), 16);
  const r = channel((int >> 16) & 255);
  const g = channel((int >> 8) & 255);
  const b = channel(int & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const high = Math.max(luminance(a), luminance(b));
  const low = Math.min(luminance(a), luminance(b));
  return (high + 0.05) / (low + 0.05);
}

let failed = 0;
console.log("\npair                                    ratio   floor  verdict");
for (const [name, fg, bg, floor] of PAIRS) {
  const value = ratio(COLORS[fg], COLORS[bg]);
  const ok = value >= floor;
  if (!ok) failed += 1;
  console.log(`${name.padEnd(38)} ${value.toFixed(2).padStart(5)}  ${floor.toFixed(1).padStart(5)}  ${ok ? "ok" : "FAIL"}`);
}
console.log("\nshape                 fill    edge   best   floor  verdict");
for (const shape of SHAPES) {
  const fill = ratio(COLORS[shape.fill], COLORS[shape.on]);
  const edge = ratio(COLORS[shape.edge], COLORS[shape.on]);
  const best = Math.max(fill, edge);
  const ok = best >= shape.floor;
  if (!ok) failed += 1;
  console.log(`${shape.name.padEnd(20)} ${fill.toFixed(2).padStart(5)}  ${edge.toFixed(2).padStart(5)}  ${best.toFixed(2).padStart(5)}  ${shape.floor.toFixed(1).padStart(5)}  ${ok ? "ok" : "FAIL"}`);
}

console.log(`\n${failed} of ${PAIRS.length + SHAPES.length} below floor\n`);
process.exit(failed === 0 ? 0 : 1);
