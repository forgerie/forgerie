import Fastify from "fastify";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BacklogDetailResponse, BacklogLaunchResponse, BacklogListResponse, SessionInfo } from "../../shared/apiTypes.js";
import { BacklogClaimStore } from "../backlog/backlogClaimStore.js";
import { registerBacklogRoutes } from "../backlog/backlogRoutes.js";
import { BacklogService } from "../backlog/backlogService.js";
import { createGitHubBacklogProvider } from "../backlog/githubBacklog.js";
import { markdownBacklogProvider } from "../backlog/markdownBacklog.js";
import { sanitizedGitEnv } from "../git/gitEnv.js";
import { ProjectService } from "../projects/projectService.js";
import { ProjectStore } from "../storage/projectStore.js";
import { FakeGitHub, issue, json } from "./fakeGitHub.testSupport.js";
import { GitHubAuth } from "./githubAuth.js";
import { GitHubAuthStore } from "./githubAuthStore.js";
import { GitHubIssueClient } from "./githubIssues.js";
import { registerGitHubRoutes } from "./githubRoutes.js";

const execute = promisify(execFile);
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
  const store = new GitHubAuthStore(join(root, "github-auth.json")); await store.initialize();
  const auth = new GitHubAuth({ store, fetch: github.fetch, wait: () => Promise.resolve() });
  const issues = new GitHubIssueClient({ auth, fetch: github.fetch });
  const claims = new BacklogClaimStore(join(root, "claims.json")); await claims.initialize();
  const session: SessionInfo = { id: "session", cwd: repo, path: join(root, "session.jsonl"), created: "2026-10-07", modified: "2026-10-07", messageCount: 0, firstMessage: "" };
  const backlog = new BacklogService({ projects, claims, userSessions: { start: () => Promise.resolve(session) }, sessions: { stop: () => undefined }, isArchived: () => Promise.resolve(false),
    providers: [markdownBacklogProvider, createGitHubBacklogProvider({ issues })] });
  const app = Fastify(); registerGitHubRoutes(app, auth); registerBacklogRoutes(app, backlog); cleanups.push(() => app.close());
  return { repo, project, github, app, claims };
}

describe("GitHub login and issue routes", () => {
  it("logs in through the routes, never returns a token, and then lists the repo's issues beside markdown items", async () => {
    const f = await fixture();
    expect((await f.app.inject({ method: "GET", url: "/github/auth" })).json()).toEqual({ state: "not-configured" });
    expect((await f.app.inject({ method: "PUT", url: "/github/app", payload: { clientId: "bad id" } })).statusCode).toBe(400);
    expect((await f.app.inject({ method: "PUT", url: "/github/app", payload: { clientId: "Iv23liForgerie01", slug: "forgerie-zao" } })).json()).toMatchObject({ state: "disconnected" });

    const before = (await f.app.inject({ method: "GET", url: "/backlog" })).json<BacklogListResponse>();
    expect(before.items.map((item) => [item.provider, item.id])).toEqual([["markdown", "7"]]);
    expect(before.warnings).toMatchObject([{ provider: "github", kind: "provider-auth", path: "korri-os/korri" }]);

    f.github.on("POST https://github.com/login/device/code", json({ device_code: "dev", user_code: "ABCD-EFGH", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 }))
      .on("POST https://github.com/login/oauth/access_token", json({ access_token: "ghu_secret", expires_in: 28_800, refresh_token: "ghr_secret", refresh_token_expires_in: 15_897_600 }))
      .on("GET https://api.github.com/user", json({ login: "simonwjackson" }))
      .always("GET https://api.github.com/repos/korri-os/korri/issues", json([issue(7, { title: "Remote seven" })]));
    const login = await f.app.inject({ method: "POST", url: "/github/auth/login" });
    expect(login.json()).toMatchObject({ state: "pending", userCode: "ABCD-EFGH" });
    await vi.waitFor(async () => { expect((await f.app.inject({ method: "GET", url: "/github/auth" })).json()).toMatchObject({ state: "connected", login: "simonwjackson" }); });

    const listing = await f.app.inject({ method: "GET", url: "/backlog" });
    expect(listing.body).not.toMatch(/ghu_|ghr_/u);
    const after = listing.json<BacklogListResponse>();
    expect(after.warnings).toEqual([]);
    expect(after.items.map((item) => [item.provider, item.id, item.title])).toEqual([["markdown", "7", "Local seven"], ["github", "7", "Remote seven"]]);

    const detail = (await f.app.inject({ method: "GET", url: `/backlog/${f.project.id}/items/7?provider=github` })).json<BacklogDetailResponse>();
    expect(detail.initialPrompt).toContain("<github-issue-7>");
    expect(detail.item.url).toBe("https://github.com/korri-os/korri/issues/7");

    const launch = await f.app.inject({ method: "POST", url: `/backlog/${f.project.id}/items/7/launch?provider=github`, payload: { requestId: "r1", start: { cwd: f.repo } } });
    expect(launch.statusCode).toBe(200);
    expect(launch.json<BacklogLaunchResponse>().claim).toMatchObject({ provider: "github", itemId: "7" });
    const claimed = (await f.app.inject({ method: "GET", url: "/backlog" })).json<BacklogListResponse>();
    expect(claimed.items.map((item) => [item.provider, item.readiness])).toEqual([["markdown", "ready"], ["github", "claimed"]]);

    expect((await f.app.inject({ method: "DELETE", url: "/github/auth" })).json()).toMatchObject({ state: "disconnected" });
  });

  it("answers a login GitHub refuses with the fix", async () => {
    const f = await fixture();
    await f.app.inject({ method: "PUT", url: "/github/app", payload: { clientId: "Iv23liForgerie01" } });
    f.github.on("POST https://github.com/login/device/code", json({ error: "device_flow_disabled" }));
    const response = await f.app.inject({ method: "POST", url: "/github/auth/login" });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toContain("Enable Device Flow");
  });
});
