import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Project } from "../../shared/apiTypes.js";
import { sanitizedGitEnv } from "../git/gitEnv.js";
import { discoverGitWorktrees, isGitRepository } from "../workspaces/gitWorktreeDiscovery.js";
import { WorkspaceService } from "../workspaces/workspaceService.js";
import { SessionWorktreeStore } from "../workspaces/sessionWorktreeStore.js";
import { SessionWorktrees } from "../workspaces/sessionWorktrees.js";
import { ProjectWorkspaces } from "./projectWorkspaces.js";
import { ProjectCatalogHome } from "./projectCatalogHome.js";

const exec = promisify(execFile);
let root: string;
let projects: Project[];
let source: Project;
let worktrees: SessionWorktrees;
const git = async (cwd: string, ...args: string[]) => (await exec("git", ["-C", cwd, ...args], { env: sanitizedGitEnv() })).stdout;
const project = (id: string, path: string): Project => ({ id, name: id, path, createdAt: "now" });
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "forgerie-catalog-home-"));
  projects = [];
  for (let i = 0; i < 20; i++) {
    const path = join(root, i === 19 ? "a" : `unrelated-project-${String(i)}`);
    await mkdir(path);
    await git(path, "init", "-b", "main");
    await git(path, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "initial");
    projects.push(project(String(i), path));
  }
  const last = projects.at(-1);
  if (last === undefined) throw new Error("Missing source project");
  source = last;
  const store = new SessionWorktreeStore(join(root, "worktrees.json"));
  await store.initialize();
  worktrees = new SessionWorktrees(store);
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

function catalog(registered: Project[], workspaces: WorkspaceService, finder?: ProjectCatalogHome) {
  return new ProjectWorkspaces({
    projects: { list: () => Promise.resolve(registered), requireProject: (id) => {
      const found = registered.find((item) => item.id === id);
      return found === undefined ? Promise.reject(new Error("Missing project")) : Promise.resolve(found);
    } },
    groups: { list: () => Promise.resolve([{ id: "group", name: "all", projectIds: registered.map((item) => item.id), revision: 1, createdAt: "now", updatedAt: "now" }]) },
    workspaces, worktrees, agentDir: root, writable: () => Promise.resolve(false),
    ...(finder === undefined ? {} : { catalogHome: finder }),
  });
}

async function compare(cwd: string, registered = projects, maxCalls = 2) {
  let calls = 0;
  const workspaces = new WorkspaceService({
    isGitRepository(path) { calls++; return isGitRepository(path); },
    discoverGitWorktrees(path) { calls++; return discoverGitWorktrees(path); },
  });
  const indexed = catalog(registered, workspaces, new ProjectCatalogHome(workspaces));
  const reference = catalog(registered, new WorkspaceService());
  const ref = { id: "source", cwd };
  const actual = await indexed.catalog(ref);
  expect(actual).toEqual(await reference.catalog(ref));
  expect(calls).toBeLessThanOrEqual(maxCalls);
  return actual;
}

it("uses two Git calls for a cold root or linked-root catalog among 20 unrelated projects", async () => {
  expect((await compare(source.path)).home).toEqual(source);
  const linked = join(root, "linked-source");
  await git(source.path, "worktree", "add", "-b", "linked-source", linked);
  expect((await compare(linked)).home).toEqual(source);
});

it("keeps longest registered-path precedence when several project roots share a repository", async () => {
  const linked = join(root, "registered-linked-project-with-long-name");
  await git(source.path, "worktree", "add", "-b", "registered-linked", linked);
  const shared = project("shared", linked);
  expect((await compare(source.path, [...projects, shared])).home).toEqual(shared);
});

it("keeps the original project precedence across overlapping roots of different repositories", async () => {
  const earlier = projects[0];
  if (earlier === undefined) throw new Error("Missing overlapping project");
  const overlap = join(source.path, "overlap");
  await git(earlier.path, "worktree", "add", "-b", "overlap", overlap);
  await mkdir(join(overlap, "child"));
  expect((await compare(join(overlap, "child"))).home).toEqual(earlier);
});

it("preserves stable ties and symlinked project/source paths without listing unrelated repositories", async () => {
  const one = join(root, "tie-one"), two = join(root, "tie-two");
  await git(source.path, "worktree", "add", "-b", "tie-one", one);
  await git(source.path, "worktree", "add", "-b", "tie-two", two);
  const first = project("first", one), second = project("second", two);
  const tied = [first, second];
  expect((await compare(source.path, tied)).home).toEqual(first);
  const alias = join(root, "symlinked-project-with-a-longer-name");
  await symlink(source.path, alias);
  const symlinked = project("symlinked", alias);
  expect((await compare(alias, [...projects, symlinked])).home).toEqual(symlinked);
});

it("reads forward Git inventory rather than trusting a checkout's own .git pointer", async () => {
  const linked = join(root, "changed-git-pointer");
  await git(source.path, "worktree", "add", "-b", "changed-git-pointer", linked);
  await writeFile(join(linked, ".git"), "gitdir: /missing/repository\n");
  expect((await compare(linked)).home).toEqual(source);
});

it("sees removed registration immediately on a cold lookup even while the checkout directory remains", async () => {
  const linked = join(root, "removed-registration");
  await git(source.path, "worktree", "add", "-b", "removed-registration", linked);
  expect((await compare(linked)).home).toEqual(source);
  const held = join(root, "held");
  await rename(linked, held);
  await git(source.path, "worktree", "prune", "--expire=now");
  await rename(held, linked);
  await access(linked);
  expect((await compare(linked, projects, 0)).home).toBeUndefined();
});

it("lets Git handle unknown layouts and preserves prunable-worktree filtering", async () => {
  const nested = join(source.path, "registered-nested-with-incomplete-git-marker");
  await mkdir(join(nested, ".git"), { recursive: true });
  const registered = project("incomplete", nested);
  expect((await compare(source.path, [...projects, registered])).home).toEqual(registered);
  const prunable = join(root, "prunable");
  await git(source.path, "worktree", "add", "-b", "prunable", prunable);
  await rm(prunable, { recursive: true });
  expect((await compare(prunable)).home).toBeUndefined();
});

it("falls back to Git for separate Git directories instead of excluding an uncertain project", async () => {
  const separate = join(root, "separate-project-with-long-name");
  await mkdir(separate);
  await git(separate, "init", "--separate-git-dir", join(root, "metadata"), "-b", "main");
  expect((await compare(source.path, [...projects, project("separate", separate)], 4)).home).toEqual(source);
});

it("does not turn a candidate's Git discovery failure into a catalog match or a successful empty catalog", async () => {
  const finder = new ProjectCatalogHome(new WorkspaceService({
    isGitRepository,
    discoverGitWorktrees: () => Promise.reject(new Error("Git inventory unavailable")),
  }));
  await expect(finder.find(source.path, projects)).rejects.toThrow("Git inventory unavailable");
});

it("preserves catalog membership when a linked checkout was added through a symlinked parent", async () => {
  const parent = join(root, "actual-parent"), alias = join(root, "alias-parent");
  await mkdir(parent);
  await symlink(parent, alias);
  await git(source.path, "worktree", "add", "-b", "aliased-worktree", join(alias, "checkout"));
  await compare(join(parent, "checkout"));
  await compare(join(alias, "checkout"));
});
