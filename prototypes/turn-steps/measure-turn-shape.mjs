#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 --command node
// Measures how assistant turns are built in Pi session files:
// per assistant message, the order of part kinds (T=text, R=thinking, C=toolCall).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2];
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === ".durable") continue;
    let st; try { st = statSync(path); } catch { continue; }
    if (st.isDirectory()) walk(path);
    else if (name.endsWith(".jsonl")) files.push({ path, mtime: st.mtimeMs });
  }
};
walk(root);
files.sort((a, b) => b.mtime - a.mtime);

const shapes = new Map();
const byModel = new Map();
let messages = 0, withCalls = 0, textThenCalls = 0, callsNoText = 0, textAfterCall = 0, finalNoCalls = 0;
let wordsBeforeCalls = [];
let turns = 0, stepsPerTurn = [];
let steps = 0;
for (const { path } of files.slice(0, 60)) {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    let entry; try { entry = JSON.parse(line); } catch { continue; }
    const m = entry.message;
    if (!m) continue;
    if (m.role === "user") { if (steps) { stepsPerTurn.push(steps); turns++; } steps = 0; continue; }
    if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
    messages++;
    const kinds = m.content.map((p) => p.type === "text" ? (p.text.trim() ? "T" : "") : p.type === "thinking" ? "R" : p.type === "toolCall" ? "C" : "?").join("");
    const shape = kinds.replace(/C+/g, "C+").replace(/R+/g, "R");
    shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
    const hasCall = kinds.includes("C");
    if (hasCall) {
      const model = m.model ?? "?";
      const row = byModel.get(model) ?? { calls: 0, narrated: 0 };
      row.calls++;
      if (kinds.slice(0, kinds.indexOf("C")).includes("T")) row.narrated++;
      byModel.set(model, row);
      steps++;
      withCalls++;
      const before = kinds.slice(0, kinds.indexOf("C"));
      if (before.includes("T")) {
        textThenCalls++;
        const text = m.content.filter((p) => p.type === "text").map((p) => p.text).join(" ");
        wordsBeforeCalls.push(text.split(/\s+/).filter(Boolean).length);
      } else callsNoText++;
      if (kinds.slice(kinds.indexOf("C")).includes("T")) textAfterCall++;
    } else finalNoCalls++;
  }
  if (steps) { stepsPerTurn.push(steps); turns++; steps = 0; }
}
const pct = (n) => `${((100 * n) / withCalls).toFixed(1)}%`;
wordsBeforeCalls.sort((a, b) => a - b);
stepsPerTurn.sort((a, b) => a - b);
const q = (arr, f) => arr[Math.floor(arr.length * f)] ?? 0;
console.log({ files: Math.min(files.length, 60), assistantMessages: messages, messagesWithToolCalls: withCalls,
  narrationThenCalls: `${textThenCalls} (${pct(textThenCalls)})`, callsWithNoNarration: `${callsNoText} (${pct(callsNoText)})`,
  textAfterACall: `${textAfterCall} (${pct(textAfterCall)})`, messagesWithoutCalls: finalNoCalls,
  narrationWords: { p50: q(wordsBeforeCalls, 0.5), p90: q(wordsBeforeCalls, 0.9), max: wordsBeforeCalls.at(-1) },
  toolStepsPerTurn: { turns, p50: q(stepsPerTurn, 0.5), p90: q(stepsPerTurn, 0.9), max: stepsPerTurn.at(-1) } });
console.log([...byModel].filter(([, r]) => r.calls >= 100).map(([m, r]) => `${m}: ${r.narrated}/${r.calls} = ${(100 * r.narrated / r.calls).toFixed(0)}%`));
console.log([...shapes].sort((a, b) => b[1] - a[1]).slice(0, 10));
