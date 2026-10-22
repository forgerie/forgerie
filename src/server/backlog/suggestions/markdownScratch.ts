import { execFile } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { SESSION_WORKTREE_DIRECTORY } from "../../../shared/sessionWorktree.js";
import { sanitizedGitEnv } from "../../git/gitEnv.js";
import { discoverGitWorktrees } from "../../workspaces/gitWorktreeDiscovery.js";
import { isMissingFile } from "../backlogError.js";

const execute = promisify(execFile);
const BRANCH_PREFIX = "forgerie-backlog-scratch/";
const DIRECTORY = "forgerie-backlog-scratch";
const validId = (id: string) => /^[A-Za-z0-9_-]+$/u.test(id);
/** Reserved namespace: startup may remove these checkouts and branches, including orphaned ones. */
export function backlogScratchIdentity(repo: string, id: string): { branch: string; path: string } {
  if (!validId(id)) throw new Error("Invalid backlog scratch suggestion ID");
  return { branch: `${BRANCH_PREFIX}${id}`, path: join(repo, SESSION_WORKTREE_DIRECTORY, DIRECTORY, id) };
}
export async function backlogGit(cwd: string, args: string[], env = sanitizedGitEnv()): Promise<string> {
  return (await execute("git", ["-C", cwd, ...args], { env: { ...env, FORGERIE_MANAGED_WORKTREE_SETUP: "1" }, timeout: 120000, maxBuffer: 16 * 1024 * 1024 })).stdout.trim();
}
export async function backlogScratchIndexDirectory(repo: string, id: string): Promise<string> {
  backlogScratchIdentity(repo, id);
  return join(await privateRoot(repo), id);
}
async function privateRoot(repo: string): Promise<string> { return join(resolve(repo, await backlogGit(repo, ["rev-parse", "--git-common-dir"])), DIRECTORY); }
export async function removeBacklogScratch(repo: string, id: string): Promise<void> {
  const scratch = backlogScratchIdentity(repo, id);
  if ((await discoverGitWorktrees(repo)).some(worktree => worktree.path === scratch.path)) await backlogGit(repo, ["worktree", "remove", "--force", scratch.path]);
  if (await backlogGit(repo, ["branch", "--list", scratch.branch]) !== "") await backlogGit(repo, ["branch", "-D", scratch.branch]);
  // Git can die during add, before registering a partially-created checkout.
  await rm(scratch.path, { recursive: true, force: true });
  await rm(await backlogScratchIndexDirectory(repo, id), { recursive: true, force: true });
}
/** Call under SessionWorktrees.withMainCheckout, before accepting requests. Never touches ordinary worktrees. */
export async function sweepBacklogScratch(repo: string): Promise<void> {
  const root = join(repo, SESSION_WORKTREE_DIRECTORY, DIRECTORY);
  const ids = new Set<string>();
  for (const worktree of await discoverGitWorktrees(repo)) {
    const id = relative(root, worktree.path);
    if (validId(id)) ids.add(id);
  }
  for (const branch of (await backlogGit(repo, ["for-each-ref", "--format=%(refname:short)", `refs/heads/${BRANCH_PREFIX}`])).split("\n")) {
    const id = branch.slice(BRANCH_PREFIX.length);
    if (branch.startsWith(BRANCH_PREFIX) && validId(id)) ids.add(id);
  }
  for (const directory of [root, await privateRoot(repo)]) {
    const folders = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => { if (isMissingFile(error)) return []; throw error; });
    for (const folder of folders) if (folder.isDirectory() && validId(folder.name)) ids.add(folder.name);
  }
  for (const id of ids) await removeBacklogScratch(repo, id);
}
