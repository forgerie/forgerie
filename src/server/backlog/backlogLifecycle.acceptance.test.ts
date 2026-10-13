import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectService } from "../projects/projectService.js";
import { ProjectStore } from "../storage/projectStore.js";
import { SessionArchiveStore } from "../sessions/sessionArchiveStore.js";
import { createPiSessionManagerGateway } from "../sessions/piSessionManagerGateway.js";
import { PiSessionService } from "../sessions/piSessionService.js";
import { CapturingSessionEventHub, createTestModelRuntime } from "../sessions/piSessionService.testSupport.js";
import { SessionWorktrees } from "../workspaces/sessionWorktrees.js";
import { SessionWorktreeStore } from "../workspaces/sessionWorktreeStore.js";
import { UserSessionWorktrees } from "../workspaces/sessionWorktreeRoutes.js";
import { sanitizedGitEnv } from "../git/gitEnv.js";
import { BacklogClaimStore } from "./backlogClaimStore.js";
import { BacklogService } from "./backlogService.js";
import Fastify from "fastify";
import type { BacklogLaunchResponse } from "../../shared/backlog.js";
import { azureConfig, azureServer } from "../azureDevops/azureDevops.testSupport.js";
import { createAzureDevopsBacklogProvider } from "./azureDevopsBacklog.js";
import { BacklogSettingsStore } from "./backlogSettingsStore.js";
import { registerBacklogRoutes } from "./backlogRoutes.js";
import { withBacklogClaimRelease } from "./backlogArchive.js";

const execute = promisify(execFile);
const roots: string[] = [];
const services: PiSessionService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()));
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "forgerie-backlog-lifecycle-")); roots.push(root);
  const repo = join(root, "repo"); const agentDir = join(root, "agent"); const home = join(root, "home");
  await Promise.all([repo, agentDir, home].map((path) => mkdir(path)));
  vi.stubEnv("HOME", home);
  const git = async (...args: string[]) => (await execute("git", ["-C", repo, ...args], { env: sanitizedGitEnv() })).stdout.trim();
  await git("init", "-b", "main");
  await mkdir(join(repo, ".forgerie/backlog"), { recursive: true });
  const source = "---\nid: work\ntitle: Work\n---\n\n# Acceptance work\nKeep this body unchanged.  \n";
  const itemPath = join(repo, ".forgerie/backlog/work.md"); await writeFile(itemPath, source);
  await git("add", "."); await git("-c", "user.name=Acceptance", "-c", "user.email=acceptance@example.invalid", "commit", "-m", "Base");
  const projects = new ProjectService(new ProjectStore(join(root, "projects.json")));
  const project = await projects.add({ path: repo });
  const archives = new SessionArchiveStore(join(root, "archives.json")); await archives.initialize();
  const claims = new BacklogClaimStore(join(root, "claims.json")); await claims.initialize();
  const scripted = createFauxCore({ provider: "acceptance", api: "acceptance" });
  scripted.setResponses(Array.from({ length: 20 }, () => fauxAssistantMessage("OK")));
  const modelRuntime = await createTestModelRuntime();
  modelRuntime.registerProvider("acceptance", { api: "acceptance", apiKey: "acceptance", baseUrl: "http://localhost:0", streamSimple: scripted.streamSimple,
    models: [{ id: "local", name: "Local acceptance", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100_000, maxTokens: 1000 }] });
  const worktreeStore = new SessionWorktreeStore(join(root, "worktrees.json")); await worktreeStore.initialize();
  const worktrees = new SessionWorktrees(worktreeStore); await worktrees.initialize();
  const events = new CapturingSessionEventHub();
  const sessions = new PiSessionService(events, { agentDir, modelRuntime, archiveStore: withBacklogClaimRelease(archives, claims), sessionWorktrees: worktrees,
    sessionManager: createPiSessionManagerGateway({ agentDir, env: {}, sessionDirEnvKeys: [] }), heartbeatIntervalMs: 60_000 });
  services.push(sessions);
  const userSessions = new UserSessionWorktrees(worktrees, sessions);
  const backlog = new BacklogService({ projects, claims, sessions, userSessions, isArchived: (id) => archives.isArchived(id) });
  return { root, repo, source, itemPath, project, projects, userSessions, archives, backlog, claims, sessions, events, git };
}

