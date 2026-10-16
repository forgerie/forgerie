import { describe, expect, it, vi } from "vitest";
import { runKey, type ActionRunApi, type ActionRunItem, type ActionRunLink, type SessionActionRuns } from "./actionRunApi";
import { createActionRunsStore } from "./actionRunsStore";
import { derived, failedRun, items, link, permissionError, runningRun } from "./fixtures/actionRuns";

const ref = { id: "s1", cwd: "/home/dev/forgerie" };
const AT = "2026-10-15T12:00:00.000Z";
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A server that holds links per run, the way the real one does. */
function server(initial: SessionActionRuns = { items, derived }) {
  let current = initial;
  const runOf = (id: number) => [...current.items.flatMap((item) => item.run ? [item.run] : []), ...current.derived.flatMap((group) => group.runs)].find((run) => run.runId === id);
  const setLink = (next: ActionRunLink) => {
    const known = current.items.some((item) => item.link.runId === next.runId);
    current = { ...current, items: known ? current.items.map((item) => item.link.runId === next.runId ? { ...item, link: next } : item) : [...current.items, { link: next, run: runOf(next.runId) ?? null }] };
    return next;
  };
  const linkOf = (id: number) => current.items.find((item) => item.link.runId === id)?.link ?? link(id, { kind: "off" }, "pull");
  const api = {
    list: vi.fn(async () => current),
    read: vi.fn(async (_ref, id: number) => {
      const item = current.items.find((candidate) => candidate.link.runId === id);
      if (!item?.run) throw new Error(item?.error ?? "Not linked.");
      return { link: item.link, run: item.run };
    }),
    link: vi.fn(async (_ref, run: number | string) => {
      const id = typeof run === "number" ? run : Number(/runs\/(\d+)/u.exec(run)?.[1]);
      if (!runOf(id)) throw new Error(`GitHub has no run ${String(id)} on forgerie/forgerie.`);
      return { link: setLink(linkOf(id)), run: runOf(id)! };
    }),
    unlink: vi.fn(async (_ref, id: number) => { const removed = linkOf(id); current = { ...current, items: current.items.filter((item) => item.link.runId !== id) }; return removed; }),
    watch: vi.fn(async (_ref, id: number) => setLink({ ...linkOf(id), watch: { kind: "watching", since: AT, wakes: 0 } })),
    stopWatch: vi.fn(async (_ref, id: number) => setLink({ ...linkOf(id), watch: { kind: "stopped", reason: "Stopped by you", at: AT } })),
  } satisfies ActionRunApi;
  return { api, set: (next: SessionActionRuns) => { current = next; } };
}
const loaded = (store: ReturnType<typeof createActionRunsStore>): readonly ActionRunItem[] => {
  const load = store.getSnapshot().load;
  return load.type === "ready" ? load.items : [];
};

