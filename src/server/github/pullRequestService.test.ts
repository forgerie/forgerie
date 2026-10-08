import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { PullRequestStore } from "./pullRequestStore.js";
import { PullRequestService, type PullSessionState } from "./pullRequestService.js";
import { registerPullRequestRoutes } from "./pullRequestRoutes.js";
import { pullSnapshot, PR_TIME, PR_SHA } from "./pullRequest.testSupport.js";

const ref = { id: "session-1", cwd: "/workspace" };
function fixture(store = new PullRequestStore()) {
  let now = Date.parse(PR_TIME);
  let state: PullSessionState = { ref, available: true, settled: false, leaf: "start" };
  let snapshot = pullSnapshot();
  let busy = false;
  let repo = "owner/repo";
  let failure: Error | undefined;
  let hold: Promise<void> | undefined;
  const notices: { id: string; text: string }[] = [];
  const errors: unknown[] = [];
  const merges: string[] = [];
  const service = new PullRequestService({ store, now: () => now,
    github: {
      repo: () => Promise.resolve({ slug: repo, everyone: false }),
      pull: async () => { await hold; if (failure !== undefined) throw failure; return structuredClone(snapshot); },
      mergePull: (_cwd, _number, sha) => { merges.push(sha); return Promise.resolve({ text: "Merged" }); },
    },
    sessions: { inspect: () => Promise.resolve(state), wake: (_ref, notice, current) => { if (busy || !current()) return Promise.resolve("busy"); if (!notices.some((item) => item.id === notice.id)) notices.push(notice); return Promise.resolve("delivered"); } },
    onError: (error) => { errors.push(error); },
  });
  return { service, store, notices, errors, merges,
    advance: (ms: number) => { now += ms; }, setSnapshot: (value: typeof snapshot) => { snapshot = value; }, setState: (value: Partial<PullSessionState>) => { state = { ...state, ...value }; }, busy: (value: boolean) => { busy = value; }, fail: (error: Error) => { failure = error; }, repo: (value: string) => { repo = value; }, hold: (value: Promise<void> | undefined) => { hold = value; } };
}

