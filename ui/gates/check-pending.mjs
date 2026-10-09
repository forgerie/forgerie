#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#git --command node
// The ratchet only tightens: no gate may list more offenders than it did at <base-ref>.
// A moved file renames its entries, so the check compares counts per gate, not entry names.
// Usage: gates/check-pending.mjs [base-ref]   (default: main). Exit 1 if any gate grew.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const base = process.argv[2] ?? "main";
const path = new URL("pending.json", import.meta.url);
const current = JSON.parse(readFileSync(path, "utf8"));
let before;
try {
  before = JSON.parse(execFileSync("git", ["show", `${base}:ui/gates/pending.json`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
} catch {
  console.log(`${base} has no ui/gates/pending.json; nothing to compare.`);
  process.exit(0);
}
const gates = [...new Set([...Object.keys(before), ...Object.keys(current)])].sort();
let grew = false;
for (const gate of gates) {
  const was = before[gate]?.length ?? 0;
  const now = current[gate]?.length ?? 0;
  if (now > was) grew = true;
  if (now !== was) console.log(`${now > was ? "GREW  " : "shrank"} ${String(was).padStart(4)} -> ${String(now).padStart(4)}  ${gate}`);
}
const total = (inventory) => Object.values(inventory).reduce((sum, list) => sum + list.length, 0);
console.log(`total ${total(before)} -> ${total(current)}`);
if (grew) { console.log("A gate's list grew. Fix the new offence instead of recording it."); process.exitCode = 1; }
