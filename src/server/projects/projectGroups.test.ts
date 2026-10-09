import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import Fastify from "fastify";
import { ProjectGroups } from "./projectGroups.js";
import { registerProjectGroupRoutes } from "./projectGroupRoutes.js";
import { ProjectWorkspaces } from "./projectWorkspaces.js";
import { WorkspaceService } from "../workspaces/workspaceService.js";
import { SessionWorktrees } from "../workspaces/sessionWorktrees.js";
import { SessionWorktreeStore } from "../workspaces/sessionWorktreeStore.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "forgerie-groups-")); roots.push(root);
  const projects = [{ id: "a", name: "Same name", path: root, createdAt: "now" }, { id: "b", name: "Same name", path: `${root}/b`, createdAt: "now" }];
  const registry = { list: () => Promise.resolve(projects), requireProject: (id: string) => { const project = projects.find((p) => p.id === id); if (!project) throw new Error("Unknown project"); return Promise.resolve(project); } };
  const path = join(root, "groups.json");
  return { root, path, projects, registry, groups: new ProjectGroups(path, registry) };
}
it("persists organization only, allows shared members and refuses concurrent stale edits", async () => {
  const f = await fixture();
  expect(await f.groups.list()).toEqual([]);
  const one = await f.groups.save({ name: " KORI ", projectIds: ["a", "b"] });
  await f.groups.save({ name: "Other", projectIds: ["a"] });
  expect(one.name).toBe("KORI");
  const outcomes = await Promise.allSettled([f.groups.save({ name: "Updated", projectIds: ["b"] }, one), f.groups.save({ name: "Stale", projectIds: [] }, one)]);
  expect(outcomes.map((item) => item.status)).toEqual(["fulfilled", "rejected"]);
  const reloaded = new ProjectGroups(f.path, f.registry);
  expect((await reloaded.list()).find((g) => g.id === one.id)?.revision).toBe(2);
  await reloaded.remove(one.id, 2);
  expect(f.projects).toHaveLength(2);
  expect(await reloaded.list()).toHaveLength(1);
});
it("retains closed members but refuses new unknown IDs and corrupt persistence", async () => {
  const f = await fixture();
  const group = await f.groups.save({ name: "KORI", projectIds: ["a", "b"] });
  f.projects.pop();
  await f.groups.save({ name: "KORI 2", projectIds: ["a", "b"] }, group);
  await expect(f.groups.save({ name: "Bad", projectIds: ["missing"] })).rejects.toThrow("Unknown");
  await expect(f.groups.save({ name: "Bad", projectIds: ["a", "a"] })).rejects.toThrow("distinct");
  await writeFile(f.path, '{"version":99}');
  await expect(f.groups.save({ name: "No overwrite", projectIds: [] })).rejects.toThrow("Invalid project group file");
  expect(await readFile(f.path, "utf8")).toBe('{"version":99}');
});
it("validates route bodies and returns 409 for stale group updates without creating sessions", async () => {
  const f = await fixture();
  const app = Fastify();
  registerProjectGroupRoutes(app, f.groups, f.registry, new ProjectWorkspaces({ projects: f.registry, groups: f.groups, workspaces: new WorkspaceService(), worktrees: new SessionWorktrees(new SessionWorktreeStore()), agentDir: f.root, writable: () => Promise.resolve(false) }));
  try {
    expect((await app.inject({ method: "POST", url: "/project-groups", payload: { name: "Bad", projectIds: ["a"], cwd: "/bad" } })).statusCode).toBe(400);
    const created = await app.inject({ method: "POST", url: "/project-groups", payload: { name: "KORI", projectIds: ["a"] } });
    const group = created.json<{ id: string; revision: number }>();
    expect((await app.inject({ method: "PUT", url: `/project-groups/${group.id}`, payload: { name: "New", projectIds: ["b"], revision: group.revision } })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: `/project-groups/${group.id}?revision=1` })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: "/project-workspaces", payload: { id: "s", cwd: f.root, projectId: "b", requestId: "r" } })).statusCode).toBe(409);
  } finally { await app.close(); }
});
