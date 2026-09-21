#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 --command node
/* Does the runway tick ever disagree with the pace hatch?
 *
 * hatch  fires when  fill < pace,           pace = leftMs / window
 * tick   sits left of the gap when  runway < leftMs,
 *        runway = (window - leftMs) * fill / (100 - fill)
 *
 * Both are derived from the same two numbers, so the question is whether the
 * second carries anything the first does not. Swept rather than argued. */

const W = 7 * 86_400_000;
let checked = 0;
let disagree = 0;
const examples = [];

for (let fill = 0; fill <= 100; fill += 0.25) {
  for (let frac = 0.001; frac < 1; frac += 0.001) {
    const leftMs = frac * W;
    const pace = frac * 100;
    const elapsed = W - leftMs;
    const used = 100 - fill;
    const runway = fill <= 0 ? 0 : used <= 0 ? Infinity : elapsed * (fill / used);
    const dryShare = Number.isFinite(runway) ? Math.max(0, Math.min(100, (runway / W) * 100)) : 100;

    const hatchSays = fill < pace && fill > 0;       // behind an even spend
    const tickSays = dryShare < pace && fill > 0;    // runs dry before reset
    checked += 1;
    if (hatchSays !== tickSays) {
      disagree += 1;
      if (examples.length < 6) examples.push({ fill, pace: +pace.toFixed(2), dryShare: +dryShare.toFixed(2), hatchSays, tickSays });
    }
  }
}

console.log(`checked ${checked} combinations`);
console.log(`disagreements: ${disagree}`);
for (const row of examples) console.log(row);

// And the magnitudes: are they the same number or just the same sign?
console.log("\nmagnitude sample (fill, pace, hatch length = pace-fill, tick gap = pace-dryShare):");
for (const [fill, frac] of [[20, 0.7], [40, 0.6], [10, 0.5], [60, 0.9], [85, 0.95]]) {
  const pace = frac * 100;
  const runway = (W - frac * W) * (fill / (100 - fill));
  const dryShare = (runway / W) * 100;
  console.log(`fill ${fill}  pace ${pace.toFixed(1)}  hatch ${(pace - fill).toFixed(1)}  tickgap ${(pace - dryShare).toFixed(1)}`);
}
