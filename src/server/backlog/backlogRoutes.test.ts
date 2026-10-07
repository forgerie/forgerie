import Fastify from "fastify";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BacklogListResponse, BacklogLaunchRequest, BacklogLaunchResponse, BacklogErrorResponse, SessionInfo, Project } from "../../shared/apiTypes.js";
import { ProjectStore } from "../storage/projectStore.js";
import { ProjectService } from "../projects/projectService.js";
import { BacklogClaimStore } from "./backlogClaimStore.js";
import { BacklogService } from "./backlogService.js";
import { registerBacklogRoutes } from "./backlogRoutes.js";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture(options: { start?: () => Promise<SessionInfo> } = {}) {
  const root = await mkdtemp(join(tmpdir(), "forgerie-backlog-routes-")); cleanups.push(() => rm(root, { recursive: true, force: true }));
  const projects = new ProjectService(new ProjectStore(join(root, "projects.json")));
  const projectRoot = join(root, "repo"); await mkdir(projectRoot);
  const project = await projects.add({ path: projectRoot });
  await mkdir(join(projectRoot, ".forgerie/backlog"), { recursive: true });
  const itemPath = join(projectRoot, ".forgerie/backlog/item.md");
  const body = "\n# Work\nKeep the trailing space.  \n";
  await writeFile(itemPath, `---\nid: item\ntitle: Item\n---\n${body}`);
  const claims = new BacklogClaimStore(join(root, "claims.json")); await claims.initialize();
  let started = 0;
  const session: SessionInfo = { id: "session", cwd: projectRoot, path: join(root, "session.jsonl"), created: "2026-09-01", modified: "2026-09-01", messageCount: 0, firstMessage: "" };
  const backlog = new BacklogService({ projects, claims, userSessions: { start: async () => { started++; return options.start === undefined ? session : options.start(); } }, sessions: { stop: () => undefined }, isArchived: () => Promise.resolve(false) });
  const app = Fastify(); registerBacklogRoutes(app, backlog); cleanups.push(() => app.close());
  const base = `/backlog/${project.id}/items/item`;
  const request: BacklogLaunchRequest = { requestId: "req", start: { cwd: projectRoot, destination: { kind: "existing-workspace" } } };
  return { root, project, projectRoot, itemPath, body, claims, app, base, request, session, started: () => started };
}

