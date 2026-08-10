#!/usr/bin/env node
/**
 * Move transcripts that sit in the wrong Pi session directory into the
 * directory their recorded `cwd` implies.
 *
 * Per-session routes resolve a session by searching only the directory derived
 * from its cwd (see sessionDirInDefaultPiStore / resolveSessionFile in
 * src/server/sessions/piSessionManagerGateway.ts). A transcript filed elsewhere
 * is listed by the catalog but cannot be opened, archived, or restored. Moving
 * the file puts it where the resolver looks.
 *
 * Each transcript may have a sidecar directory sharing its stem without the
 * `.jsonl` extension; it holds per-message blobs and moves with the transcript.
 *
 * Dry run by default. `--apply` performs the moves, appending to an undo map
 * before each one so an interrupted run is still reversible.
 *
 * Usage:
 *   relocate-mismatched-sessions.mjs [--apply] [--undo <map.json>] [http://host:port]
 */

import { access, lstat, mkdir, readdir, readFile, readlink, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const undoIndex = args.indexOf("--undo");
const undoMapPath = undoIndex === -1 ? undefined : args[undoIndex + 1];
const base = args.find((arg) => arg.startsWith("http")) ?? "http://127.0.0.1:8504";
const prefix = `${base}/api/machines/local`;
const sessionsRoot = join(homedir(), ".pi/agent/sessions");
const defaultUndoMap = join(homedir(), ".local/share/forgerie/relocated-sessions.json");

/** Mirrors sessionDirInDefaultPiStore in piSessionManagerGateway.ts. */
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

/**
 * Create `dir`, following a dangling symlink to create its real target. Pi's
 * store contains alias symlinks between cwd directories; mkdir on a dangling
 * one fails with ENOENT unless the link target is created first.
 */
async function ensureDir(dir) {
  try {
    const info = await lstat(dir);
    if (info.isSymbolicLink()) {
      const target = await readlink(dir);
      await mkdir(target.startsWith("/") ? target : join(dirname(dir), target), { recursive: true });
      return;
    }
  } catch {
    // Not present at all: plain mkdir below.
  }
  await mkdir(dir, { recursive: true });
}

async function move(from, to) {
  await ensureDir(dirname(to));
  await rename(from, to);
}

/** The sidecar directory for a transcript path, when one exists. */
async function sidecarFor(transcriptPath) {
  const sidecar = transcriptPath.slice(0, -".jsonl".length);
  return (await exists(sidecar)) ? sidecar : undefined;
}

async function readUndoMap(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return [];
  }
}

if (undoMapPath !== undefined) {
  for (const entry of await readUndoMap(undoMapPath)) {
    if (!(await exists(entry.to))) {
      console.log(`skip (not at target): ${entry.to}`);
      continue;
    }
    await move(entry.to, entry.from);
    console.log(`reverted ${basename(entry.to)}`);
  }
  process.exit(0);
}

const response = await fetch(`${prefix}/sessions/all`);
if (!response.ok) throw new Error(`GET sessions/all -> ${response.status}`);
const catalog = await response.json();
const entries = (Array.isArray(catalog) ? catalog : (catalog.sessions ?? [])).filter((entry) => entry.archived !== true);

const plan = [];
for (const entry of entries) {
  const currentDir = dirname(entry.path);
  const targetDir = join(sessionsRoot, sessionDirNameForCwd(entry.cwd));
  if (currentDir === targetDir) continue;
  // Only relocate transcripts filed under the default Pi store; a configured
  // session dir is deliberate placement, not a mismatch.
  if (!currentDir.startsWith(`${sessionsRoot}/`)) continue;
  const moves = [{ from: entry.path, to: join(targetDir, basename(entry.path)) }];
  const sidecar = await sidecarFor(entry.path);
  if (sidecar !== undefined) moves.push({ from: sidecar, to: join(targetDir, basename(sidecar)) });
  plan.push({ id: entry.id, cwd: entry.cwd, moves });
}

// Sidecars orphaned by an earlier partial move: a stem directory whose
// transcript now lives in another session directory.
const plannedSidecars = new Set(plan.flatMap((item) => item.moves.map((step) => step.from)));
const transcriptDirByStem = new Map(entries.map((entry) => [basename(entry.path).slice(0, -".jsonl".length), dirname(entry.path)]));
for (const dirName of await readdir(sessionsRoot)) {
  const sessionDir = join(sessionsRoot, dirName);
  let names;
  try {
    names = await readdir(sessionDir);
  } catch {
    continue;
  }
  for (const name of names) {
    if (name.endsWith(".jsonl")) continue;
    const transcriptDir = transcriptDirByStem.get(name);
    if (transcriptDir === undefined || transcriptDir === sessionDir) continue;
    const from = join(sessionDir, name);
    if (plannedSidecars.has(from)) continue;
    plan.push({ id: `${name} (orphaned sidecar)`, cwd: "", moves: [{ from, to: join(transcriptDir, name) }] });
  }
}

console.log(`live rows: ${entries.length}   to relocate: ${plan.length}\n`);
const collisions = [];
for (const item of plan) {
  console.log(`${item.id}  ${item.cwd}`);
  for (const step of item.moves) {
    const occupied = await exists(step.to);
    if (occupied) collisions.push(step.to);
    console.log(`  ${basename(dirname(step.from))} -> ${basename(dirname(step.to))}  ${basename(step.from)}${occupied ? "  !! TARGET EXISTS" : ""}`);
  }
}

if (collisions.length > 0) {
  console.error(`\nrefusing: ${collisions.length} target path(s) already occupied`);
  process.exit(1);
}

if (!apply) {
  console.log("\ndry run — pass --apply to move");
  process.exit(0);
}

const performed = await readUndoMap(defaultUndoMap);
for (const item of plan) {
  for (const step of item.moves) {
    performed.push(step);
    await writeFile(defaultUndoMap, `${JSON.stringify(performed, null, 2)}\n`, "utf8");
    await move(step.from, step.to);
  }
  console.log(`moved ${item.id}`);
}
console.log(`\nundo map: ${defaultUndoMap}`);
console.log(`revert with: scripts/${basename(process.argv[1])} --undo ${defaultUndoMap}`);
