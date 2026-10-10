import { describe, expect, it } from "vitest";
import { createChildAgentsStore, type Request } from "./childAgentsStore";
import { landBlocker, totalCost } from "./childWorkModel";
import { FINISHED, DISCARD, RUNS } from "./fixtures/childWork";

const reply = (value: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(value), { status }));
describe("child branch controls", () => {
  it("fails readiness closed for dirty, busy, waiting, unreadable and removed worktrees", () => {
    expect(landBlocker(FINISHED)).toBeUndefined();
    expect(landBlocker({ ...FINISHED, busy: true })).toContain("Stop");
    expect(landBlocker({ ...FINISHED, questions: [{ questionId: "q", question: "Go?", askedAt: 1 }] })).toContain("Stop");
    for (const worktree of [{ ...FINISHED.worktree!, dirty: true }, { ...FINISHED.worktree!, state: "landed" as const }, { ...FINISHED.worktree!, statusError: "Git failed" }]) {
      expect(landBlocker({ ...FINISHED, worktree })).toBeDefined();
    }
  });
  it("does not price missing usage as free", () => {
    expect(totalCost(RUNS)).toBe("$0.51");
    expect(totalCost({ ...RUNS, records: [{ ...RUNS.records[0]!, usage: null }] })).toBe("$0.00 + unknown");
  });
  it("passes the reviewed token and presents a stale outcome instead of claiming removal", async () => {
    const writes: unknown[] = [];
    const request: Request = (path, init) => {
      if (path.endsWith("/discard-preview")) return reply(DISCARD.data);
      if (path.endsWith("/discard")) { writes.push(JSON.parse(String(init.body))); return reply({ kind: "stale-preview" }); }
      if (path.includes("/messages")) return reply({ messages: [], busy: false });
      if (path.includes("/runs?")) return reply(RUNS);
      return reply([FINISHED]);
    };
    const store = createChildAgentsStore(request, () => ({ id: "parent", cwd: "/parent" }));
    try {
      store.open(44);
      await store.previewDiscard(44);
      expect(store.getSnapshot().detail).toEqual(DISCARD);
      await store.discard(44, DISCARD.data.confirmationToken);
      expect(writes).toEqual([{ cwd: "/parent", confirmationToken: "fixture-confirmation" }]);
      expect(store.getSnapshot().outcome).toEqual({ kind: "stale-preview" });
      expect(store.getSnapshot().detail).toEqual({ kind: "none" });
      expect(store.getSnapshot().children[0]?.worktree?.state).toBe("active");
    } finally { store.dispose(); }
  });
  it("a delayed review cannot reopen the view after Back", async () => {
    let resolve!: (value: Response) => void;
    const store = createChildAgentsStore(() => new Promise((done) => { resolve = done; }), () => ({ id: "parent", cwd: "/parent" }));
    const loading = store.review(44);
    store.dismissDetail();
    resolve(new Response(JSON.stringify({ head: "abc", sections: [], untracked: [] })));
    await loading;
    expect(store.getSnapshot().detail).toEqual({ kind: "none" });
    store.dispose();
  });
  it("does not reopen a child after a delayed continuation when the user closed the panel", async () => {
    let finish!: (value: Response) => void;
    const request: Request = (path) => path.endsWith("/continue") ? new Promise((resolve) => { finish = resolve; })
      : path.includes("/messages") ? reply({ messages: [], busy: false }) : path.includes("/runs?") ? reply(RUNS) : reply([FINISHED]);
    const store = createChildAgentsStore(request, () => ({ id: "parent", cwd: "/parent" }));
    try {
      store.open(44);
      const pending = store.continue(44, "Next task");
      store.close();
      finish(new Response(JSON.stringify({ conversationId: 45 })));
      await pending;
      expect(store.getSnapshot().open).toBeUndefined();
    } finally { store.dispose(); }
  });
  it("retries the same detail operation after a read failure", async () => {
    for (const action of ["openRuns", "openCleanup", "previewDiscard"] as const) {
      const paths: string[] = [];
      const store = createChildAgentsStore((path) => { paths.push(path); return reply({ error: "Unavailable" }, 503); }, () => ({ id: "parent", cwd: "/parent" }));
      try {
        await store[action](44);
        expect(store.getSnapshot().detail?.kind).toBe("failed");
        await store.retryDetail();
        expect(paths).toHaveLength(2);
        expect(paths[1]).toBe(paths[0]);
      } finally { store.dispose(); }
    }
  });
  it("reuses the continuation request after a lost response", async () => {
    const ids: string[] = [];
    const request: Request = (path, init) => {
      if (path.endsWith("/continue")) {
        ids.push(JSON.parse(String(init.body)).requestId);
        return ids.length === 1 ? Promise.reject(new Error("Connection lost")) : reply({ conversationId: 45 });
      }
      if (path.includes("/messages")) return reply({ messages: [], busy: false });
      if (path.includes("/runs?")) return reply(RUNS);
      return reply([{ ...FINISHED, conversationId: 45 }]);
    };
    const store = createChildAgentsStore(request, () => ({ id: "parent", cwd: "/parent" }));
    try {
      await expect(store.continue(44, "Next task")).rejects.toThrow("Connection lost");
      await store.continue(44, "Next task");
      expect(ids).toHaveLength(2);
      expect(ids[0]).toBe(ids[1]);
      expect(store.getSnapshot().open?.conversationId).toBe(45);
    } finally { store.dispose(); }
  });
});
