import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdtemp, mkdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { expect, it } from "vitest";
import { ProjectService } from "../projects/projectService.js";
import { ProjectStore } from "../storage/projectStore.js";
import { ProjectGroups } from "../projects/projectGroups.js";
import { registerProjectGroupRoutes } from "../projects/projectGroupRoutes.js";
import { SessionWorktrees } from "../workspaces/sessionWorktrees.js";
import { SessionWorktreeStore } from "../workspaces/sessionWorktreeStore.js";
import { WorkflowLibrary } from "../resources/workflowLibrary.js";
import { TriggerService } from "../triggers/triggerService.js";
import { sanitizedGitEnv } from "../git/gitEnv.js";
import { createProjectWorkspaceServices } from "./projectWorkspaceServices.js";

const exec = promisify(execFile);

it("keeps catalog discovery separate from fresh spawn, session, trigger and project-tool membership", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgerie-project-authorization-"));
  const app = Fastify();
  let triggers: TriggerService | undefined;
  try {
    const git = async (cwd: string, ...args: string[]) => (await exec("git", ["-C", cwd, ...args], { env: sanitizedGitEnv() })).stdout;
    const repo = join(root, "repo"), other = join(root, "other"), linked = join(root, "linked");
    const projects = new ProjectService(new ProjectStore(join(root, "projects.json")));
    for (const path of [repo, other]) {
      await mkdir(path);
      await git(path, "init", "-b", "main");
      await git(path, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "initial");
      await projects.add({ path });
    }
    await git(repo, "worktree", "add", "-b", "linked", linked);
    const registered = await projects.list();
    const home = registered.find((project) => project.path === repo);
    const target = registered.find((project) => project.path === other);
    if (home === undefined || target === undefined) throw new Error("Fixture projects were not registered");
    const groups = new ProjectGroups(join(root, "groups.json"), projects);
    await groups.save({ name: "all", projectIds: [home.id, target.id] });
    const store = new SessionWorktreeStore(join(root, "worktrees.json"));
    await store.initialize();
    // This is the same assembly sessiond supplies to session relationships, spawn authorization,
    // trigger validation, project tools, and the HTTP catalog/prepare routes.
    const services = createProjectWorkspaceServices({ projects, groups, worktrees: new SessionWorktrees(store), agentDir: root, writable: () => Promise.resolve(true) });
    triggers = await TriggerService.open({
      env: { PI_WEB_DATA_DIR: root }, workflows: new WorkflowLibrary(join(root, "agent")), workspaces: services.projectWorkspaces,
      fileSync: { watch: () => ({ close: () => undefined }) },
      fire: () => Promise.reject(new Error("No trigger should fire")), publish: () => undefined,
      onError: (error) => { throw error; },
    });
    registerProjectGroupRoutes(app, groups, projects, services.relatedWork);
    const ref = { id: "source", cwd: linked };
    const read = () => app.inject({ method: "GET", url: `/project-workspaces?id=source&cwd=${encodeURIComponent(linked)}` });
    const first = await read();
    expect(first.statusCode).toBe(200);
    expect(first.json<{ home: { id: string } }>().home.id).toBe(home.id);
    expect(await services.spawnTargets.resolveSpawnTarget(repo, linked)).toEqual({ allowed: true, cwd: linked });
    expect(await services.projectWorkspaces.forCwd(linked)).toContain(linked);
    expect(await services.projectWorkspaces.canonicalForCwd(linked)).toContain(linked);
    expect(await triggers.requireWorkspace(linked)).toBe(linked);
    expect((await services.relatedWork.context(ref, target.id)).project.id).toBe(target.id);

    // Remove only the registration. Restore the checkout directory so existence checks alone pass.
    const held = join(root, "held");
    await rename(linked, held);
    await git(repo, "worktree", "prune", "--expire=now");
    await rename(held, linked);
    await access(linked);
    expect(await git(repo, "worktree", "list", "--porcelain")).not.toContain(`worktree ${linked}`);

    // The request-local inventory index can notice removal before the display Git cache expires.
    expect((await read()).json()).toEqual({ groups: [], projects: [], related: [] });
    expect(await services.spawnTargets.resolveSpawnTarget(repo, linked)).toMatchObject({ allowed: false, reason: "out-of-project" });
    expect(await services.spawnTargets.resolveSpawnTarget(linked, repo)).toEqual({ allowed: false, reason: "not-registered" });
    expect(await services.projectWorkspaces.forCwd(linked)).toBeUndefined();
    expect(await services.projectWorkspaces.canonicalForCwd(linked)).toBeUndefined();
    await expect(triggers.requireWorkspace(linked)).rejects.toMatchObject({ status: 400, field: "action.targets.cwds" });
    await expect(services.relatedWork.context(ref, target.id)).rejects.toThrow("shared");
    await expect(services.relatedWork.prepare(ref, target.id, "request")).rejects.toThrow("shared");
    const prepared = await app.inject({ method: "POST", url: "/project-workspaces", payload: { ...ref, projectId: target.id, requestId: "http-request" } });
    expect(prepared.statusCode).toBe(409);
    expect(await store.list()).toEqual([]);
  } finally {
    await app.close();
    await triggers?.close();
    await rm(root, { recursive: true, force: true });
  }
});
