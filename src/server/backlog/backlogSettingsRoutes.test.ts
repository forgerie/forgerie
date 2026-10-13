import Fastify from "fastify";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { BacklogSettingsStore } from "./backlogSettingsStore.js";
import { registerBacklogSettingsRoutes } from "./backlogSettingsRoutes.js";
it("validates settings routes, guards revisions, shows origins, and restores the repo", async () => {
  const root = await mkdtemp(join(tmpdir(), "settings-routes-")); const app = Fastify();
  try {
    const project = { id: "p", name: "Project", path: root, createdAt: "today" };
    await mkdir(join(root, ".forgerie")); await writeFile(join(root, ".forgerie/config.json"), JSON.stringify({ backlog: { providers: ["github"] } }));
    registerBacklogSettingsRoutes(app, new BacklogSettingsStore(join(root, "settings.json")), { list: () => Promise.resolve([project]), requireProject: (id) => id === "p" ? Promise.resolve(project) : Promise.reject(new Error("Project not found")) });
    const get = () => app.inject({ method: "GET", url: "/backlog/settings" });
    expect((await get()).json()).toMatchObject({ projects: [{ projectId: "p", source: "repo-file", backlog: { providers: ["github"] } }] });
    const url = "/backlog/settings/projects/p";
    for (const backlog of [{}, { providers: [] }, { providers: ["azure-devops"], azureDevops: { organization: "x", project: "y", pat: "secret" } }, { providers: ["markdown"], dir: "../secrets" }]) {
      expect((await app.inject({ method: "PUT", url, payload: { backlog, baseRevision: 0 } })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: "PUT", url, payload: { backlog: { providers: ["azure-devops"] }, baseRevision: 0 } })).statusCode).toBe(200);
    expect((await get()).json()).toMatchObject({ projects: [{ source: "forgerie", revision: 1 }] });
    expect((await app.inject({ method: "PUT", url, payload: { backlog: { providers: ["markdown"] }, baseRevision: 0 } })).statusCode).toBe(409);
    expect((await app.inject({ method: "DELETE", url, payload: { baseRevision: 0 } })).statusCode).toBe(409);
    expect((await app.inject({ method: "DELETE", url, payload: { baseRevision: 1 } })).statusCode).toBe(200);
    expect((await get()).json()).toMatchObject({ projects: [{ source: "repo-file" }] });
    expect((await app.inject({ method: "PUT", url: "/backlog/settings/github-login", payload: { githubLogin: "octocat" } })).statusCode).toBe(200);
    expect((await get()).json()).toMatchObject({ githubLogin: "octocat" });
    expect((await app.inject({ method: "PUT", url: "/backlog/settings/github-login", payload: { githubLogin: "a--b" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/backlog/settings/github-login", payload: { githubLogin: null } })).statusCode).toBe(200);
    expect((await get()).json()).not.toHaveProperty("githubLogin");
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});
