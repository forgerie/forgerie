import type { BacklogSettingsResponse } from "../../shared/backlogSettings.js";
import Fastify from "fastify";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
    const invalidBots = [["coderabbitai"], ["a[bot]", "a[bot]"], Array.from({ length: 21 }, (_, i) => `bot-${String(i)}[bot]`)];
    const invalidBotSettings = invalidBots.map(trustedBots => ({ providers: ["github"], github: { trustedBots } }));
    for (const backlog of [...invalidBotSettings, {}, { providers: [] }, { providers: ["azure-devops"], azureDevops: { organization: "x", project: "y", pat: "secret" } }, { providers: ["markdown"], dir: "../secrets" }]) {
      expect((await app.inject({ method: "PUT", url, payload: { backlog, baseRevision: 0 } })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: "PUT", url, payload: { backlog: { providers: ["github"], github: { repo: "owner/repo", authors: "trusted", trustedBots: ["coderabbitai[bot]"] } }, baseRevision: 0 } })).statusCode).toBe(200);
    expect((await get()).json()).toMatchObject({ projects: [{ source: "forgerie", revision: 1, backlog: { github: { repo: "owner/repo", authors: "trusted", trustedBots: ["coderabbitai[bot]"] } } }] });
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

it("rejects case-insensitive trusted bot duplicates with a clear 400 and leaves saved settings unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "settings-bot-duplicates-")); const app = Fastify();
  try {
    const project = { id: "p", name: "Project", path: root, createdAt: "today" };
    const path = join(root, "settings.json");
    const store = new BacklogSettingsStore(path);
    const backlog = { providers: ["github" as const], github: { trustedBots: ["CodeRabbitAI[bot]", "dependabot[bot]"] } };
    await store.save("p", backlog, 0);
    const before = await readFile(path, "utf8");
    registerBacklogSettingsRoutes(app, store, { list: () => Promise.resolve([project]), requireProject: () => Promise.resolve(project) });
    const rejected = await app.inject({ method: "PUT", url: "/backlog/settings/projects/p", payload: { backlog: { providers: ["github"], github: { trustedBots: ["coderabbitai[bot]", "CodeRabbitAI[bot]"] } }, baseRevision: 1 } });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toEqual({ error: "backlog.github.trustedBots must contain unique bot logins (case-insensitive): Backlog settings" });
    expect(await readFile(path, "utf8")).toBe(before);
    expect((await app.inject({ method: "GET", url: "/backlog/settings" })).json()).toMatchObject({ projects: [{ backlog, revision: 1 }] });
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});

it("isolates inaccessible repo settings and returns stored overrides without opening their project directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "settings-inaccessible-")); const app = Fastify();
  try {
    const good = { id: "good", name: "Healthy", path: root, createdAt: "today" };
    const missing = { ...good, id: "missing", name: "Missing", path: join(root, "gone") };
    const stored = { ...good, id: "stored", name: "Stored", path: join(root, "also-gone") };
    const invalid = { ...good, id: "invalid", name: "Invalid repo file", path: join(root, "invalid") };
    await mkdir(join(invalid.path, ".forgerie"), { recursive: true });
    await writeFile(join(invalid.path, ".forgerie/config.json"), "invalid-json-must-not-be-reflected");
    const projects = [good, missing, stored, invalid];
    const store = new BacklogSettingsStore(join(root, "backlog-settings.json"));
    await store.setGitHubLogin("octocat"); await store.save(stored.id, { providers: ["github"] }, 0);
    registerBacklogSettingsRoutes(app, store, { list: () => Promise.resolve(projects), requireProject: (id) => { const project = projects.find((p) => p.id === id); return project === undefined ? Promise.reject(new Error("Project not found")) : Promise.resolve(project); } });
    const response = await app.inject({ method: "GET", url: "/backlog/settings" });
    expect(response.statusCode).toBe(200);
    const readError = "Cannot read this project's backlog settings. Check its project folder and .forgerie/config.json, then reload.";
    expect(response.json()).toMatchObject({ githubLogin: "octocat", projects: [
      { projectId: "good", source: "default", backlog: { providers: ["markdown"] } },
      { projectId: "missing", error: readError },
      { projectId: "stored", source: "forgerie", revision: 2, backlog: { providers: ["github"] } },
      { projectId: "invalid", error: readError },
    ] });
    expect(response.body).not.toContain("invalid-json-must-not-be-reflected");
    expect((await app.inject({ method: "PUT", url: "/backlog/settings/projects/good", payload: { backlog: { providers: ["github"] }, baseRevision: 0 } })).statusCode).toBe(200);
    expect((await app.inject({ method: "PUT", url: "/backlog/settings/github-login", payload: { githubLogin: "new-login" } })).statusCode).toBe(200);
    const after = (await app.inject({ method: "GET", url: "/backlog/settings" })).json<BacklogSettingsResponse>();
    expect(after.githubLogin).toBe("new-login");
    expect(after.projects.find((project) => project.projectId === "good")).toMatchObject({ source: "forgerie", backlog: { providers: ["github"] } });
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});

it.each(["not-json-secret", JSON.stringify({ version: 99, projects: {} })])("fails closed with the same file recovery message in Backlog and Settings (%s)", async (contents) => {
  const root = await mkdtemp(join(tmpdir(), "settings-corrupt-")); const app = Fastify();
  try {
    const { BacklogService } = await import("./backlogService.js");
    const { BacklogClaimStore } = await import("./backlogClaimStore.js");
    const { registerBacklogRoutes } = await import("./backlogRoutes.js");
    const project = { id: "p", name: "Project", path: root, createdAt: "today" };
    await mkdir(join(root, ".forgerie/backlog"), { recursive: true });
    await writeFile(join(root, ".forgerie/backlog/item.md"), "---\nid: item\ntitle: Must not appear\n---\n");
    const path = join(root, "backlog-settings.json"); await writeFile(path, contents);
    const store = new BacklogSettingsStore(path);
    const projects = { list: () => Promise.resolve([project]), requireProject: () => Promise.resolve(project) };
    const claims = new BacklogClaimStore(join(root, "claims.json")); await claims.initialize();
    registerBacklogSettingsRoutes(app, store, projects);
    registerBacklogRoutes(app, new BacklogService({ projects, claims, settings: store, userSessions: { start: () => Promise.reject(new Error("Must not launch")) }, sessions: { stop: () => undefined }, isArchived: () => Promise.resolve(false) }));
    const backlog = await app.inject({ method: "GET", url: "/backlog" });
    const settings = await app.inject({ method: "GET", url: "/backlog/settings" });
    expect(backlog.statusCode).toBe(503); expect(settings.statusCode).toBe(503);
    const message = backlog.json<{ error: string }>().error;
    expect(message).toContain("backlog-settings.json"); expect(message).toContain("Restore"); expect(message).toContain("remove");
    expect(settings.json()).toMatchObject({ error: message });
    expect(backlog.body).not.toContain("Must not appear"); expect(settings.body).not.toContain("not-json-secret");
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});
