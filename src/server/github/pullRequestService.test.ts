import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { PullRequestStore } from "./pullRequestStore.js";
import { PullRequestService, type PullSessionState } from "./pullRequestService.js";
import { registerPullRequestRoutes } from "./pullRequestRoutes.js";
import { pullSnapshot, PR_TIME, PR_SHA } from "./pullRequest.testSupport.js";
import type { PullLink } from "../../shared/pullRequests.js";

const ref = { id: "session-1", cwd: "/workspace" };
const k9 = { id: ref.id, repo: "owner/repo", number: 9 };
function fixture(store = new PullRequestStore(), publishUnlinked?: (link: PullLink) => void) {
  let now = Date.parse(PR_TIME);
  let state: PullSessionState = { ref, available: true, settled: false, leaf: "start" };
  let snapshot = pullSnapshot();
  const byNumber = new Map<number, ReturnType<typeof pullSnapshot>>();
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
      pull: async (_cwd, number) => { await hold; if (failure !== undefined) throw failure; const value = structuredClone(byNumber.get(number) ?? snapshot); return { ...value, pull: { ...value.pull, number } }; },
      mergePull: (_cwd, _number, sha) => { merges.push(sha); return Promise.resolve({ text: "Merged" }); },
    },
    sessions: { inspect: () => Promise.resolve(state), wake: (_ref, notice, current) => { if (busy || !current()) return Promise.resolve("busy"); if (!notices.some((item) => item.id === notice.id)) notices.push(notice); return Promise.resolve("delivered"); } },
    onError: (error) => { errors.push(error); },
    ...(publishUnlinked === undefined ? {} : { publishUnlinked }),
  });
  return { service, store, notices, errors, merges,
    advance: (ms: number) => { now += ms; }, setPull: (number: number, value: typeof snapshot) => { byNumber.set(number, value); }, setSnapshot: (value: typeof snapshot) => { snapshot = value; }, setState: (value: Partial<PullSessionState>) => { state = { ...state, ...value }; }, busy: (value: boolean) => { busy = value; }, fail: (error: Error) => { failure = error; }, repo: (value: string) => { repo = value; }, hold: (value: Promise<void> | undefined) => { hold = value; } };
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
    expect(f.store.get(k9)?.pending).toBeUndefined();
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
      const pending = f.store.get(k9)?.pending;
      expect(pending).toBeDefined();
      expect(f.notices).toHaveLength(0);
      f.service.dispose();
      const recovered = new PullRequestStore(path); await recovered.initialize();
      const restarted = fixture(recovered); await restarted.service.poll(); await restarted.service.poll();
      expect(restarted.notices).toEqual([pending]);
      expect(recovered.get(k9)?.pending).toBeUndefined();
      expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ version: 2 });
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
    expect(f.store.get(k9)?.watch.kind).toBe("stopped");
  });

  it("stops on closed PRs, missing sessions, explicit settlement, and changed repository", async () => {
    for (const mode of ["closed", "missing", "settled"] as const) {
      const f = fixture(); await f.service.link(ref, 9); await f.service.watch(ref);
      if (mode === "closed") f.setSnapshot(pullSnapshot({ state: "closed" }));
      else f.setState(mode === "missing" ? { available: false } : { settled: true, leaf: "later" });
      await f.service.poll();
      expect(f.store.get(k9)?.watch.kind).toBe("stopped");
      expect(f.notices).toEqual([]);
    }
    const f = fixture(); await f.service.link(ref, 9); await f.service.watch(ref); f.repo("other/repo");
    await expect(f.service.read(ref, 9)).rejects.toThrow("repository changed");
    await f.service.poll(); expect(f.notices).toEqual([]);
  });

  it("reports failed reads and stops after 15 minutes without advancing the cursor", async () => {
    const f = fixture(); await f.service.link(ref, 9); await f.service.watch(ref);
    const cursor = f.store.get(k9)?.cursor;
    f.fail(new Error("permission refused")); await f.service.poll();
    expect(f.store.get(k9)?.watch).toMatchObject({ kind: "watching", error: "permission refused" });
    expect(f.store.get(k9)?.cursor).toEqual(cursor);
    f.advance(15 * 60_000); await f.service.poll();
    const watch = f.store.get(k9)?.watch;
    if (watch?.kind !== "stopped") throw new Error("Watch did not stop");
    expect(watch.reason).toContain("15 minutes");
  });

  it("requires confirmation of the exact head, blocks unsafe merge, and scopes the workspace", async () => {
    const f = fixture(); await f.service.link(ref, 9);
    await expect(f.service.merge(ref, "b".repeat(40), "rebase", { repo: "owner/repo", number: 9 })).rejects.toThrow("head changed");
    f.setSnapshot(pullSnapshot({ merge: { kind: "blocked", reason: "No CI ran" } }));
    await expect(f.service.merge(ref, PR_SHA, "rebase", { repo: "owner/repo", number: 9 })).rejects.toThrow("No CI ran");
    await expect(f.service.read({ ...ref, cwd: "/other" }, 9)).rejects.toThrow("own workspace");
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
    const base = `/sessions/${ref.id}/pull-requests`;
    try {
      expect((await app.inject({ method: "GET", url: `${base}?cwd=/workspace` })).json()).toEqual({ items: [] });
      const linked = await app.inject({ method: "PUT", url: base, payload: { cwd: ref.cwd, number: 9 } });
      expect(linked.statusCode).toBe(200); expect(linked.json()).toMatchObject({ pull: { headSha: PR_SHA } });
      expect((await app.inject({ method: "PUT", url: base, payload: { cwd: ref.cwd, number: 10 } })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: `${base}?cwd=/workspace` })).json()).toMatchObject({ items: [{ link: { number: 9 }, pull: { number: 9 } }, { link: { number: 10 }, pull: { number: 10 } }] });
      expect((await app.inject({ method: "GET", url: `${base}/10?cwd=/workspace` })).json()).toMatchObject({ link: { number: 10 }, pull: { number: 10 } });
      expect((await app.inject({ method: "POST", url: `${base}/9/watch`, payload: { cwd: ref.cwd } })).json()).toMatchObject({ number: 9, watch: { kind: "watching" } });
      expect((await app.inject({ method: "GET", url: "/github/pulls" })).json()).toMatchObject({ links: [{ number: 9 }, { number: 10 }] });
      expect((await app.inject({ method: "DELETE", url: `${base}/9/watch?cwd=/workspace` })).json()).toMatchObject({ number: 9, watch: { kind: "stopped" } });
      expect((await app.inject({ method: "POST", url: `${base}/9/merge`, payload: { cwd: ref.cwd, repo: "owner/repo", headSha: PR_SHA, method: "rebase" } })).statusCode).toBe(200);
      expect((await app.inject({ method: "DELETE", url: `${base}/10?cwd=/workspace` })).json()).toMatchObject({ number: 10 });
      expect((await app.inject({ method: "GET", url: `${base}/10?cwd=/workspace` })).statusCode).toBe(400);
      expect((await app.inject({ method: "PUT", url: base, payload: { cwd: ref.cwd, number: 9, repo: "evil/repo" } })).statusCode).toBe(400);
      expect((await app.inject({ method: "PUT", url: base, payload: { cwd: ref.cwd, number: -1 } })).statusCode).toBe(400);
      expect((await app.inject({ method: "GET", url: `${base}/0?cwd=/workspace` })).statusCode).toBe(400);
    } finally { await app.close(); }
  });
});

