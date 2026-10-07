import Fastify from "fastify";
import { execFile } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { BacklogDetailResponse, BacklogLaunchResponse, BacklogListResponse, SessionInfo } from "../../shared/apiTypes.js";
import type { GitHubSetupStart } from "../../shared/github.js";
import { BacklogClaimStore } from "../backlog/backlogClaimStore.js";
import { registerBacklogRoutes } from "../backlog/backlogRoutes.js";
import { BacklogService } from "../backlog/backlogService.js";
import { createGitHubBacklogProvider } from "../backlog/githubBacklog.js";
import { markdownBacklogProvider } from "../backlog/markdownBacklog.js";
import { sanitizedGitEnv } from "../git/gitEnv.js";
import { ProjectService } from "../projects/projectService.js";
import { ProjectStore } from "../storage/projectStore.js";
import { FakeGitHub, issue, json, stateOf } from "./fakeGitHub.testSupport.js";
import { GitHubApp } from "./githubApp.js";
import { GitHubAppStore } from "./githubAppStore.js";
import { GitHubIssueClient } from "./githubIssues.js";
import { registerGitHubRoutes } from "./githubRoutes.js";

const execute = promisify(execFile);
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs1", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "forgerie-github-routes-")); cleanups.push(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, "korri"); await mkdir(join(repo, ".forgerie/backlog"), { recursive: true });
  await execute("git", ["-C", repo, "init", "-b", "main"], { env: sanitizedGitEnv() });
  await execute("git", ["-C", repo, "remote", "add", "origin", "git@github.com:korri-os/korri.git"], { env: sanitizedGitEnv() });
  await writeFile(join(repo, ".forgerie/config.json"), JSON.stringify({ backlog: { providers: ["markdown", "github"] } }));
  await writeFile(join(repo, ".forgerie/backlog/7.md"), "---\nid: \"7\"\ntitle: Local seven\n---\nLocal body\n");
  const projects = new ProjectService(new ProjectStore(join(root, "projects.json")));
  const project = await projects.add({ path: repo });
  const github = new FakeGitHub();
  const store = new GitHubAppStore(join(root, "github-app.json")); await store.initialize();
  const app = new GitHubApp({ store, fetch: github.fetch, machineName: "zao" });
  const issues = new GitHubIssueClient({ app, fetch: github.fetch });
  const claims = new BacklogClaimStore(join(root, "claims.json")); await claims.initialize();
  const session: SessionInfo = { id: "session", cwd: repo, path: join(root, "session.jsonl"), created: "2026-10-07", modified: "2026-10-07", messageCount: 0, firstMessage: "" };
  const backlog = new BacklogService({ projects, claims, userSessions: { start: () => Promise.resolve(session) }, sessions: { stop: () => undefined }, isArchived: () => Promise.resolve(false),
    providers: [markdownBacklogProvider, createGitHubBacklogProvider({ issues })] });
  const server = Fastify(); registerGitHubRoutes(server, app); registerBacklogRoutes(server, backlog); cleanups.push(() => server.close());
  return { repo, project, github, server };
}

