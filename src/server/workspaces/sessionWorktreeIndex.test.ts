import { describe, expect, it } from "vitest";
import type { SessionWorktreeRecord, WorktreeLifecycleState } from "../../shared/sessionWorktree.js";
import { indexWorktreeRecords, worktreeRecordForSession } from "./sessionWorktreeStore.js";

/** Small deterministic generator, so a failure names a reproducible seed. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; };
}

const roots: [string, ...string[]] = ["/", "/repo", "/repo/", "/repo/.worktrees/a", "/repo/.worktrees/a/", "/repo/.worktrees/b", "/other", "/other/deep/x", "/repo/sub"];
const ids: [string, ...string[]] = ["s1", "s1-long", "s2", "s20", "child-1", "child-10"];
const states: [WorktreeLifecycleState, ...WorktreeLifecycleState[]] = [{ kind: "active" }, { kind: "landed", sha: "abc", at: "2026-01-01T00:00:00.000Z" }, { kind: "discarded", at: "2026-01-01T00:00:00.000Z" }];

function worktreeRecord(fields: { id: string; path: string; state: WorktreeLifecycleState; sessionId?: string | undefined; transcripts?: { id: string; cwd: string }[] }): SessionWorktreeRecord {
  return {
    id: fields.id, repo: "/repo", path: fields.path, branch: `b-${fields.id}`, defaultBranch: "main", renamed: false,
    setup: { phase: "done", log: "" }, state: fields.state, cleanup: { kind: "pending" },
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    ...(fields.sessionId === undefined ? {} : { sessionId: fields.sessionId }),
    transcripts: (fields.transcripts ?? []).map((transcript) => ({ ...transcript, transcriptPath: `/t/${transcript.id}.jsonl`,
      session: { id: transcript.id, cwd: transcript.cwd, path: `/t/${transcript.id}.jsonl`, created: "c", modified: "m", messageCount: 0, firstMessage: "" } })),
  };
}

function generated(next: () => number, index: number): SessionWorktreeRecord {
  const pick = <T,>(items: readonly [T, ...T[]]): T => items[Math.floor(next() * items.length)] ?? items[0];
  return worktreeRecord({
    id: `wt-${String(index)}`, path: pick(roots), state: pick(states),
    sessionId: next() < 0.6 ? pick(ids) : undefined,
    transcripts: Array.from({ length: Math.floor(next() * 3) }, () => ({ id: pick(ids), cwd: pick(roots) })),
  });
}

describe("indexWorktreeRecords", () => {
  it("finds exactly the record worktreeRecordForSession finds, for random records and sessions", () => {
    for (let seed = 1; seed <= 400; seed++) {
      const next = random(seed);
      const records = Array.from({ length: Math.floor(next() * 12) }, (_, index) => generated(next, index));
      const find = indexWorktreeRecords(records);
      for (const id of [...ids, "s", "child", "missing"]) {
        for (const cwd of [...roots, "/repo/.worktrees/a/nested/dir", "/other/deep/x/y", "/nowhere"]) {
          expect(find({ id, cwd }), `seed ${String(seed)} id ${id} cwd ${cwd}`).toBe(worktreeRecordForSession(records, { id, cwd }));
        }
      }
    }
  });

  it("keeps the first matching record when several match", () => {
    const records = [
      worktreeRecord({ id: "outer", path: "/repo", state: { kind: "active" } }),
      worktreeRecord({ id: "inner", path: "/repo/.worktrees/a", state: { kind: "active" } }),
      worktreeRecord({ id: "owner", path: "/repo/.worktrees/a", state: { kind: "active" }, sessionId: "s1" }),
    ];
    const find = indexWorktreeRecords(records);
    expect(find({ id: "s1", cwd: "/repo/.worktrees/a" })?.id).toBe("owner");
    expect(find({ id: "s9", cwd: "/repo/.worktrees/a/deep" })?.id).toBe("outer");
  });
});
