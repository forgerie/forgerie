import type { BigIntStats } from "node:fs";
import { stat, type FileHandle } from "node:fs/promises";

/** Exact file identity, with numeric offsets suitable for Node's read API. */
export interface SessionFileStats {
  readonly dev: string;
  readonly ino: string;
  readonly size: number;
  readonly mtimeNs: bigint;
  readonly mtime: Date;
  readonly birthtime: Date;
}

export async function readSessionFileStats(source: string | FileHandle): Promise<SessionFileStats> {
  const stats = typeof source === "string"
    ? await stat(source, { bigint: true })
    : await source.stat({ bigint: true });
  return sessionFileStats(stats);
}

export function sessionFileStats(stats: BigIntStats): SessionFileStats {
  const size = Number(stats.size);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new RangeError("Session file size exceeds safe read offsets");
  }
  // Converting an already-rounded numeric inode to BigInt cannot restore it.
  // Request BigInt stats at the filesystem boundary and serialize identity only.
  return {
    dev: stats.dev.toString(),
    ino: stats.ino.toString(),
    size,
    mtimeNs: stats.mtimeNs,
    mtime: stats.mtime,
    birthtime: stats.birthtime,
  };
}
