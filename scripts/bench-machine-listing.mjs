#!/usr/bin/env node
/**
 * Time the machine session catalog endpoint that backs the inbox.
 *
 * Reports payload size and archived/live row counts alongside timings, so a
 * before/after comparison shows both the cost and what changed about the work.
 * The first request is reported separately: it pays for cold scanner memos.
 *
 * Usage: bench-machine-listing.mjs [runs] [http://host:port]
 */

const args = process.argv.slice(2);
const runs = Number(args.find((arg) => /^\d+$/.test(arg)) ?? 7);
const base = args.find((arg) => arg.startsWith("http")) ?? "http://127.0.0.1:8504";
const url = `${base}/api/machines/local/sessions/all`;

const samples = [];
let bytes = 0;
let live = 0;
let archived = 0;

for (let run = 0; run < runs; run += 1) {
  const started = performance.now();
  const response = await fetch(url, { cache: "no-store" });
  const text = await response.text();
  samples.push(performance.now() - started);
  if (run === runs - 1) {
    bytes = Buffer.byteLength(text, "utf8");
    const parsed = JSON.parse(text);
    const entries = Array.isArray(parsed) ? parsed : (parsed.sessions ?? []);
    archived = entries.filter((entry) => entry.archived === true).length;
    live = entries.length - archived;
  }
}

const warm = samples.slice(1).sort((a, b) => a - b);
const median = warm[Math.floor(warm.length / 2)] ?? samples[0];

console.log(`endpoint:      ${url}`);
console.log(`rows:          ${live} live + ${archived} archived = ${live + archived}`);
console.log(`payload:       ${(bytes / 1024 / 1024).toFixed(2)} MiB`);
console.log(`cold request:  ${samples[0].toFixed(0)} ms`);
console.log(`warm median:   ${median.toFixed(0)} ms   (min ${warm[0]?.toFixed(0)}, max ${warm.at(-1)?.toFixed(0)}, n=${warm.length})`);
