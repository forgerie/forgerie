import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import Fastify from "fastify";
import { registerProjectGroupRoutes } from "./projectGroupRoutes.js";
import { GitWorktreeDiscovery, discoverGitWorktrees, isGitRepository } from "../workspaces/gitWorktreeDiscovery.js";
import { ProjectService } from "./projectService.js";
import { ProjectStore } from "../storage/projectStore.js";
import { ProjectGroups } from "./projectGroups.js";
import { ProjectWorkspaces } from "./projectWorkspaces.js";
import { WorkspaceService } from "../workspaces/workspaceService.js";
import { SessionWorktreeStore } from "../workspaces/sessionWorktreeStore.js";
import { SessionWorktrees } from "../workspaces/sessionWorktrees.js";
import { sanitizedGitEnv } from "../git/gitEnv.js";
const exec = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture(discovery?: GitWorktreeDiscovery) {
  const root = await mkdtemp(join(tmpdir(), "forgerie-cross-repo-")); roots.push(root);
  const git = async (cwd: string, ...args: string[]) => (await exec("git", ["-C", cwd, ...args], { env: sanitizedGitEnv() })).stdout.trim();
  const projects = new ProjectService(new ProjectStore(join(root, "projects.json")));
  const a = join(root, "a"), b = join(root, "b");
  for (const path of [a, b]) {
    await mkdir(path); await git(path, "init", "-b", "main"); await git(path, "config", "user.name", "Test"); await git(path, "config", "user.email", "test@example.invalid");
    await writeFile(join(path, "AGENTS.md"), `Instructions for ${path}`); await git(path, "add", "."); await git(path, "commit", "-m", "initial");
  }
  const pa = await projects.add({ path: a }), pb = await projects.add({ path: b });
  const groups = new ProjectGroups(join(root, "groups.json"), projects);
  const group = await groups.save({ name: "KORI", projectIds: [pa.id, pb.id] });
  const store = new SessionWorktreeStore(join(root, "worktrees.json")); await store.initialize();
  const worktrees = new SessionWorktrees(store, { publish: () => undefined, worktreesChanged: () => discovery?.invalidate() });
  const work = new ProjectWorkspaces({ projects, groups, workspaces: new WorkspaceService(discovery), worktrees, agentDir: root, writable: (ref) => Promise.resolve(ref.id === "source") });
  const ref = { id: "source", cwd: a };
  return { root, git, a, b, pa, pb, projects, groups, group, store, worktrees, work, ref };
}
it("one chat prepares only the requested repo, survives reload, and lands without making the chat read-only", async () => {
  const f = await fixture();
  const [first, repeated] = await Promise.all([f.work.prepare(f.ref, f.pb.id, "request"), f.work.prepare(f.ref, f.pb.id, "request")]);
  expect(first.id).toBe(repeated.id);
  expect(first.sessionId).toBeUndefined();
  expect(first.relatedSession).toEqual({ ...f.ref, projectId: f.pb.id });
  expect(first.setup.phase).toBe("done");
  expect((await f.store.list())).toHaveLength(1);
  const context = await f.work.context(f.ref, f.pb.id);
  expect(context.cwd).toBe(first.path);
  expect(context.instructions.some((file) => file.content.includes(`Instructions for ${f.b}`))).toBe(true);
  const restarted = new SessionWorktreeStore(join(f.root, "worktrees.json")); await restarted.initialize();
  expect((await restarted.require(first.id)).relatedSession).toEqual(first.relatedSession);
  expect(await restarted.forSession(f.ref)).toBeUndefined();
  expect(await f.work.owner({ id: f.ref.id, cwd: first.path })).toEqual({ ref: f.ref, active: true });
  await writeFile(join(first.path, "change.txt"), "target only"); await f.git(first.path, "add", "."); await f.git(first.path, "commit", "-m", "target change");
  expect((await f.worktrees.land(first.id, [], f.ref.id)).kind).toBe("landed");
  expect(await readFile(join(f.b, "change.txt"), "utf8")).toBe("target only");
  await expect(access(join(f.a, "change.txt"))).rejects.toThrow();
  expect(await f.store.readOnly(f.ref)).toBeUndefined();
  expect((await f.work.owner({ id: f.ref.id, cwd: first.path })).active).toBe(false);
});
it("retains the starting worktree until all related work is finished", async () => {
  const f = await fixture();
  const primary = await f.worktrees.create(f.a);
  const transcript = join(f.root, "source.jsonl"); await writeFile(transcript, "saved chat\n");
  const source = { id: "source", cwd: primary.path, path: transcript };
  await f.worktrees.attach(primary.id, source);
  const related = await f.work.prepare(source, f.pb.id, "related");
  expect(await f.worktrees.land(primary.id, [source])).toMatchObject({ kind: "blocked", reason: "related-worktrees-active" });
  expect(await f.worktrees.archiveCleanup(primary.id, [source])).toMatchObject({ kind: "retained", reason: "related-worktrees-active" });
  expect((await f.worktrees.land(related.id, [], source.id)).kind).toBe("landed");
  expect((await f.worktrees.land(primary.id, [source])).kind).toBe("landed");
});
it("does not lose owned checkouts on ungroup, rejects a different owner, and requires a fresh discard token", async () => {
  const f = await fixture();
  const record = await f.work.prepare(f.ref, f.pb.id, "request");
  await expect(f.work.requireOwned({ ...f.ref, id: "other" }, record.id)).rejects.toThrow("another session");
  await f.groups.remove(f.group.id, f.group.revision);
  expect(await f.work.related(f.ref)).toHaveLength(1);
  expect((await f.work.context(f.ref, f.pb.id)).cwd).toBe(record.path);
  const preview = await f.worktrees.discardPreview(record.id);
  await writeFile(join(record.path, "new.txt"), "not discarded without a fresh preview");
  expect((await f.worktrees.discard(record.id, preview.confirmationToken, [])).kind).toBe("stale-preview");
  const fresh = await f.worktrees.discardPreview(record.id);
  expect((await f.worktrees.discard(record.id, fresh.confirmationToken, [])).kind).toBe("discarded");
  expect(await f.store.readOnly(f.ref)).toBeUndefined();
});
it("fails closed on unrelated projects and retries failed setup in the owned worktree", async () => {
  const f = await fixture();
  const c = await f.projects.add({ path: f.root });
  await expect(f.work.prepare(f.ref, c.id, "unrelated")).rejects.toThrow("shared");
  await mkdir(join(f.b, ".forgerie/hooks"), { recursive: true });
  const hook = join(f.b, ".forgerie/hooks/worktree-post-create");
  await writeFile(hook, "#!/bin/sh\nexit 7\n", { mode: 0o755 });
  await expect(f.work.prepare(f.ref, f.pb.id, "retry")).rejects.toThrow("7");
  const before = (await f.store.list())[0];
  if (before === undefined) throw new Error("Expected retained setup");
  await rm(hook);
  const after = await f.work.prepare(f.ref, f.pb.id, "retry");
  expect(after.id).toBe(before.id);
  expect(after.setup.phase).toBe("done");
  await expect(f.work.prepare(f.ref, f.pa.id, "retry")).rejects.toThrow("another project");
});

