#!/usr/bin/env -S tsx
/**
 * node_modules/.bin/tsx scripts/benchmark-project-catalog.mjs
 * Real HTTP injection, 20 repositories and 60 linked worktrees in /tmp. No live services.
 * Every request bypasses the Git cache: compare the old serial scan with the display index.
 * The overlap case adds one nested repository. Both paths must return identical response bodies.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { ProjectWorkspaces } from "../src/server/projects/projectWorkspaces.ts";
import { ProjectCatalogHome } from "../src/server/projects/projectCatalogHome.ts";
import { ProjectGroups } from "../src/server/projects/projectGroups.ts";
import { registerProjectGroupRoutes } from "../src/server/projects/projectGroupRoutes.ts";
import { WorkspaceService } from "../src/server/workspaces/workspaceService.ts";
import { discoverGitWorktrees, isGitRepository } from "../src/server/workspaces/gitWorktreeDiscovery.ts";
import { SessionWorktreeStore } from "../src/server/workspaces/sessionWorktreeStore.ts";
import { SessionWorktrees } from "../src/server/workspaces/sessionWorktrees.ts";
import { sanitizedGitEnv } from "../src/server/git/gitEnv.ts";

const exec = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), "forgerie-cold-catalog-"));
const apps = [];
try {
  const projects = [];
  const git = (cwd, ...args) => exec("git", ["-C", cwd, ...args], { env: sanitizedGitEnv() });
  const initialize = async path => {
    await mkdir(path);
    await git(path, "init", "-b", "main");
    await git(path, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "initial");
  };
  for (let i = 0; i < 20; i++) {
    const path = join(root, i === 19 ? "a" : `unrelated-project-${i}`);
    await initialize(path);
    for (let j = 0; j < 3; j++) await git(path, "worktree", "add", "-b", `branch-${j}`, join(root, `wt-${i}-${j}`));
    projects.push({ id: String(i), name: String(i), path, createdAt: "now" });
  }
  const source = projects[19];
  const linked = join(root, "wt-19-0");
  const nested = join(source.path, "nested");
  const registry = { list: async () => projects, requireProject: async id => {
    const project = projects.find(project => project.id === id);
    if (!project) throw new Error("Missing project");
    return project;
  } };
  const groups = new ProjectGroups(join(root, "groups.json"), registry);
  await groups.save({ name: "all", projectIds: projects.map(project => project.id) });
  const store = new SessionWorktreeStore(join(root, "worktrees.json"));
  await store.initialize();
  let calls = 0, gitMs = 0;
  const runner = {
    async isGitRepository(path) { calls++; const start = performance.now(); try { return await isGitRepository(path); } finally { gitMs += performance.now() - start; } },
    async discoverGitWorktrees(path) { calls++; const start = performance.now(); try { return await discoverGitWorktrees(path); } finally { gitMs += performance.now() - start; } },
  };
  const workspaces = new WorkspaceService(runner);
  for (const indexed of [false, true]) {
    const app = Fastify();
    apps.push(app);
    const work = new ProjectWorkspaces({ projects: registry, groups, workspaces, worktrees: new SessionWorktrees(store), agentDir: root, writable: async () => true,
      ...(indexed ? { catalogHome: new ProjectCatalogHome(workspaces) } : {}) });
    registerProjectGroupRoutes(app, groups, registry, work);
    await app.ready();
  }
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  for (const [kind, cwd] of [["root", source.path], ["linked", linked], ["overlap", nested]]) {
    if (kind === "overlap") {
      await initialize(nested);
      projects.push({ ...source, id: "nested", path: nested });
    }
    let reference;
    for (let mode = 0; mode < apps.length; mode++) {
      const samples = [], counts = [], gitSamples = [];
      let home;
      for (let trial = 0; trial < 5; trial++) {
        calls = gitMs = 0;
        const start = performance.now();
        const response = await apps[mode].inject({ method: "GET", url: `/project-workspaces?id=fixture&cwd=${encodeURIComponent(cwd)}` });
        samples.push(performance.now() - start);
        if (response.statusCode !== 200) throw new Error(response.body);
        reference ??= response.body;
        if (reference !== response.body) throw new Error("Catalog response changed");
        counts.push(calls); gitSamples.push(gitMs); home = response.json().home?.id;
      }
      process.stdout.write(JSON.stringify({ mode: mode === 0 ? "serial" : "indexed", kind, projects: projects.length, linkedWorktrees: 60,
        coldRequests: samples.length, medianMs: median(samples), maxMs: Math.max(...samples), medianGitMs: median(gitSamples), gitCallsPerRequest: counts, home }) + "\n");
    }
  }
} finally {
  try { await Promise.all(apps.map(app => app.close())); }
  finally { await rm(root, { recursive: true, force: true }); }
}
