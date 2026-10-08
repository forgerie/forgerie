import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionWorktreeRecord } from "../../shared/sessionWorktree.js";
import { SessionArchiveStore } from "../sessions/sessionArchiveStore.js";
import { SessionWorktreeStore } from "./sessionWorktreeStore.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "forgerie-worktree-recovery-"));
  roots.push(root);
  const file = join(root, "worktrees.json");
  const cwd = join(root, "repo/.worktree/owned");
  const path = join(root, "owner.jsonl");
  const timestamp = "2026-10-07T15:25:45.695Z";
  const session = { id: "owner", cwd, path, created: timestamp, modified: timestamp, messageCount: 1, firstMessage: "Fix the bug" };
  await writeFile(path, `${JSON.stringify({ type: "session", id: session.id, cwd })}\n${JSON.stringify({ type: "message", message: { role: "user", content: session.firstMessage } })}\n`);
  const record: SessionWorktreeRecord = {
    id: "worktree-1", repo: join(root, "repo"), path: cwd, branch: "fix-the-bug", defaultBranch: "main",
    sessionId: session.id, ownerSession: session, renamed: true, setup: { phase: "done", log: "setup complete" },
    state: { kind: "active" }, cleanup: { kind: "pending" }, transcripts: [], createdAt: timestamp, updatedAt: timestamp,
  };
  const store = new SessionWorktreeStore(file);
  await store.add(record);
  const archive = new SessionArchiveStore(join(root, "archived-sessions.json"));
  await archive.initialize();
  const archiveOwner = () => archive.archive({ sessionId: session.id, ...session });
  const reload = async () => {
    const restarted = new SessionWorktreeStore(file);
    await restarted.initialize(await archive.list());
    return restarted;
  };
  return { root, file, store, archive, session, record, archiveOwner, reload };
}

describe("worktree ownership after restart", () => {
  it("does not report a saved, archived owner as an interrupted first message", async () => {
    const f = await fixture();
    await f.archiveOwner();
    await expect(readFile(f.session.path)).rejects.toMatchObject({ code: "ENOENT" });
    const restarted = await f.reload();
    expect(await restarted.require(f.record.id)).toEqual(f.record);
    expect(await restarted.forSession(f.session)).toEqual(f.record);
    // The original path stays the restore target, not the archive path.
    await f.archive.restore(f.session.id);
    const restored = await f.reload();
    expect(await restored.require(f.record.id)).toEqual(f.record);
    await expect(readFile(f.session.path, "utf8")).resolves.toContain("Fix the bug");
  });

  it("still offers setup retry when neither the original nor archive transcript exists", async () => {
    const f = await fixture();
    await unlink(f.session.path);
    const restarted = await f.reload();
    expect(await restarted.require(f.record.id)).toMatchObject({
      setup: { phase: "failed", log: "setup complete", error: "Session daemon restarted before the first message was persisted. Retry this setup." },
    });
    expect((await restarted.require(f.record.id)).sessionId).toBeUndefined();
    expect((await restarted.require(f.record.id)).ownerSession).toBeUndefined();
  });

  it.each(["missing", "wrong-id", "wrong-cwd"])("rejects a %s archive transcript", async (behavior) => {
    const f = await fixture();
    const archived = await f.archiveOwner();
    if (archived.archivePath === undefined) throw new Error("Expected archive path");
    if (behavior === "missing") await unlink(archived.archivePath);
    else await writeFile(archived.archivePath, `${JSON.stringify({ type: "session", id: behavior === "wrong-id" ? "other" : f.session.id,
      cwd: behavior === "wrong-cwd" ? join(f.root, "other") : f.session.cwd })}\n`);
    expect((await (await f.reload()).require(f.record.id)).setup.phase).toBe("failed");
  });

  it("does not borrow another archived session in the same worktree", async () => {
    const f = await fixture();
    const otherPath = join(f.root, "other.jsonl");
    await writeFile(otherPath, `${JSON.stringify({ type: "session", id: "other", cwd: f.session.cwd })}\n`);
    await f.archive.archive({ sessionId: "other", ...f.session, path: otherPath });
    await unlink(f.session.path);
    expect((await (await f.reload()).require(f.record.id)).setup.phase).toBe("failed");
  });
});