describe("PR backend public contracts", () => {
  it("links, starts idempotently, checkpoints news, and stops without merging", async () => {
    const f = fixture();
    await f.service.created({ ...ref, repo: "owner/repo", number: 9 });
    const first = await f.service.watch(ref);
    expect(await f.service.watch(ref)).toEqual(first);
    await f.service.poll();
    await f.service.poll();
    expect(f.notices).toHaveLength(1);
    expect(f.notices[0]?.text).toContain("not authorization");
    expect(f.store.get(ref.id)?.pending).toBeUndefined();
    await f.service.stopRef(ref);
    await f.service.poll();
    expect(f.service.isWatching(ref.id)).toBe(false);
    expect(f.merges).toEqual([]);
  });

  it("keeps busy-session news durable across daemon restart", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pr-watch-"));
    try {
      const path = join(dir, "pulls.json");
      const f = fixture(new PullRequestStore(path));
      await f.service.link(ref, 9); await f.service.watch(ref);
      f.busy(true); await f.service.poll();
      const pending = f.store.get(ref.id)?.pending;
      expect(pending).toBeDefined();
      expect(f.notices).toHaveLength(0);
      f.service.dispose();
      const recovered = new PullRequestStore(path); await recovered.initialize();
      const restarted = fixture(recovered); await restarted.service.poll(); await restarted.service.poll();
      expect(restarted.notices).toEqual([pending]);
      expect(recovered.get(ref.id)?.pending).toBeUndefined();
      expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ version: 1 });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("invalidates an in-flight read on Stop without waiting for that read", async () => {
    const f = fixture(); await f.service.link(ref, 9); await f.service.watch(ref);
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    f.hold(hold);
    const poll = f.service.poll();
    await f.service.stopRef(ref);
    release(); await poll;
    expect(f.notices).toEqual([]);
    expect(f.store.get(ref.id)?.watch.kind).toBe("stopped");
  });

  it("stops on closed PRs, missing sessions, explicit settlement, and changed repository", async () => {
    for (const mode of ["closed", "missing", "settled"] as const) {
      const f = fixture(); await f.service.link(ref, 9); await f.service.watch(ref);
      if (mode === "closed") f.setSnapshot(pullSnapshot({ state: "closed" }));
      else f.setState(mode === "missing" ? { available: false } : { settled: true, leaf: "later" });
      await f.service.poll();
      expect(f.store.get(ref.id)?.watch.kind).toBe("stopped");
      expect(f.notices).toEqual([]);
    }
    const f = fixture(); await f.service.link(ref, 9); await f.service.watch(ref); f.repo("other/repo");
    await expect(f.service.read(ref)).rejects.toThrow("repository changed");
    await f.service.poll(); expect(f.notices).toEqual([]);
  });

  it("reports failed reads and stops after 15 minutes without advancing the cursor", async () => {
    const f = fixture(); await f.service.link(ref, 9); await f.service.watch(ref);
    const cursor = f.store.get(ref.id)?.cursor;
    f.fail(new Error("permission refused")); await f.service.poll();
    expect(f.store.get(ref.id)?.watch).toMatchObject({ kind: "watching", error: "permission refused" });
    expect(f.store.get(ref.id)?.cursor).toEqual(cursor);
    f.advance(15 * 60_000); await f.service.poll();
    const watch = f.store.get(ref.id)?.watch;
    if (watch?.kind !== "stopped") throw new Error("Watch did not stop");
    expect(watch.reason).toContain("15 minutes");
  });

  it("requires confirmation of the exact head, blocks unsafe merge, and scopes the workspace", async () => {
    const f = fixture(); await f.service.link(ref, 9);
    await expect(f.service.merge(ref, "b".repeat(40), "rebase", { repo: "owner/repo", number: 9 })).rejects.toThrow("head changed");
    f.setSnapshot(pullSnapshot({ merge: { kind: "blocked", reason: "No CI ran" } }));
    await expect(f.service.merge(ref, PR_SHA, "rebase", { repo: "owner/repo", number: 9 })).rejects.toThrow("No CI ran");
    await expect(f.service.read({ ...ref, cwd: "/other" })).rejects.toThrow("own workspace");
    f.setSnapshot(pullSnapshot());
    await expect(f.service.merge(ref, PR_SHA, "rebase", { repo: "owner/repo", number: 10 })).rejects.toThrow("linked PR changed");
    await expect(f.service.merge(ref, PR_SHA, "rebase", { repo: "other/repo", number: 9 })).rejects.toThrow("linked PR changed");
    await f.service.merge(ref, PR_SHA, "rebase", { repo: "owner/repo", number: 9 });
    expect(f.merges).toEqual([PR_SHA]);
  });

  it("fails closed on corrupt state and does not publish a failed durable write", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pr-store-"));
    try {
      const path = join(dir, "corrupt.json"); await writeFile(path, '{"version":1,"records":"bad"}');
      await expect(new PullRequestStore(path).initialize()).rejects.toThrow("Invalid pull request");
      const f = fixture(new PullRequestStore(dir));
      await expect(f.service.created({ ...ref, repo: "owner/repo", number: 9 })).rejects.toThrow();
      expect(f.service.catalog()).toEqual({ links: [] });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("serves schema-checked HTTP reads, links, watches and merges, without trusting arbitrary repo input", async () => {
    const f = fixture(); const app = Fastify(); registerPullRequestRoutes(app, f.service);
    try {
      expect((await app.inject({ method: "GET", url: `/sessions/${ref.id}/pull-request?cwd=/workspace` })).json()).toEqual({ link: null, pull: null });
      const linked = await app.inject({ method: "PUT", url: `/sessions/${ref.id}/pull-request`, payload: { cwd: ref.cwd, number: 9 } });
      expect(linked.statusCode).toBe(200); expect(linked.json()).toMatchObject({ pull: { headSha: PR_SHA } });
      expect((await app.inject({ method: "POST", url: `/sessions/${ref.id}/pull-request/watch`, payload: { cwd: ref.cwd } })).json()).toMatchObject({ watch: { kind: "watching" } });
      expect((await app.inject({ method: "GET", url: "/github/pulls" })).json()).toMatchObject({ links: [{ number: 9 }] });
      expect((await app.inject({ method: "DELETE", url: `/sessions/${ref.id}/pull-request/watch?cwd=/workspace` })).statusCode).toBe(200);
      expect((await app.inject({ method: "POST", url: `/sessions/${ref.id}/pull-request/merge`, payload: { cwd: ref.cwd, repo: "owner/repo", number: 9, headSha: PR_SHA, method: "rebase" } })).statusCode).toBe(200);
      expect((await app.inject({ method: "PUT", url: `/sessions/${ref.id}/pull-request`, payload: { cwd: ref.cwd, number: 9, repo: "evil/repo" } })).statusCode).toBe(400);
      expect((await app.inject({ method: "PUT", url: `/sessions/${ref.id}/pull-request`, payload: { cwd: ref.cwd, number: -1 } })).statusCode).toBe(400);
    } finally { await app.close(); }
  });
});
