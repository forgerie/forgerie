#!/usr/bin/env node
/**
 * Diagnose inbox rows that refuse to archive.
 *
 * For every live (non-archived) catalog row it compares the transcript's
 * containing session directory against the directory the server derives from
 * the row's cwd. A mismatch means per-session routes keyed on (id, cwd) cannot
 * resolve the file, which surfaces in the app as a row that will not archive.
 *
 * Read-only unless --probe is passed, which issues a single-session bulk
 * archive per candidate to record the server's real answer (and archives the
 * ones that succeed).
 */

import { access } from "node:fs/promises";
import { basename, dirname } from "node:path";

const args = process.argv.slice(2);
const probe = args.includes("--probe");
const base = args.find((arg) => arg.startsWith("http")) ?? "http://127.0.0.1:8504";
const prefix = `${base}/api/machines/local`;

/**
 * Pi's on-disk session-directory encoding for a cwd. Mirrors
 * sessionDirInDefaultPiStore in src/server/sessions/piSessionManagerGateway.ts.
 */
function sessionDirNameForCwd(cwd) {
  return `--${cwd.replace(/^[/\\]/u, "").replace(/[/\\:]/gu, "-")}--`;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const response = await fetch(`${prefix}/sessions/all`);
if (!response.ok) throw new Error(`GET sessions/all -> ${response.status}`);
const catalog = await response.json();
const entries = (Array.isArray(catalog) ? catalog : (catalog.sessions ?? [])).filter((entry) => entry.archived !== true);

const rows = [];
for (const entry of entries) {
  const actualDir = basename(dirname(entry.path));
  const expectedDir = sessionDirNameForCwd(entry.cwd);
  rows.push({
    ...entry,
    actualDir,
    expectedDir,
    dirMismatch: actualDir !== expectedDir,
    cwdExists: await exists(entry.cwd),
    fileExists: await exists(entry.path),
  });
}

const suspect = rows.filter((row) => row.dirMismatch || !row.cwdExists || !row.fileExists);
console.log(`live rows: ${rows.length}   suspect: ${suspect.length}`);
for (const row of suspect.sort((a, b) => (a.modified ?? "").localeCompare(b.modified ?? ""))) {
  const flags = [
    row.dirMismatch ? "dir-mismatch" : undefined,
    row.cwdExists ? undefined : "cwd-gone",
    row.fileExists ? undefined : "file-gone",
  ].filter(Boolean).join(",");
  console.log(`\n${row.modified}  ${row.id}  [${flags}]`);
  console.log(`  cwd:      ${row.cwd}`);
  console.log(`  in dir:   ${row.actualDir}`);
  console.log(`  expected: ${row.expectedDir}`);
}

if (!probe) {
  console.log("\n(read-only — pass --probe to ask the server to archive each and report its answer)");
  process.exit(0);
}

console.log("\nprobing archive per session:");
for (const row of suspect) {
  const result = await fetch(`${prefix}/sessions/bulk/archive`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessions: [{ id: row.id, cwd: row.cwd }] }),
  });
  const body = await result.json();
  const failure = body.failures?.[0];
  console.log(`  ${row.id}  ${failure === undefined ? "archived" : `FAILED: ${failure.error}`}`);
}