describe("GitHub App routes", () => {
  it("sets up the app, asks for the install, then lists the repo's issues beside markdown items and launches one", async () => {
    const f = await fixture();
    expect((await f.server.inject({ method: "GET", url: "/github/app" })).json()).toEqual({ state: "not-configured" });
    const before = (await f.server.inject({ method: "GET", url: "/backlog" })).json<BacklogListResponse>();
    expect(before.items.map((item) => [item.provider, item.id])).toEqual([["markdown", "7"]]);
    expect(before.warnings).toMatchObject([{ provider: "github", kind: "provider-auth", path: "korri-os/korri" }]);

    const start = (await f.server.inject({ method: "POST", url: "/github/app/setup", payload: { origin: "https://forgerie.tail.ts.net" } })).json<GitHubSetupStart>();
    const state = stateOf(start.action);
    f.github.on("POST https://api.github.com/app-manifests/code-1/conversions", json({ id: 42, slug: "forgerie-zao", client_id: "Iv23liForgerie01",
      html_url: "https://github.com/apps/forgerie-zao", owner: { login: "simonwjackson" }, pem: privateKey, client_secret: "x", webhook_secret: "y" }, { status: 201 }));
    const created = await f.server.inject({ method: "POST", url: "/github/app/created", payload: { code: "code-1", state } });
    expect(created.json()).toMatchObject({ state: "configured", installUrl: "https://github.com/apps/forgerie-zao/installations/new" });
    expect(created.body).not.toContain("PRIVATE KEY");

    f.github.on("GET https://api.github.com/repos/korri-os/korri/installation", json({ message: "Not Found" }, { status: 404 }));
    const notInstalled = (await f.server.inject({ method: "GET", url: "/backlog" })).json<BacklogListResponse>();
    expect(notInstalled.warnings).toMatchObject([{ provider: "github", kind: "provider-install", path: "korri-os/korri" }]);
  });

  it("lists and launches an issue once the app is installed, and no reply carries a key or token", async () => {
    const f = await fixture();
    const start = (await f.server.inject({ method: "POST", url: "/github/app/setup", payload: { origin: "https://forgerie.tail.ts.net" } })).json<GitHubSetupStart>();
    f.github.on("POST https://api.github.com/app-manifests/code-1/conversions", json({ id: 42, slug: "forgerie-zao", client_id: "Iv23liForgerie01",
      html_url: "https://github.com/apps/forgerie-zao", owner: { login: "simonwjackson" }, pem: privateKey }, { status: 201 }))
      .always("GET https://api.github.com/repos/korri-os/korri/installation", json({ id: 77 }))
      .always("POST https://api.github.com/app/installations/77/access_tokens", json({ token: "ghs_secret", expires_at: "2099-01-01T00:00:00Z" }, { status: 201 }))
      .always("GET https://api.github.com/repos/korri-os/korri/issues", json([issue(7, { title: "Remote seven" })]));
    await f.server.inject({ method: "POST", url: "/github/app/created", payload: { code: "code-1", state: stateOf(start.action) } });

    const listing = await f.server.inject({ method: "GET", url: "/backlog" });
    expect(listing.body).not.toMatch(/ghs_|PRIVATE KEY/u);
    const after = listing.json<BacklogListResponse>();
    expect(after.warnings).toEqual([]);
    expect(after.items.map((item) => [item.provider, item.id, item.title])).toEqual([["markdown", "7", "Local seven"], ["github", "7", "Remote seven"]]);
    const list = f.github.requests.find((request) => request.url.includes("/issues?"));
    expect(list?.headers["authorization"]).toBe("Bearer ghs_secret");

    const detail = (await f.server.inject({ method: "GET", url: `/backlog/${f.project.id}/items/7?provider=github` })).json<BacklogDetailResponse>();
    expect(detail.initialPrompt).toContain("<github-issue-7>");
    const launch = await f.server.inject({ method: "POST", url: `/backlog/${f.project.id}/items/7/launch?provider=github`, payload: { requestId: "r1", start: { cwd: f.repo } } });
    expect(launch.json<BacklogLaunchResponse>().claim).toMatchObject({ provider: "github", itemId: "7" });

    expect((await f.server.inject({ method: "DELETE", url: "/github/app" })).json()).toEqual({ state: "not-configured" });
  });

  it("refuses a setup reply it cannot trust, with the fix", async () => {
    const f = await fixture();
    expect((await f.server.inject({ method: "POST", url: "/github/app/setup", payload: {} })).statusCode).toBe(400);
    expect((await f.server.inject({ method: "POST", url: "/github/app/created", payload: { code: "c", state: "evil" } })).statusCode).toBe(400);
    const stranger = await f.server.inject({ method: "POST", url: "/github/app/created", payload: { code: "c", state: "forgerie-00000000000000000000000000000000" } });
    expect(stranger.statusCode).toBe(400);
    expect(stranger.json<{ error: string }>().error).toContain("Start the setup again");
  });
});