describe("backlog HTTP contract", () => {
  it("lists all projects and returns the opaque body as composer context without claiming", async () => {
    const f = await fixture();
    const listing = await f.app.inject({ method: "GET", url: "/backlog" });
    expect(listing.statusCode).toBe(200); expect(listing.json<BacklogListResponse>().items).toHaveLength(1);
    const detail = await f.app.inject({ method: "GET", url: f.base });
    expect(detail.json()).toMatchObject({ body: f.body, initialPrompt: `This is backlog item item.\n\n${f.body}`, item: { readiness: "ready" } });
    expect(await f.claims.list()).toEqual([]);
  });
  it("claims on confirmed launch, reuses the same request, and rejects a competing owner", async () => {
    const f = await fixture(); const before = await readFile(f.itemPath, "utf8");
    const launch = await f.app.inject({ method: "POST", url: `${f.base}/launch`, payload: f.request });
    expect(launch.statusCode).toBe(200);
    expect(launch.json()).toMatchObject({ session: { id: "session", cwd: f.projectRoot }, reused: false, claim: { kind: "claimed" } });
    const repeat = await f.app.inject({ method: "POST", url: `${f.base}/launch`, payload: f.request });
    expect(repeat.json<BacklogLaunchResponse>().reused).toBe(true); expect(f.started()).toBe(1);
    const changed = await f.app.inject({ method: "POST", url: `${f.base}/launch`, payload: { ...f.request, start: { ...f.request.start, modelSpec: "another/model" } } });
    expect(changed.statusCode).toBe(409);
    const competing = await f.app.inject({ method: "POST", url: `${f.base}/launch`, payload: { ...f.request, requestId: "other" } });
    expect(competing.statusCode).toBe(409); expect(competing.json<BacklogErrorResponse>().claim).toMatchObject({ sessionId: "session" });
    expect(await readFile(f.itemPath, "utf8")).toBe(before);
    const claimedList = await f.app.inject({ method: "GET", url: "/backlog" });
    expect(claimedList.json<BacklogListResponse>().items[0]?.readiness).toBe("claimed");
    const staleRelease = await f.app.inject({ method: "POST", url: `${f.base}/release`, payload: { claimId: "old" } });
    expect(staleRelease.statusCode).toBe(409);
    const release = await f.app.inject({ method: "POST", url: `${f.base}/release`, payload: { claimId: launch.json<BacklogLaunchResponse>().claim.claimId } });
    expect(release.statusCode).toBe(200); expect(await f.claims.list()).toEqual([]);
  });
  it("serializes overlapping confirmed launches and coalesces identical requests", async () => {
    let complete: (session: SessionInfo) => void = () => undefined;
    const wait = new Promise<SessionInfo>((resolve) => { complete = resolve; });
    const f = await fixture({ start: () => wait });
    const first = f.app.inject({ method: "POST", url: `${f.base}/launch`, payload: f.request });
    const same = f.app.inject({ method: "POST", url: `${f.base}/launch`, payload: f.request });
    // Injection starts lazily. Observe both promises before resolving the start boundary.
    const responses = Promise.all([first, same]);
    complete(f.session);
    expect((await responses).map((response) => response.statusCode)).toEqual([200, 200]);
    expect(f.started()).toBe(1);
  });
  it("refuses release during creation and retains an interrupted claim until guarded recovery", async () => {
    let complete: (session: SessionInfo) => void = () => undefined;
    let entered: () => void = () => undefined;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const waiting = new Promise<SessionInfo>((resolve) => { complete = resolve; });
    const f = await fixture({ start: () => { entered(); return waiting; } });
    const launch = Promise.resolve(f.app.inject({ method: "POST", url: `${f.base}/launch`, payload: f.request }));
    await started;
    const reservation = (await f.claims.list())[0];
    expect(reservation?.kind).toBe("launching");
    const release = await f.app.inject({ method: "POST", url: `${f.base}/release`, payload: { claimId: reservation?.claimId } });
    expect(release.statusCode).toBe(409);
    complete(f.session); expect((await launch).statusCode).toBe(200);
    await f.claims.releaseSessions(["session"]);
    const interrupted = await f.claims.reserve({ projectId: f.project.id, itemId: "item", repo: f.projectRoot, cwd: f.projectRoot, requestId: "killed", fingerprint: "hash" });
    const reloaded = new BacklogClaimStore(join(f.root, "claims.json")); await reloaded.initialize();
    expect((await reloaded.list())[0]?.kind).toBe("interrupted");
    const backlog = new BacklogService({ projects: { list: () => Promise.resolve([f.project]), requireProject: () => Promise.resolve(f.project) }, claims: reloaded, userSessions: { start: () => Promise.resolve(f.session) }, sessions: { stop: () => undefined }, isArchived: () => Promise.resolve(false) });
    await expect(backlog.launch(f.project.id, "item", f.request)).rejects.toThrow("interrupted");
    await backlog.release(f.project.id, "item", { claimId: interrupted.claimId });
    expect(await reloaded.list()).toEqual([]);
  });

  it("rolls back a rejected session start", async () => {
    const f = await fixture({ start: () => Promise.reject(new Error("Model unavailable")) });
    const response = await f.app.inject({ method: "POST", url: `${f.base}/launch`, payload: f.request });
    expect(response.statusCode).toBe(503); expect(response.json<BacklogErrorResponse>().error).toBe("Model unavailable");
    expect(await f.claims.list()).toEqual([]);
  });
  it("rejects invalid bodies, missing items, blocked or closed items, and unrelated destinations", async () => {
    const f = await fixture();
    expect((await f.app.inject({ method: "POST", url: `${f.base}/launch`, payload: {} })).statusCode).toBe(400);
    expect((await f.app.inject({ method: "GET", url: `/backlog/${f.project.id}/items/absent` })).statusCode).toBe(404);
    await writeFile(f.itemPath, "---\nid: item\ntitle: Item\nstatus: Done\n---\n");
    expect((await f.app.inject({ method: "POST", url: `${f.base}/launch`, payload: f.request })).statusCode).toBe(409);
    await writeFile(f.itemPath, "---\nid: item\ntitle: Item\nblocked_by: [other]\n---\n");
    await writeFile(join(f.projectRoot, ".forgerie/backlog/other.md"), "---\nid: other\ntitle: Other\n---\n");
    expect((await f.app.inject({ method: "POST", url: `${f.base}/launch`, payload: f.request })).statusCode).toBe(409);
    await rm(join(f.projectRoot, ".forgerie/backlog/other.md"));
    expect((await f.app.inject({ method: "POST", url: `${f.base}/launch`, payload: { ...f.request, start: { cwd: f.root } } })).statusCode).toBe(400);
    expect(f.started()).toBe(0);
  });
  it("reports project failures without hiding other projects' items", async () => {
    const f = await fixture();
    const missing: Project = { id: "missing", name: "Missing", path: join(f.root, "absent"), createdAt: "2026-09-01" };
    const service = new BacklogService({ projects: { list: () => Promise.resolve([f.project, missing]), requireProject: () => Promise.resolve(f.project) }, claims: f.claims, userSessions: { start: () => Promise.resolve(f.session) }, sessions: { stop: () => undefined }, isArchived: () => Promise.resolve(false) });
    expect(await service.list()).toMatchObject({ items: [{ id: "item" }], warnings: [{ projectId: "missing", kind: "project-error" }] });
  });
});
