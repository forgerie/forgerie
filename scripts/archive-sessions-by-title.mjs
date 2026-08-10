#!/usr/bin/env node

/**
 * Archive every Forgerie session whose title (session name) matches exactly.
 *
 * Reads the running instance's machine catalog, filters by title, and posts a
 * bulk archive. Dry run by default; pass --apply to mutate.
 *
 * Usage:
 *   archive-sessions-by-title.mjs "<title>" [--apply] [--base http://127.0.0.1:8504]
 */

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const baseIndex = args.indexOf("--base");
const base = baseIndex === -1 ? "http://127.0.0.1:8504" : args[baseIndex + 1];
const baseValueIndex = baseIndex === -1 ? -1 : baseIndex + 1;
const title = args.find((arg, index) => !arg.startsWith("--") && index !== baseValueIndex);

if (title === undefined) {
  console.error("usage: archive-sessions-by-title.mjs \"<title>\" [--apply] [--base URL]");
  process.exit(2);
}

const prefix = `${base}/api/machines/local`;

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} -> ${response.status} ${await response.text()}`);
  return response.json();
}

const catalog = await getJson(`${prefix}/sessions/all`);
const entries = Array.isArray(catalog) ? catalog : (catalog.sessions ?? []);
if (!Array.isArray(entries)) {
  console.error("unexpected catalog shape:", Object.keys(catalog));
  process.exit(1);
}

const matches = entries.filter((entry) => (entry.name ?? "").trim() === title);
const alreadyArchived = matches.filter((entry) => entry.archived === true);
const toArchive = matches.filter((entry) => entry.archived !== true);

console.log(`catalog entries: ${entries.length}`);
console.log(`title matches:   ${matches.length} (already archived: ${alreadyArchived.length})`);
for (const entry of toArchive) console.log(`  ${entry.id}  ${entry.cwd}  ${entry.modified ?? ""}`);

if (!apply) {
  console.log("\ndry run — pass --apply to archive");
  process.exit(0);
}

if (toArchive.length === 0) {
  console.log("nothing to archive");
  process.exit(0);
}

const response = await fetch(`${prefix}/sessions/bulk/archive`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ sessions: toArchive.map((entry) => ({ id: entry.id, cwd: entry.cwd })) }),
});
const text = await response.text();
console.log(`bulk/archive -> ${response.status}`);
console.log(text);
if (!response.ok) process.exit(1);
