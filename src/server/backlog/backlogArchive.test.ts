import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionArchiveStore, type ArchiveSessionInput } from "../sessions/sessionArchiveStore.js";
import { BacklogClaimStore } from "./backlogClaimStore.js";
import { withBacklogClaimRelease } from "./backlogArchive.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "forgerie-backlog-archive-")); directories.push(root);
  const archive = new SessionArchiveStore(join(root, "archives.json")); await archive.initialize();
  const claims = new BacklogClaimStore(join(root, "claims.json")); await claims.initialize();
  const wrapped = withBacklogClaimRelease(archive, claims);
  const add = async (id: string): Promise<ArchiveSessionInput> => {
    const path = join(root, `${id}.jsonl`); await writeFile(path, `${id}\n`);
    const reservation = await claims.reserve({ projectId: "project", itemId: id, requestId: id, fingerprint: id, cwd: root, repo: root });
    await claims.bind(reservation.claimId, id, root);
    return { sessionId: id, path, cwd: root, created: "2026-09-01", modified: "2026-09-01", messageCount: 1, firstMessage: "Work" };
  };
  return { archive, claims, wrapped, add, root };
}

describe("backlog archive lifecycle", () => {
  it("releases the archived owner while retaining other sessions' claims", async () => {
    const f = await fixture(); const input = await f.add("one"); await f.add("two");
    await f.wrapped.archive(input);
    expect((await f.claims.list()).map((claim) => claim.itemId)).toEqual(["two"]);
    expect(await f.archive.isArchived("one")).toBe(true);
    await f.wrapped.restore("one");
    expect((await f.claims.list()).map((claim) => claim.itemId)).toEqual(["two"]);
  });
  it("releases bulk archive owners and covers deletion after an interrupted release", async () => {
    const f = await fixture(); const inputs = await Promise.all([f.add("one"), f.add("two")]);
    await f.wrapped.archiveMany?.(inputs); expect(await f.claims.list()).toEqual([]);
    const third = await f.add("three");
    await f.archive.archive(third); // Simulate archive committed before the release callback ran.
    expect(await f.claims.list()).toHaveLength(1);
    await f.wrapped.deleteArchivedMany?.(["three"]);
    expect(await f.claims.list()).toEqual([]);
    expect(await f.archive.isArchived("three")).toBe(false);
  });
  it("does not release a claim when archiving fails before persistence", async () => {
    const f = await fixture(); const input = await f.add("one");
    await rm(input.path); // Missing input prevents the real archive from committing.
    await expect(f.wrapped.archive(input)).rejects.toThrow();
    expect(await f.claims.list()).toHaveLength(1);
  });
});
