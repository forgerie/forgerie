import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ActionRunLink } from "../../shared/actionRuns.js";
import { ActionRunStore } from "./actionRunStore.js";
import { ActionRunService } from "./actionRunService.js";
import { registerActionRunRoutes } from "./actionRunRoutes.js";
import { PullRequestStore } from "./pullRequestStore.js";
import type { PullSessionState } from "./pullRequestService.js";
import { pullSnapshot } from "./pullRequest.testSupport.js";
import { actionRun, RUN_TIME } from "./actionRun.testSupport.js";

const ref = { id: "s1", cwd: "/workspace" };
const key = { id: ref.id, repo: "owner/repo", runId: 4812 };
function fixture(store = new ActionRunStore()) {
  let now = Date.parse(RUN_TIME);
  let run = actionRun();
  let state: PullSessionState = { ref, available: true, settled: false, leaf: "start" };
  let busy = false;
  let failure: Error | undefined;
  let hold: Promise<void> | undefined;
  let onRead: (() => void) | undefined;
  let slug = "owner/repo";
  const notices: { id: string; text: string }[] = [];
  const events: ActionRunLink[] = [];
  const unlinked: ActionRunLink[] = [];
  const errors: unknown[] = [];
  const filters: unknown[] = [];
  const pulls = new PullRequestStore();
  const service = new ActionRunService({ store, pulls, now: () => now,
    github: {
      repo: () => Promise.resolve({ slug, everyone: true }),
      run: async (_cwd, runId) => { onRead?.(); await hold; if (failure !== undefined) throw failure; return { ...structuredClone(run), runId }; },
      runsForHead: (_cwd, headSha) => { filters.push(headSha); return Promise.resolve([structuredClone(run)]); },
      pull: () => Promise.resolve(pullSnapshot({ headSha: "a".repeat(40) })),
      dispatch: () => Promise.resolve({ repo: slug, runId: run.runId, url: run.url }),
    },
    sessions: { inspect: () => Promise.resolve(state), wake: (_ref, notice, current) => {
      if (busy || !current()) return Promise.resolve("busy");
      if (!notices.some(item => item.id === notice.id)) notices.push(notice);
      return Promise.resolve("delivered");
    } },
    publish: link => { events.push(link); }, publishUnlinked: link => { unlinked.push(link); }, onError: error => { errors.push(error); },
  });
  return { service, store, pulls, events, unlinked, notices, errors, filters,
    setRun: (extra: Partial<typeof run>) => { run = { ...run, ...extra }; },
    setState: (extra: Partial<PullSessionState>) => { state = { ...state, ...extra }; },
    busy: (value: boolean) => { busy = value; }, fail: (value?: Error) => { failure = value; },
    onRead: (callback: () => void) => { onRead = callback; },
    hold: (value?: Promise<void>) => { hold = value; }, repo: (value: string) => { slug = value; }, advance: (ms: number) => { now += ms; },
  };
}

