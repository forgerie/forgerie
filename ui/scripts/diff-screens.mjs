#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#imagemagick --command node
// Compare two capture-screens.mjs runs frame by frame. For each pair, print the share of pixels that
// differ and write a highlighted diff image for every pair that differs.
// Usage: ui/scripts/diff-screens.mjs /tmp/shots/before /tmp/shots/after /tmp/shots/diff
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const [before, after, out] = process.argv.slice(2);
if (!out) throw new Error("Usage: diff-screens.mjs <before> <after> <diff dir>");
mkdirSync(out, { recursive: true });
const rows = [];
for (const name of readdirSync(before).filter((file) => file.endsWith(".png")).sort()) {
  const other = join(after, name);
  if (!existsSync(other)) { rows.push([name, "missing after"]); continue; }
  // AE with a small fuzz counts pixels that changed visibly, ignoring antialiasing noise.
  const result = spawnSync("magick", ["compare", "-metric", "AE", "-fuzz", "2%", join(before, name), other, join(out, name)], { encoding: "utf8" });
  const pixels = Number.parseFloat(result.stderr);
  if (Number.isNaN(pixels)) { rows.push([name, `compare failed: ${result.stderr.trim()}`]); continue; }
  const size = spawnSync("magick", ["identify", "-format", "%w %h", join(before, name)], { encoding: "utf8" }).stdout.split(" ").map(Number);
  const share = pixels / (size[0] * size[1]);
  rows.push([name, share === 0 ? "same" : `${(share * 100).toFixed(3)}%`]);
}
const changed = rows.filter(([, verdict]) => verdict !== "same");
for (const [name, verdict] of rows) console.log(`${verdict.padStart(10)}  ${name}`);
console.log(`\n${rows.length - changed.length} of ${rows.length} frames are identical.`);
