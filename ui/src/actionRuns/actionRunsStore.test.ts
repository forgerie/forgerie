import { describe, expect, it } from "vitest";
import { runKey, type ActionRunItem, type SessionActionRun, type SessionActionRuns } from "./actionRunApi";
import { createActionRunsStore } from "./actionRunsStore";
import { derived, failedRun, items, link, permissionError, runningRun } from "./fixtures/actionRuns";
import { runServer } from "./fixtures/runServer";

const ref = { id: "s1", cwd: "/home/dev/forgerie" };
const AT = "2026-10-15T12:00:00.000Z";
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Every fixture run stays known to the server, so an unlinked run can be linked again. */
const server = (initial: SessionActionRuns = { items, derived }) => runServer(initial, items.flatMap((item) => item.run ? [item.run] : []));
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

  it("does not bring a run back when its read finishes after the reader unlinked it", async () => {
    const { api } = server();
    const store = createActionRunsStore(api);
    store.setSession(ref);
    store.syncLinks(items.map((item) => item.link));
    store.open();
    await settle();
    const target = items[1]!;
    const key = runKey(target.link);
    // A wake starts a reread, and the reader opens the run's jobs: two reads in flight.
    const answers: ((value: SessionActionRun) => void)[] = [];
    api.read.mockImplementation(() => new Promise<SessionActionRun>((resolve) => { answers.push(resolve); }));
    store.syncLinks([items[0]!.link, { ...target.link, watch: { kind: "watching", since: AT, wakes: 1 } }, items[2]!.link]);
    store.openDetail(key, target.link.runId);
    expect(answers).toHaveLength(2);
    expect(loaded(store)).toHaveLength(3);
    await store.unlink(key, target.link.runId);
    expect(loaded(store).map((item) => runKey(item.link))).not.toContain(key);
    for (const answer of answers) answer({ link: target.link, run: target.run! });
    await settle();
    expect(loaded(store).map((item) => runKey(item.link))).not.toContain(key);
    expect(loaded(store)).toHaveLength(2);
    expect(store.getSnapshot().detail).toBeUndefined();
    // Linking it again is a new start: its next read lands.
    api.read.mockImplementation(async () => ({ link: target.link, run: target.run! }));
    await store.link(target.link.runId);
    expect(loaded(store).map((item) => runKey(item.link))).toContain(key);
  });

  it("drops a run unlinked while the list was being read", async () => {
    const { api } = server();
    const store = createActionRunsStore(api);
    store.setSession(ref);
    store.open();
    await settle();
    let answer: (value: SessionActionRuns) => void = () => {};
    api.list.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    store.refresh();
    const target = items[0]!;
    await store.unlink(runKey(target.link), target.link.runId);
    answer({ items, derived });
    await settle();
    expect(loaded(store).map((item) => item.link.runId)).toEqual([items[1]!.link.runId, items[2]!.link.runId]);
  });

  it("reads the list again for derived runs when a pull request is linked or its head moves, and only then", async () => {
    const { api } = server();
    const store = createActionRunsStore(api);
    store.setSession(ref);
    const pull = { repo: "forgerie/forgerie", number: 142, headSha: "a".repeat(40) };
    // Before the panel opened: recorded, nothing read.
    store.syncPulls([pull]);
    store.syncPulls([pull, { ...pull, number: 150 }]);
    expect(api.list).not.toHaveBeenCalled();
    store.open();
    await settle();
    expect(api.list).toHaveBeenCalledTimes(1);
    // The same pull requests in another order, read again with the same heads: no read.
    store.syncPulls([{ ...pull, number: 150 }, { ...pull, repo: "Forgerie/Forgerie" }]);
    expect(api.list).toHaveBeenCalledTimes(1);
    // A new head on #142.
    store.syncPulls([{ ...pull, headSha: "b".repeat(40) }, { ...pull, number: 150 }]);
    await settle();
    expect(api.list).toHaveBeenCalledTimes(2);
    // A newly linked pull request.
    store.syncPulls([{ ...pull, headSha: "b".repeat(40) }, { ...pull, number: 150 }, { ...pull, number: 151 }]);
    await settle();
    expect(api.list).toHaveBeenCalledTimes(3);
    // An unlinked one.
    store.syncPulls([{ ...pull, number: 150 }]);
    await settle();
    expect(api.list).toHaveBeenCalledTimes(4);
  });
});
