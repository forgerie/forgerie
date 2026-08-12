#!/usr/bin/env node
/**
 * Rename a session by patching its `session_info` line inside the transcript's
 * first 64 KiB, in place and at a fixed byte length.
 *
 * SessionCatalogScanner reads 64 KiB from each end of a transcript and prefers
 * a name found in the tail, falling back to the head. On a large session a
 * rename appended at the tail scrolls out of that window and the stale head
 * name reappears. Patching the head line is what makes a rename stick.
 *
 * The replacement name is padded with trailing spaces to the exact byte length
 * of the line it replaces, so the write is positional: no rewrite of a
 * multi-megabyte file, and no race with the daemon appending at EOF. Both
 * scanners trim the name, so the padding is invisible.
 *
 * Dry run by default. `--apply` performs the patch after saving the original
 * bytes next to the undo record.
 *
 * Usage:
 *   rename-session-in-place.mjs <transcript.jsonl> "<new name>" [--apply]
 */

import { open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const positional = args.filter((arg) => !arg.startsWith("--"));
const [transcriptPath, newName] = positional;

if (transcriptPath === undefined || newName === undefined) {
  console.error('usage: rename-session-in-place.mjs <transcript.jsonl> "<new name>" [--apply]');
  process.exit(2);
}

const PREFIX_WINDOW_BYTES = 64 * 1024;
const undoPath = join(homedir(), ".local/share/forgerie/renamed-session-lines.json");

const file = await open(transcriptPath, apply ? "r+" : "r");
const head = Buffer.allocUnsafe(PREFIX_WINDOW_BYTES);
const { bytesRead } = await file.read(head, 0, PREFIX_WINDOW_BYTES, 0);
const window = head.subarray(0, bytesRead);

const needle = Buffer.from('"type":"session_info"');
const matches = [];
let cursor = -1;
while ((cursor = window.indexOf(needle, cursor + 1)) !== -1) {
  const start = window.lastIndexOf(10, cursor) + 1;
  let end = window.indexOf(10, cursor);
  if (end === -1) end = window.length;
  matches.push({ start, length: end - start, line: window.subarray(start, end).toString("utf8") });
}

if (matches.length === 0) {
  console.error(`no session_info line in the first ${PREFIX_WINDOW_BYTES} bytes — nothing to patch`);
  await file.close();
  process.exit(1);
}

// The scanner keeps the last name it sees in the window, so that is the one
// that must change.
const target = matches[matches.length - 1];
const entry = JSON.parse(target.line);
const rebuilt = (padding) => JSON.stringify({ ...entry, name: newName + " ".repeat(padding) });

let padding = 0;
while (Buffer.byteLength(rebuilt(padding), "utf8") < target.length) padding += 1;
const replacement = rebuilt(padding);
const replacementLength = Buffer.byteLength(replacement, "utf8");

console.log(`file:        ${transcriptPath}`);
console.log(`session_info lines in head window: ${matches.length} (patching the last)`);
console.log(`offset:      ${target.start}   length: ${target.length}`);
console.log(`current:     ${JSON.stringify(entry["name"])}`);
console.log(`replacement: ${JSON.stringify(newName)} + ${padding} space(s) -> ${replacementLength} bytes`);

if (replacementLength !== target.length) {
  console.error(`\nrefusing: replacement is ${replacementLength} bytes, line is ${target.length}. An in-place patch must match exactly.`);
  await file.close();
  process.exit(1);
}

if (!apply) {
  console.log("\ndry run — pass --apply to patch");
  await file.close();
  process.exit(0);
}

await writeFile(undoPath, `${JSON.stringify({ transcriptPath, offset: target.start, original: target.line }, null, 2)}\n`, "utf8");
await file.write(Buffer.from(replacement, "utf8"), 0, target.length, target.start);
await file.close();
console.log(`\npatched. original line saved to ${undoPath}`);