describe("the session's Actions runs", () => {
  it("reads nothing until the panel opens, then reads the list once", async () => {
    const { api } = server();
    const store = createActionRunsStore(api);
    store.setSession(ref);
    store.syncLinks(items.map((item) => item.link));
    await settle();
    expect(api.list).not.toHaveBeenCalled();
    expect(store.getSnapshot().load).toEqual({ type: "idle" });
    store.open();
    expect(store.getSnapshot().load).toEqual({ type: "loading" });
    await settle();
    store.open();
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(loaded(store).map((item) => item.link.runId)).toEqual(items.map((item) => item.link.runId));
  });

  it("keeps a run whose read failed in the list, with the reason", async () => {
    const { api } = server({ items: [{ link: link(5), run: null, error: permissionError }], derived: [] });
    const store = createActionRunsStore(api);
    store.setSession(ref);
    store.open();
    await settle();
    expect(loaded(store)).toEqual([{ link: link(5), run: null, error: permissionError }]);
  });

  it("rereads only the run a catalog event names, and drops an unlinked one", async () => {
    const { api } = server();
    const store = createActionRunsStore(api);
    store.setSession(ref);
    store.syncLinks(items.map((item) => item.link));
    store.open();
    await settle();
    const woke = { ...items[0]!.link, watch: { kind: "watching" as const, since: AT, wakes: 3 } };
    store.syncLinks([woke, items[1]!.link]);
    // The new watch state shows before GitHub answers.
    expect(loaded(store)[0]?.link).toEqual(woke);
    expect(store.getSnapshot().reading.has(runKey(woke))).toBe(true);
    await settle();
    expect(api.read).toHaveBeenCalledTimes(1);
    expect(api.read).toHaveBeenCalledWith(ref, woke.runId, expect.anything());
    expect(loaded(store).map((item) => item.link.runId)).toEqual([items[0]!.link.runId, items[1]!.link.runId]);
    expect(store.getSnapshot().reading.size).toBe(0);
  });

  it("reads the list again after a reconnect, but only if it was read before", async () => {
    const { api } = server();
    const store = createActionRunsStore(api);
    store.setSession(ref);
    store.recover();
    expect(api.list).not.toHaveBeenCalled();
    store.open();
    await settle();
    store.recover();
    expect(store.getSnapshot().listing).toBe(true);
    await settle();
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().listing).toBe(false);
  });

  it("links by URL, and keeps the refusal for the link field", async () => {
    const { api } = server({ items: [], derived });
    const store = createActionRunsStore(api);
    store.setSession(ref);
    store.open();
    await settle();
    await expect(store.link(failedRun.url)).resolves.toBe(true);
    expect(loaded(store).map((item) => item.link.runId)).toEqual([failedRun.runId]);
    await expect(store.link(99)).resolves.toBe(false);
    expect(store.getSnapshot().notice).toEqual({ text: "GitHub has no run 99 on forgerie/forgerie.", key: undefined });
  });

  it("links a derived run when the reader watches it, then stops and unlinks it", async () => {
    const { api } = server({ items: [], derived });
    const store = createActionRunsStore(api);
    store.setSession(ref);
    store.open();
    await settle();
    const codeql = derived[0]!.runs[1]!;
    await store.setWatch(runKey(codeql), codeql.runId, true);
    expect(loaded(store)).toEqual([{ link: link(codeql.runId, { kind: "watching", since: AT, wakes: 0 }, "pull"), run: codeql }]);
    await store.setWatch(runKey(codeql), codeql.runId, false);
    expect(loaded(store)[0]?.link.watch.kind).toBe("stopped");
    await store.unlink(runKey(codeql), codeql.runId);
    expect(loaded(store)).toEqual([]);
  });

  it("opens a run's jobs with a fresh read, and keeps the list's copy when that read fails", async () => {
    const { api } = server();
    const store = createActionRunsStore(api);
    store.setSession(ref);
    store.open();
    await settle();
    const key = runKey(runningRun);
    store.openDetail(key, runningRun.runId);
    expect(store.getSnapshot().detail).toEqual({ key, runId: runningRun.runId, load: { type: "loading" } });
    await settle();
    expect(store.getSnapshot().detail?.load).toEqual({ type: "ready" });
    api.read.mockRejectedValueOnce(new Error("GitHub answered 502."));
    store.openDetail(key, runningRun.runId);
    await settle();
    expect(store.getSnapshot().detail?.load).toEqual({ type: "failed", message: "GitHub answered 502." });
    expect(loaded(store).find((item) => runKey(item.link) === key)?.run).toEqual(runningRun);
    store.closeDetail();
    expect(store.getSnapshot().detail).toBeUndefined();
  });

  it("starts over, unread, for another session, and ignores the old session's answers", async () => {
    const { api } = server();
    let answer: (value: SessionActionRuns) => void = () => {};
    api.list.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    const store = createActionRunsStore(api);
    store.setSession(ref);
    store.open();
    store.setSession({ id: "s2", cwd: "/elsewhere" });
    answer({ items, derived });
    await settle();
    expect(store.getSnapshot().load).toEqual({ type: "idle" });
  });
});