describe("hosted backlog lifecycle", () => {
  it.each(["existing-workspace", "fresh-worktree"] as const)("launches and archives a real Pi session in %s without editing the item", async (kind) => {
    const f = await fixture();
    const launched = await f.backlog.launch(f.project.id, "work", { requestId: "confirmed", start: { cwd: f.repo, modelSpec: "acceptance/local", destination: { kind } } });
    expect(launched.claim.kind).toBe("claimed");
    expect(launched.session.cwd === f.repo).toBe(kind === "existing-workspace");
    expect((await f.backlog.list()).items[0]?.readiness).toBe("claimed");
    // This is the existing composer's second operation, against the actual hosted runtime.
    await f.sessions.prompt(launched.session, launched.initialPrompt);
    await vi.waitFor(() => { expect(f.events.sessionEvents.some(({ event }) => event.type === "agent.end")).toBe(true); }, { timeout: 10_000 });
    const history = await f.sessions.messages(launched.session);
    expect(JSON.stringify(history.messages)).toContain("Acceptance work");
    expect((await f.sessions.status(launched.session)).persisted).toBe(true);
    await f.sessions.archive(launched.session);
    expect(await f.claims.list()).toEqual([]);
    expect((await f.backlog.list()).items[0]?.readiness).toBe("ready");
    await f.sessions.deleteArchivedMany([{ id: launched.session.id, cwd: launched.session.cwd }]);
    expect(await f.claims.list()).toEqual([]);
    expect(await readFile(f.itemPath, "utf8")).toBe(f.source);
    expect(await f.git("status", "--porcelain")).toBe("");
  }, 20_000);
});


it("launches a source item through HTTP into a different registered repo's real worktree and archives its claim", async () => {
  const f = await fixture(); const azure = await azureServer(); const app = Fastify();
  try {
    const destination = join(f.root, "destination"); await mkdir(destination);
    const git = async (...args: string[]) => (await execute("git", ["-C", destination, ...args], { env: sanitizedGitEnv() })).stdout.trim();
    await git("init", "-b", "main"); await writeFile(join(destination, "README.md"), "Destination");
    await git("add", "."); await git("-c", "user.name=Acceptance", "-c", "user.email=acceptance@example.invalid", "commit", "-m", "Base");
    const project = await f.projects.add({ path: destination });
    const settings = new BacklogSettingsStore(join(f.root, "backlog-settings.json"), { projects: () => f.projects.list() });
    const source = await settings.createSource(azureConfig);
    const backlog = new BacklogService({ projects: f.projects, claims: f.claims, userSessions: f.userSessions, sessions: f.sessions, settings,
      sourceProvider: createAzureDevopsBacklogProvider(azure.client), isArchived: (id) => f.archives.isArchived(id) });
    registerBacklogRoutes(app, backlog);
    const response = await app.inject({ method: "POST", url: `/backlog/sources/${source.id}/items/amazeinsights%3A7/launch`, payload: {
      requestId: "azure-confirmed", start: { cwd: destination, modelSpec: "acceptance/local", destination: { kind: "fresh-worktree" } },
    } });
    expect(response.statusCode).toBe(200); const launched = response.json<BacklogLaunchResponse>();
    expect(launched.claim).toMatchObject({ kind: "claimed", sourceId: source.id, projectId: project.id, repo: destination });
    expect(launched.session.cwd).not.toBe(destination);
    expect((await backlog.list()).items.find((item) => item.provider === "azure-devops")).toMatchObject({ readiness: "claimed", owner: { kind: "source", sourceId: source.id } });
    await f.sessions.prompt(launched.session, launched.initialPrompt);
    await vi.waitFor(() => { expect(f.events.sessionEvents.some(({ event }) => event.type === "agent.end")).toBe(true); }, { timeout: 10_000 });
    expect(JSON.stringify((await f.sessions.messages(launched.session)).messages)).toContain("Compare current totals");
    await f.sessions.archive(launched.session); expect(await f.claims.list()).toEqual([]);
    expect(await readFile(f.itemPath, "utf8")).toBe(f.source);
    expect(await git("status", "--porcelain")).toBe(""); expect(await f.git("status", "--porcelain")).toBe("");
  } finally { await app.close(); await azure.close(); }
}, 20_000);
