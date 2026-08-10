#!/usr/bin/env node
/**
 * Mark sessions that an agent spawned, for transcripts written before the
 * daemon started recording it.
 *
 * The signal is the same one the daemon uses live: a tool result that names a
 * `sessionFile` made that session. Here it is read back out of the parents'
 * transcripts instead of being witnessed as it happens.
 *
 * Read-only unless --write is passed.
 */
import { readdirSync, statSync, existsSync, createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { homedir } from "node:os";

const WRITE = process.argv.includes("--write");
const ROOT = process.argv.find((a) => a.startsWith("--sessions="))?.slice("--sessions=".length)
  ?? join(homedir(), ".pi", "agent", "sessions");

function* sessionFiles() {
  for (const project of readdirSync(ROOT)) {
    const dir = join(ROOT, project);
    let isDir = false;
    try { isDir = statSync(dir).isDirectory(); } catch { continue; }
    if (!isDir) continue;
    for (const entry of readdirSync(dir)) {
      if (entry.endsWith(".jsonl")) yield join(dir, entry);
    }
  }
}

/** Every session file path named by a tool result anywhere in this transcript. */
async function spawnedByTranscript(path) {
  const found = new Set();
  await new Promise((resolve, reject) => {
    const stream = createReadStream(path);
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    stream.on("error", reject);
    rl.on("close", resolve);
    rl.on("line", (line) => {
      if (!line.includes("sessionFile")) return;
      for (const match of line.matchAll(/"sessionFile":"((?:[^"\\]|\\.)*)"/g)) {
        try { found.add(JSON.parse(`"${match[1]}"`)); } catch { /* unparseable path */ }
      }
    });
  });
  return found;
}

const all = [...sessionFiles()];
console.log(`scanning ${all.length} session files for spawn records…`);

const spawned = new Set();
let scanned = 0;
for (const file of all) {
  scanned += 1;
  if (scanned % 500 === 0) process.stdout.write(`  ${scanned}/${all.length}\n`);
  try {
    for (const child of await spawnedByTranscript(file)) spawned.add(child);
  } catch { /* unreadable transcript */ }
}

const present = [...spawned].filter((p) => existsSync(p));
console.log(`\nsessions named as spawned : ${spawned.size}`);
console.log(`of those, present on disk : ${present.length}`);

let marked = 0;
let already = 0;
for (const path of present) {
  const content = await readFile(path, "utf8");
  const newlineIndex = content.indexOf("\n");
  const firstLine = newlineIndex === -1 ? content : content.slice(0, newlineIndex);
  const rest = newlineIndex === -1 ? "" : content.slice(newlineIndex);
  let header;
  try { header = JSON.parse(firstLine); } catch { continue; }
  if (header?.type !== "session") continue;
  if (header.agentSpawned === true) { already += 1; continue; }
  marked += 1;
  if (!WRITE) continue;
  header.agentSpawned = true;
  const next = `${JSON.stringify(header)}${rest}`;
  // Same-inode rewrite, matching what the daemon does, then read back and
  // check the header still parses. A partial write here would destroy a
  // transcript, so a failed check restores the original bytes.
  await writeFile(path, next, "utf8");
  const verify = await readFile(path, "utf8");
  let ok = verify.length === next.length;
  if (ok) {
    try { ok = JSON.parse(verify.slice(0, verify.indexOf("\n")))?.type === "session"; }
    catch { ok = false; }
  }
  if (!ok) {
    await writeFile(path, content, "utf8");
    console.error(`  restored after failed verify: ${path}`);
    marked -= 1;
  }
}

console.log(`already marked           : ${already}`);
console.log(`${WRITE ? "marked" : "would mark"}               : ${marked}`);
if (!WRITE) console.log("\nre-run with --write to apply.");
