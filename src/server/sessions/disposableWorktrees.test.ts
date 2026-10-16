import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it } from "vitest";
import { sanitizedGitEnv } from "../git/gitEnv.js";
import { disposableWorktree } from "./disposableWorktrees.js";
import { gatedAction, type GatedActionReads } from "./gatedActions.js";

const run = promisify(execFile);
const git = async (cwd: string, args: readonly string[]) =>
  (await run("git", ["-C", cwd, ...args], { env: { ...sanitizedGitEnv(), GIT_OPTIONAL_LOCKS: "0" }, encoding: "utf8" })).stdout;

let base: string;
let scratch: string;
let project: string;
let child: string;
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "forgerie-disposable-"));
  scratch = join(base, "scratch");
  project = join(base, "project");
  child = join(base, "project-child");
  await mkdir(scratch);
  await mkdir(project);
  await git(project, ["init", "-q", "-b", "main"]);
  await git(project, ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-q", "--allow-empty", "-m", "Base"]);
  await git(project, ["worktree", "add", "-q", "-b", "child", child]);
  await git(project, ["clone", "-q", project, join(scratch, "baseline")]);
});
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

function reads(children: readonly string[]): GatedActionReads {
  return {
    git,
    issueLabels: () => Promise.resolve([]),
    disposable: disposableWorktree({ scratchRoot: scratch, childWorktrees: () => Promise.resolve(children) }),
  };
}

it("treats scratch clones and the session's child worktrees as disposable, and nothing else", async () => {
  const disposable = disposableWorktree({ scratchRoot: scratch, childWorktrees: () => Promise.resolve([child]) });
  expect(await disposable(join(scratch, "baseline"))).toBe(true);
  expect(await disposable(child)).toBe(true);
  expect(await disposable(project)).toBe(false);
  expect(await disposable(scratch)).toBe(false);
  expect(await disposable(`${scratch}-sibling`)).toBe(false);
  expect(await disposable(join(scratch, "missing"))).toBe(false); // A path that cannot be resolved is unknown.
  // A link inside the scratch root counts as the project it points to.
  await symlink(project, join(scratch, "link"));
  expect(await disposable(join(scratch, "link"))).toBe(false);
  const failing = disposableWorktree({ scratchRoot: scratch, childWorktrees: () => Promise.reject(new Error("store unavailable")) });
  expect(await failing(child)).toBe(false);
});

it("backs up a project worktree before it counts as disposable, and never accepts Forgerie-managed or main checkouts", async () => {
  const backups = join(base, "backups");
  const disposable = disposableWorktree({ scratchRoot: scratch, childWorktrees: () => Promise.resolve([]),
    projectBackup: { git, directory: backups, now: () => new Date("2026-10-16T12:00:00Z") } });
  const agent = join(project, ".worktree", "agent-fix");
  const managed = join(project, ".worktree", "s-0a6d74c8");
  const nested = join(project, "elsewhere", "other");
  for (const [path, branch] of [[agent, "agent-fix"], [managed, "session"], [nested, "other"]] as const) await git(project, ["worktree", "add", "-q", "-b", branch, path]);
  await writeFile(join(agent, "tracked.txt"), "one");
  await git(agent, ["add", "tracked.txt"]);
  await writeFile(join(agent, "notes.md"), "untracked");

  expect(await disposable(agent)).toBe(true);
  const [folder] = await readdir(backups);
  expect(folder).toBe("agent-fix-2026-10-16T12-00-00-000Z");
  expect(await readFile(join(backups, folder ?? "", "untracked", "notes.md"), "utf8")).toBe("untracked");
  expect(await readFile(join(backups, folder ?? "", "tracked.patch"), "utf8")).toContain("+one");
  expect(JSON.parse(await readFile(join(backups, folder ?? "", "worktree.json"), "utf8"))).toMatchObject({ branch: "agent-fix" });

  expect(await disposable(managed)).toBe(false);
  expect(await disposable(nested)).toBe(false);
  expect(await disposable(project)).toBe(false);
  // Without a backup target, project worktrees still wait for the user.
  expect(await disposableWorktree({ scratchRoot: scratch, childWorktrees: () => Promise.resolve([]) })(agent)).toBe(false);
  // A failed backup is not permission.
  const failing = disposableWorktree({ scratchRoot: scratch, childWorktrees: () => Promise.resolve([]),
    projectBackup: { git, directory: join(project, "base.txt", "cannot-create"), now: () => new Date() } });
  await writeFile(join(project, "base.txt"), "file");
  expect(await failing(agent)).toBe(false);
});

it("lets real destroy-local commands run in scratch clones and child worktrees, but gates the project", async () => {
  const classify = async (command: string, cwd: string, children: readonly string[] = [child]) =>
    (await gatedAction("bash", { command }, cwd, reads(children)))?.category;
  await writeFile(join(project, "dirty.txt"), "dirty");
  await git(project, ["add", "dirty.txt"]);
  await writeFile(join(child, "dirty.txt"), "dirty");
  await git(child, ["add", "dirty.txt"]);

  expect(await classify("git reset --hard", join(scratch, "baseline"))).toBeUndefined();
  expect(await classify("git reset --hard", child)).toBeUndefined();
  expect(await classify(`git -C ${child} checkout -- dirty.txt`, project)).toBeUndefined();
  expect(await classify(`git worktree remove --force ${child}`, project)).toBeUndefined();
  expect(await classify(`git worktree remove --force ${join(scratch, "baseline")}`, project)).toBeUndefined();

  expect(await classify("git reset --hard", project)).toBe("destroy-local");
  expect(await classify("git reset --hard", child, [])).toBe("destroy-local");
  expect(await classify(`cd ${project} && git clean -fd`, join(scratch, "baseline"))).toBe("destroy-local");
  expect(await classify("git reset --hard", join(scratch, "link-to-project"))).toBe("destroy-local");
  await symlink(project, join(scratch, "link-to-project"));
  expect(await classify("git reset --hard", join(scratch, "link-to-project"))).toBe("destroy-local");
});