describe("linked action runs", () => {
  it("links IDs and repo URLs independently of PRs, preserves existing links, and rejects foreign URLs", async () => {
    const f = fixture();
    const first = await f.service.link(ref, 4812);
    expect(await f.service.link(ref, actionRun().url, "pull")).toEqual(first);
    expect(await f.service.link(ref, `${actionRun().url}/attempts/2`)).toEqual(first);
    await f.service.link(ref, "4813");
    expect(f.service.catalog().links.map(link => [link.runId, link.source])).toEqual([[4812, "manual"], [4813, "manual"]]);
    for (const input of ["https://github.com/evil/repo/actions/runs/4812", "https://github.com.evil/owner/repo/actions/runs/4812", "https://x@github.com/owner/repo/actions/runs/4812", "9007199254740992", -1]) {
      await expect(f.service.link(ref, input)).rejects.toThrow();
    }
    await f.service.watch(ref, 4812);
    const watching = await f.service.watch(ref, 4812);
    expect(watching.watch.kind).toBe("watching");
    expect(await f.service.link(ref, 4812)).toMatchObject({ link: watching });
    await f.service.unlink(ref, 4812);
    expect(f.unlinked.map(link => link.runId)).toEqual([4812]);
    expect(f.service.isWatching(ref.id)).toBe(false);
  });
  it("derives runs from linked PR heads, and stores a derived watch with source pull", async () => {
    const f = fixture();
    await f.pulls.link({ ...ref, repo: key.repo, number: 9 });
    const listed = await f.service.list(ref);
    expect(listed.items).toEqual([]);
    expect(listed.derived).toMatchObject([{ pull: 9, headSha: "a".repeat(40), runs: [{ runId: 4812, jobs: [] }] }]);
    expect(f.filters).toEqual(["a".repeat(40)]);
    expect((await f.service.watch(ref, 4812)).source).toBe("pull");
    await f.pulls.unlink({ ...key, number: 9 });
    expect(f.service.catalog().links).toHaveLength(1);
  });
  it("refuses completed or incomplete watches and handles row read errors without losing links", async () => {
    const f = fixture();
    f.setRun({ status: "completed", conclusion: "success" });
    await expect(f.service.watch(ref, 4812)).rejects.toThrow("completed");
    f.setRun({ status: "running", conclusion: null, complete: false });
    await expect(f.service.watch(ref, 4812)).rejects.toThrow("incomplete");
    f.setRun({ complete: true }); await f.service.link(ref, 4812);
    f.fail(new Error('needs "Actions: read"'));
    expect((await f.service.list(ref)).items).toMatchObject([{ run: null, error: 'needs "Actions: read"', link: { runId: 4812 } }]);
    f.fail(); f.repo("different/repo");
    await expect(f.service.read(ref, 4812)).rejects.toThrow("repository changed");
    await expect(f.service.read({ ...ref, cwd: "/other" }, 4812)).rejects.toThrow("own workspace");
  });
  it("checkpoints failures, attempt changes and completion, stopping only after conclusion delivery", async () => {
    const f = fixture(); await f.service.watch(ref, 4812);
    f.setRun({ jobs: [{ id: 1, name: "tests", state: "failed", url: "job" }] });
    await f.service.poll(); await f.service.poll();
    expect(f.notices).toHaveLength(1);
    f.setRun({ attempt: 2, jobs: [] }); await f.service.poll();
    expect(f.notices).toHaveLength(2);
    f.busy(true); f.setRun({ status: "completed", conclusion: "success" }); await f.service.poll();
    expect(f.store.get(key)?.pending).toBeDefined();
    expect(f.service.isWatching(ref.id)).toBe(true);
    f.busy(false); await f.service.poll(); await f.service.poll();
    expect(f.notices).toHaveLength(3);
    expect(f.store.get(key)?.watch).toMatchObject({ kind: "stopped", reason: "Run completed (success)." });
  });
  it("recovers busy-session completion news across restart and acknowledges it atomically with Stop", async () => {
    const dir = await mkdtemp(join(tmpdir(), "action-outbox-"));
    try {
      const path = join(dir, "action-runs.json");
      const f = fixture(new ActionRunStore(path));
      await f.service.watch(ref, 4812); f.busy(true); f.setRun({ status: "completed", conclusion: "failure" }); await f.service.poll();
      const pending = f.store.get(key)?.pending; expect(pending).toBeDefined(); f.service.dispose();
      const store = new ActionRunStore(path); await store.initialize(); const recovered = fixture(store);
      await recovered.service.poll(); await recovered.service.poll();
      expect(recovered.notices).toEqual([pending]);
      expect(store.get(key)?.pending).toBeUndefined();
      expect(store.get(key)?.watch).toMatchObject({ kind: "stopped", reason: "Run completed (failure)." });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("uses typed completion state, not notice text, for the stop reason", async () => {
    const f = fixture();
    try {
      await f.service.watch(ref, 4812); f.busy(true);
      f.setRun({ status: "completed", conclusion: "failure" }); await f.service.poll();
      const record = f.store.get(key);
      if (record?.pending === undefined) throw new Error("Completion notice missing");
      const pending = record.pending;
      await f.store.update(key, record.revision, value => ({ ...value, pending: { id: pending.id, text: "Completion news from another notice renderer." } }));
      f.busy(false); await f.service.poll();
      expect(f.store.get(key)?.watch).toMatchObject({ kind: "stopped", reason: "Run completed (failure)." });
      expect(f.notices[0]?.text).toBe("Completion news from another notice renderer.");
      expect(f.service.catalog().links[0]).not.toHaveProperty("conclusion");
      f.setRun({ status: "running", conclusion: null, attempt: 2 });
      await f.service.watch(ref, 4812);
      expect(f.store.get(key)?.conclusion).toBeUndefined();
    } finally { f.service.dispose(); }
  });
  it("refuses starts paused on GitHub after session Abort or Stop, without creating a link", async () => {
    for (const reason of ["Session aborted by request.", "Session stopped by request."]) {
      for (const alreadyLinked of [false, true]) {
        const f = fixture();
        try {
          if (alreadyLinked) await f.service.link(ref, 4812);
          let release = () => { /* Set by the read gate. */ };
          f.hold(new Promise<void>(resolve => { release = resolve; }));
          const reading = new Promise<void>(resolve => { f.onRead(resolve); });
          const start = f.service.watch(ref, 4812);
          const refused = expect(start).rejects.toThrow("stopped");
          await reading;
          await f.service.stop(ref.id, reason);
          release(); await refused;
          expect(f.service.isWatching(ref.id)).toBe(false);
          expect(f.store.list()).toHaveLength(alreadyLinked ? 1 : 0);
          expect(f.notices).toEqual([]);
        } finally { f.service.dispose(); }
      }
    }
  });
  it("keeps another watch's durable news when an earlier unlinked start resumes", async () => {
    const f = fixture();
    try {
      let release = () => { /* Set by the read gate. */ };
      f.hold(new Promise<void>(resolve => { release = resolve; }));
      const reading = new Promise<void>(resolve => { f.onRead(resolve); });
      const earlierStart = f.service.watch(ref, 4812);
      await reading;
      f.hold();
      await f.service.watch(ref, 4812);
      f.busy(true); f.setRun({ jobs: [{ id: 10, name: "tests", state: "failed", url: "job" }] });
      await f.service.poll();
      const before = f.store.get(key);
      expect(before?.watch).toMatchObject({ kind: "watching", wakes: 1 });
      expect(before?.cursor?.failed).toEqual(["1:10"]);
      expect(before?.pending).toBeDefined();
      release(); await earlierStart;
      expect(f.store.get(key)).toEqual(before);
    } finally { f.service.dispose(); }
  });
  it("Stop and unlink invalidate in-flight reads and discard busy news", async () => {
    for (const mode of ["stop", "unlink"] as const) {
      const f = fixture(); await f.service.watch(ref, 4812);
      f.setRun({ status: "completed", conclusion: "success" });
      let release = () => { /* Replaced by the promise executor. */ };
      f.hold(new Promise<void>(resolve => { release = resolve; }));
      const poll = f.service.poll();
      if (mode === "stop") await f.service.stop(ref.id);
      else await f.service.unlink(ref, 4812);
      release(); await poll;
      expect(f.notices).toEqual([]);
      expect(f.service.isWatching(ref.id)).toBe(false);
    }
    const f = fixture(); await f.service.watch(ref, 4812); f.busy(true);
    f.setRun({ status: "completed", conclusion: "failure" }); await f.service.poll();
    await f.service.stopRef(ref); f.busy(false); await f.service.poll();
    expect(f.notices).toEqual([]);
    expect(f.store.get(key)?.pending).toBeUndefined();
  });
  it("uses PR session stop rules and the 15-minute successful-read deadline", async () => {
    for (const state of [{ available: false }, { settled: true, leaf: "new" }]) {
      const f = fixture(); await f.service.watch(ref, 4812); f.setState(state); await f.service.poll();
      expect(f.service.isWatching(ref.id)).toBe(false); expect(f.notices).toEqual([]);
    }
    const f = fixture(); await f.service.watch(ref, 4812);
    const cursor = f.store.get(key)?.cursor;
    f.setRun({ complete: false }); await f.service.poll();
    expect(f.store.get(key)?.cursor).toEqual(cursor);
    const failedWatch = f.store.get(key)?.watch;
    expect(failedWatch?.kind).toBe("watching");
    if (failedWatch?.kind === "watching") expect(failedWatch.error).toContain("incomplete");
    f.advance(15 * 60_000); await f.service.poll();
    const stoppedWatch = f.store.get(key)?.watch;
    expect(stoppedWatch?.kind).toBe("stopped");
    if (stoppedWatch?.kind === "stopped") expect(stoppedWatch.reason).toContain("15 minutes");
  });
  it("dispatch links the returned ID without reading it and preserves source dispatch", async () => {
    const f = fixture(); f.fail(new Error("run is not readable yet"));
    expect(await f.service.dispatch(ref, "ci.yml", "main", { platform: "linux" })).toContain("4812");
    expect(f.service.catalog().links).toMatchObject([{ runId: 4812, source: "dispatch" }]);
  });
});

describe("action run HTTP routes", () => {
  it("serves the real HTTP path and validates requests with action_run_error responses", async () => {
    const f = fixture(); const app = Fastify(); registerActionRunRoutes(app, f.service);
    const base = `/sessions/${ref.id}/action-runs`;
    try {
      const address = await app.listen({ port: 0, host: "127.0.0.1" });
      expect(await (await fetch(`${address}${base}?cwd=/workspace`)).json()).toEqual({ items: [], derived: [] });
      const linked = await app.inject({ method: "PUT", url: base, payload: { cwd: ref.cwd, run: actionRun().url } });
      expect(linked.statusCode).toBe(200); expect(linked.json()).toMatchObject({ link: { provider: "github", runId: 4812 }, run: { runNumber: 42, jobs: [] } });
      const read = await fetch(`${address}${base}/4812?cwd=/workspace`);
      expect(read.status).toBe(200);
      expect(await read.json()).toMatchObject({ run: { runId: 4812, runNumber: 42 } });
      expect((await app.inject({ method: "POST", url: `${base}/4812/watch`, payload: { cwd: ref.cwd } })).json()).toMatchObject({ watch: { kind: "watching" } });
      expect((await app.inject({ method: "GET", url: "/github/action-runs" })).json()).toMatchObject({ links: [{ runId: 4812 }] });
      expect((await app.inject({ method: "DELETE", url: `${base}/4812/watch?cwd=/workspace` })).json()).toMatchObject({ watch: { kind: "stopped" } });
      expect((await app.inject({ method: "DELETE", url: `${base}/4812?cwd=/workspace` })).statusCode).toBe(200);
      for (const request of [
        { method: "PUT" as const, url: base, payload: { cwd: ref.cwd, run: -1 } },
        { method: "PUT" as const, url: base, payload: { cwd: ref.cwd, run: 4812, repo: "evil/repo" } },
        { method: "GET" as const, url: `${base}/9007199254740992?cwd=/workspace` },
        { method: "POST" as const, url: `${base}/4812/watch`, payload: {} },
        { method: "GET" as const, url: base },
      ]) {
        const response = await app.inject(request); expect(response.statusCode).toBe(400); expect(response.json()).toMatchObject({ kind: "action_run_error" });
        expect(response.json<{ error: unknown }>().error).toBeTypeOf("string");
      }
    } finally { await app.close(); f.service.dispose(); }
  });
});