it("serves the same project catalog without repeat Git reads and discovers external worktrees after expiry", async () => {
  let calls = 0;
  let now = 1_000_000;
  const discovery = new GitWorktreeDiscovery({
    async isGitRepository(path) { calls++; return isGitRepository(path); },
    async discoverGitWorktrees(path) { calls++; return discoverGitWorktrees(path); },
  }, { cacheMs: 10_000, now: () => now });
  const f = await fixture(discovery);
  await f.work.prepare(f.ref, f.pb.id, "route-related");
  discovery.invalidate();
  const app = Fastify();
  registerProjectGroupRoutes(app, f.groups, f.projects, f.work);
  const read = (cwd: string) => app.inject({ method: "GET", url: `/project-workspaces?id=source&cwd=${encodeURIComponent(cwd)}` });
  try {
    type Catalog = Awaited<ReturnType<ProjectWorkspaces["catalog"]>>;
    const first = await read(f.ref.cwd);
    expect(first.statusCode).toBe(200);
    const firstCalls = calls;
    expect(firstCalls).toBeGreaterThan(0);
    expect((await read(f.ref.cwd)).body).toBe(first.body);
    expect(calls).toBe(firstCalls);
    const fresh = new ProjectWorkspaces({ projects: f.projects, groups: f.groups, workspaces: new WorkspaceService(), worktrees: f.worktrees, agentDir: f.root, writable: () => Promise.resolve(true) });
    expect(first.json()).toEqual(await fresh.catalog(f.ref));
    const external = join(f.root, "external");
    await f.git(f.a, "worktree", "add", "-b", "external", external);
    expect((await read(external)).json<Catalog>().home).toBeUndefined();
    now += 10_000;
    expect((await read(external)).json<Catalog>().home).toEqual(f.pa);
  } finally { await app.close(); }
});
