import { mkdtemp, open, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSessionFileStats, sessionFileStats } from "./sessionFileStats.js";

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "session-file-stats-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("exact session file metadata", () => {
  it("keeps neighboring 64-bit identities distinct even when Numbers alias", async () => {
    const path = join(directory, "session.jsonl");
    await writeFile(path, "session\n");
    const stats = await stat(path, { bigint: true });
    const firstInode = 4035225266124021343n;
    const secondInode = firstInode + 1n;
    expect(Number(firstInode)).toBe(Number(secondInode));
    const first = sessionFileStats({ ...stats, ino: firstInode, dev: firstInode });
    const second = sessionFileStats({ ...stats, ino: secondInode, dev: secondInode });
    expect(first.ino).not.toBe(second.ino);
    expect(first.dev).not.toBe(second.dev);
    expect(first.ino).toBe(firstInode.toString());
    expect(first.size).toBe(8);
  });

  it("reports the opened file's identity after its path is replaced", async () => {
    const path = join(directory, "session.jsonl");
    const replacement = join(directory, "replacement.jsonl");
    await writeFile(path, "original\n");
    const file = await open(path, "r");
    try {
      const original = await readSessionFileStats(file);
      await writeFile(replacement, "replacement\n");
      await rename(replacement, path);
      expect(await readSessionFileStats(file)).toEqual(original);
      expect((await readSessionFileStats(path)).ino).not.toBe(original.ino);
    } finally {
      await file.close();
    }
  });

  it("rejects file lengths that cannot be addressed exactly by Node reads", async () => {
    const path = join(directory, "session.jsonl");
    await writeFile(path, "session\n");
    const stats = await stat(path, { bigint: true });
    expect(() => sessionFileStats({ ...stats, size: BigInt(Number.MAX_SAFE_INTEGER) + 1n })).toThrow("safe read offsets");
  });
});