describe("several pull requests in one session", () => {
  const k10 = { id: ref.id, repo: "owner/repo", number: 10 };
  it("adds a second link without replacing the first or its watch", async () => {
    const f = fixture();
    await f.service.created({ ...ref, repo: "owner/repo", number: 9 });
    await f.service.watch(ref);
    await f.service.created({ ...ref, repo: "owner/repo", number: 10 });
    expect(f.service.catalog().links.map((link) => [link.number, link.watch.kind])).toEqual([[9, "watching"], [10, "off"]]);
    await expect(f.service.watch(ref)).rejects.toThrow("Give the number");
    await f.service.watch(ref, 10);
    expect(f.store.get(k10)?.watch.kind).toBe("watching");
  });

  it("watches each pull request on its own: news and stops are per PR", async () => {
    const f = fixture();
    await f.service.link(ref, 9); await f.service.link(ref, 10);
    await f.service.watch(ref, 9); await f.service.watch(ref, 10);
    await f.service.poll();
    expect(f.notices.map((notice) => /#(\d+)/.exec(notice.text)?.[1])).toEqual(["9", "10"]);
    f.setPull(10, pullSnapshot({ state: "merged" }));
    await f.service.poll();
    expect(f.store.get(k9)?.watch.kind).toBe("watching");
    expect(f.store.get(k10)?.watch).toMatchObject({ kind: "stopped", reason: "Pull request merged." });
    await f.service.stopRef(ref, 9);
    expect(f.service.isWatching(ref.id)).toBe(false);
  });

  it("stops every watch when the session stops, and keeps the links", async () => {
    const f = fixture();
    await f.service.link(ref, 9); await f.service.link(ref, 10);
    await f.service.watch(ref, 9); await f.service.watch(ref, 10);
    const stopped = await f.service.stop(ref.id, "Session stopped by request.");
    expect(stopped.map((link) => link.watch.kind)).toEqual(["stopped", "stopped"]);
    expect(f.service.catalog().links).toHaveLength(2);
  });

  it("lists every link with its read, keeping a link whose read failed", async () => {
    const f = fixture();
    await f.service.link(ref, 9); await f.service.link(ref, 10);
    f.repo("other/repo");
    const { items } = await f.service.list(ref);
    expect(items.map((item) => [item.link.number, item.pull, item.error])).toEqual([
      [9, null, "The session's GitHub repository changed. Link its PR again."],
      [10, null, "The session's GitHub repository changed. Link its PR again."],
    ]);
  });

  it("merges only the confirmed pull request and stops only its watch", async () => {
    const f = fixture();
    await f.service.link(ref, 9); await f.service.link(ref, 10);
    await f.service.watch(ref, 9); await f.service.watch(ref, 10);
    await f.service.merge(ref, PR_SHA, "rebase", { repo: "owner/repo", number: 10 });
    expect(f.store.get(k10)?.watch.kind).toBe("stopped");
    expect(f.store.get(k9)?.watch.kind).toBe("watching");
    await expect(f.service.merge(ref, PR_SHA, "rebase", { repo: "owner/repo", number: 11 })).rejects.toThrow("linked PR changed");
  });

  it("unlinks one pull request, drops its pending news, and tells the client", async () => {
    const unlinked: number[] = [];
    const f = fixture(undefined, (link) => { unlinked.push(link.number); });
    const service = f.service;
    await service.link(ref, 9); await service.link(ref, 10); await service.watch(ref, 10);
    f.busy(true); await service.poll();
    expect(f.store.get(k10)?.pending).toBeDefined();
    await service.unlink(ref, 10);
    f.busy(false); await service.poll();
    expect(unlinked).toEqual([10]);
    expect(f.notices).toEqual([]);
    expect(service.catalog().links.map((link) => link.number)).toEqual([9]);
    await expect(service.unlink(ref, 10)).rejects.toThrow("not linked");
  });

  it("reads a version 1 state file and writes version 2", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pr-store-v1-"));
    try {
      const path = join(dir, "pulls.json");
      await writeFile(path, JSON.stringify({ version: 1, records: [{ session: ref, repo: "owner/repo", number: 9, watch: { kind: "off" }, revision: 3 }] }));
      const store = new PullRequestStore(path); await store.initialize();
      expect(store.get(k9)?.revision).toBe(3);
      await store.link({ ...ref, repo: "owner/repo", number: 10 });
      expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ version: 2, records: [{ number: 9 }, { number: 10 }] });
      await writeFile(path, JSON.stringify({ version: 2, records: [{ session: ref, repo: "owner/repo", number: 9, watch: { kind: "off" }, revision: 0 }, { session: ref, repo: "Owner/Repo", number: 9, watch: { kind: "off" }, revision: 0 }] }));
      await expect(new PullRequestStore(path).initialize()).rejects.toThrow("Duplicate");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
