/**
 * Recover the `agentSpawned` mark for children the daemon never witnessed.
 *
 * The live rule records delegation when it happens: a tool result naming a
 * `sessionFile` made that session, and the daemon writes the mark into the
 * child's header. That only reaches runs the daemon was streaming. A session
 * driven from the terminal, or one whose run outlived a daemon restart, leaves
 * a child that nothing ever marked, and it sits in the inbox forever.
 *
 * The evidence survives in the parents' transcripts, so it can be read back
 * afterwards. This sweep does exactly that, and it is deliberately indifferent
 * to which transcript names a child: a parent that was later renamed still
 * names the children it made, which is why children of a `-recovered` file are
 * recoverable at all. Children are matched by path, not by lineage, because
 * `parentSession` means "continues from" and not "was made by".
 *
 * A sweep reads whole transcripts, so it is a background repair and never sits
 * in front of a listing. The memo makes repeat sweeps cheap: a transcript is
 * re-read only when its size or mtime changes.
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { markAgentSpawned, readSpawnedSessionPaths } from "./agentSpawnedMarks.js";

export interface AgentSpawnedRepairReport {
  /** Transcripts actually read this sweep. Unchanged ones are not re-read. */
  readonly scanned: number;
  /** Distinct session files some transcript said it made. */
  readonly named: number;
  readonly marked: number;
  readonly already: number;
  /** Named children still being written. A later sweep picks them up. */
  readonly busy: number;
  readonly absent: number;
}

/** Transcript path -> its identity when last read, plus what it named. */
export type AgentSpawnedRepairMemo = Map<string, { size: number; mtimeMs: number; named: readonly string[] }>;

export interface AgentSpawnedRepairOptions {
  /** Carry across sweeps to skip transcripts that have not changed. */
  readonly memo?: AgentSpawnedRepairMemo | undefined;
}

export async function repairAgentSpawnedMarks(
  sessionsRoot: string,
  options: AgentSpawnedRepairOptions = {},
): Promise<AgentSpawnedRepairReport> {
  const memo = options.memo;
  const named = new Set<string>();
  let scanned = 0;

  for (const transcript of await listTranscripts(sessionsRoot)) {
    const stats = await statOrUndefined(transcript);
    if (stats === undefined) continue;

    const remembered = memo?.get(transcript);
    if (remembered?.size === stats.size && remembered.mtimeMs === stats.mtimeMs) {
      for (const path of remembered.named) named.add(path);
      continue;
    }

    scanned += 1;
    const paths = [...await readSpawnedSessionPaths(transcript)];
    memo?.set(transcript, { size: stats.size, mtimeMs: stats.mtimeMs, named: paths });
    for (const path of paths) named.add(path);
  }

  let marked = 0;
  let already = 0;
  let busy = 0;
  let absent = 0;
  for (const child of named) {
    const outcome = await markAgentSpawned(child);
    if (outcome.kind === "marked") marked += 1;
    else if (outcome.kind === "already") already += 1;
    else if (outcome.kind === "busy") busy += 1;
    else if (outcome.kind === "absent") absent += 1;
  }

  return { scanned, named: named.size, marked, already, busy, absent };
}

/**
 * Session files sit one level below the root, in a directory per project.
 * Anything deeper belongs to a tool that keeps its own children out of the
 * catalog already, so walking further would only cost time.
 */
async function listTranscripts(sessionsRoot: string): Promise<string[]> {
  const transcripts: string[] = [];
  let projects;
  try {
    projects = await readdir(sessionsRoot, { withFileTypes: true });
  } catch {
    return transcripts;
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const dir = join(sessionsRoot, project.name);
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".jsonl")) transcripts.push(join(dir, entry.name));
    }
  }
  return transcripts;
}

async function statOrUndefined(path: string): Promise<{ size: number; mtimeMs: number } | undefined> {
  try {
    const stats = await stat(path);
    return { size: stats.size, mtimeMs: stats.mtimeMs };
  } catch {
    return undefined;
  }
}
