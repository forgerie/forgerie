/**
 * The `agentSpawned` header mark: who may write it, and when it is safe to.
 *
 * The inbox's top level is the conversations a human is in. A session an agent
 * made belongs to the session that owns it, and nothing in a spawned session's
 * own file says which it is -- `parentSession` is written for ordinary
 * continuations too. So the fact is recorded in the child's header when some
 * transcript is seen naming it, and every reader trusts the header afterwards.
 *
 * Writing that mark means rewriting the first line, which means rewriting the
 * whole file, because the header's length changes and every later byte shifts.
 * That is safe only while nothing else is appending to the file. A concurrent
 * append during the rewrite interleaves with it and corrupts the transcript,
 * and no read-back check can undo that. The rewrite is therefore gated twice:
 * the file must have been quiet for a while, and it must not have changed
 * between the read and the write. A caller that knows the writer has exited --
 * the daemon at tool end -- can waive the quiet period, never the size check.
 */

import { readFile, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

/**
 * Long enough that an agent still emitting tokens is never mistaken for a
 * finished one, short enough that a repair pass makes progress on each run.
 */
const DEFAULT_QUIET_PERIOD_MS = 60_000;

export type AgentSpawnedMarkOutcome =
  | { readonly kind: "marked" }
  | { readonly kind: "already" }
  /** The file is being written, or changed under the read. Try again later. */
  | { readonly kind: "busy" }
  | { readonly kind: "absent" }
  | { readonly kind: "not-a-session" };

export interface MarkAgentSpawnedOptions {
  /**
   * How long the file must have been untouched before the rewrite is trusted.
   * Pass 0 only with independent proof that the writing process has exited.
   */
  readonly requireQuietForMs?: number;
  /** Test seam: runs between the read and the write, where a racing append lands. */
  readonly onBeforeWrite?: () => Promise<void>;
}

export async function markAgentSpawned(
  sessionFile: string,
  options: MarkAgentSpawnedOptions = {},
): Promise<AgentSpawnedMarkOutcome> {
  const quietFor = options.requireQuietForMs ?? DEFAULT_QUIET_PERIOD_MS;

  const before = await statOrUndefined(sessionFile);
  if (before === undefined) return { kind: "absent" };
  if (quietFor > 0 && Date.now() - before.mtimeMs < quietFor) return { kind: "busy" };

  const content = await readFile(sessionFile, "utf8");
  const newlineIndex = content.indexOf("\n");
  const firstLine = newlineIndex === -1 ? content : content.slice(0, newlineIndex);
  const rest = newlineIndex === -1 ? "" : content.slice(newlineIndex);

  let header: unknown;
  try { header = JSON.parse(firstLine); } catch { return { kind: "not-a-session" }; }
  if (!isRecord(header) || header["type"] !== "session") return { kind: "not-a-session" };
  if (header["agentSpawned"] === true) return { kind: "already" };

  await options.onBeforeWrite?.();

  // Anything that touched the file since the read invalidates `rest`, and
  // writing a stale `rest` would drop whatever was appended.
  const afterRead = await statOrUndefined(sessionFile);
  if (afterRead === undefined) return { kind: "absent" };
  if (afterRead.size !== before.size || afterRead.mtimeMs !== before.mtimeMs) return { kind: "busy" };

  header["agentSpawned"] = true;
  await writeFile(sessionFile, `${JSON.stringify(header)}${rest}`, "utf8");
  return { kind: "marked" };
}

/**
 * Every session file path this transcript's tool results name.
 *
 * A result that hands back a `sessionFile` is saying it made that session,
 * whichever tool it came from. Read line by line because transcripts reach
 * tens of megabytes, and matched textually because the payload shape varies by
 * tool and only this one field is load-bearing.
 */
export async function readSpawnedSessionPaths(transcriptPath: string): Promise<Set<string>> {
  const found = new Set<string>();
  try {
    const stream = createReadStream(transcriptPath);
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    await new Promise<void>((resolve, reject) => {
      stream.on("error", reject);
      lines.on("error", reject);
      lines.on("close", () => { resolve(); });
      lines.on("line", (line: string) => {
        if (!line.includes("sessionFile")) return;
        for (const match of line.matchAll(/"sessionFile":"((?:[^"\\]|\\.)*)"/g)) {
          const raw = match[1];
          if (raw === undefined || raw === "") continue;
          try {
            const decoded: unknown = JSON.parse(`"${raw}"`);
            if (typeof decoded === "string" && decoded !== "") found.add(decoded);
          } catch { /* unparseable path */ }
        }
      });
    });
  } catch {
    // An unreadable transcript names nothing. It is evidence we do not have,
    // not a failure worth propagating into a listing or a repair pass.
    return found;
  }
  return found;
}

async function statOrUndefined(path: string): Promise<{ size: number; mtimeMs: number } | undefined> {
  try {
    const stats = await stat(path);
    return { size: stats.size, mtimeMs: stats.mtimeMs };
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
