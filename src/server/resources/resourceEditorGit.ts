import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, realpath } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { sanitizedGitEnv } from "../git/gitEnv.js";
import { insideResourceRoot, isMissingResource, ResourceEditorError } from "./resourceEditorFiles.js";

const execute = promisify(execFile);
async function git(cwd: string, args: string[]): Promise<string> {
  return (await execute("git", ["--literal-pathspecs", "-c", "core.fsmonitor=false", ...args], { cwd, env: sanitizedGitEnv(), encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024 })).stdout.trimEnd();
}
export interface ResourceCheckout { root: string; kind: "main" | "worktree" | "non-git"; gitDir?: string }

export async function resourceCheckout(cwd: string): Promise<ResourceCheckout> {
  let root: string;
  try { root = await git(cwd, ["rev-parse", "--show-toplevel"]); }
  catch (error) {
    if (error instanceof Error && error.message.includes("not a git repository")) return { kind: "non-git", root: await realpath(cwd) };
    throw error;
  }
  const [gitDir, commonDir] = await Promise.all([
    git(cwd, ["rev-parse", "--path-format=absolute", "--git-dir"]).then((path) => realpath(path)),
    git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).then((path) => realpath(path)),
  ]);
  return { root: await realpath(root), gitDir, kind: gitDir === commonDir ? "main" : "worktree" };
}

interface CommitBase { head: string; branch: string; path: string }
export async function prepareResourceCommit(checkout: ResourceCheckout, path: string): Promise<CommitBase> {
  if (checkout.gitDir === undefined || !insideResourceRoot(path, checkout.root)) throw new ResourceEditorError("unsafe-git-state", "The file does not belong to this checkout.");
  for (const name of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply", "sequencer", "index.lock"]) {
    const statePath = await git(checkout.root, ["rev-parse", "--path-format=absolute", "--git-path", name]);
    try { await access(statePath); }
    catch (error) { if (isMissingResource(error)) continue; throw error; }
    throw new ResourceEditorError("unsafe-git-state", "Finish the current Git operation before saving a resource.");
  }
  let branch: string;
  let head: string;
  try { branch = await git(checkout.root, ["symbolic-ref", "--short", "HEAD"]); head = await git(checkout.root, ["rev-parse", "HEAD"]); }
  catch { throw new ResourceEditorError("unsafe-git-state", "A resource commit requires an existing commit and an attached branch."); }
  if (await git(checkout.root, ["ls-files", "--unmerged"]) !== "") throw new ResourceEditorError("unsafe-git-state", "Resolve Git conflicts before saving a resource.");
  const rel = relative(checkout.root, path);
  try { await git(checkout.root, ["ls-files", "--error-unmatch", "--", rel]); }
  catch { throw new ResourceEditorError("unsafe-git-state", "Add and commit this resource in Git before editing it here."); }
  if (!(await git(checkout.root, ["ls-files", "-v", "--", rel])).startsWith("H ")) throw new ResourceEditorError("unsafe-git-state", "Clear assume-unchanged or skip-worktree flags on this resource before editing it here.");
  if (await git(checkout.root, ["status", "--porcelain=v1", "--untracked-files=all", "--", rel]) !== "") throw new ResourceEditorError("unsafe-git-state", "This resource already has uncommitted changes. Commit or discard those changes before editing it here.");
  return { head, branch, path: rel };
}

export async function commitResource(checkout: ResourceCheckout, base: CommitBase): Promise<{ sha: string; branch: string }> {
  try {
    if (await git(checkout.root, ["rev-parse", "HEAD"]) !== base.head || await git(checkout.root, ["symbolic-ref", "--short", "HEAD"]) !== base.branch) throw new Error("The checkout's branch or HEAD changed during the save.");
    // --only excludes every other staged file. Git runs the repository's hooks.
    await git(checkout.root, ["commit", "--only", "-m", `docs(resources): update ${base.path}`, "--", base.path]);
    const sha = await git(checkout.root, ["rev-parse", "HEAD"]);
    const parent = await git(checkout.root, ["rev-parse", "HEAD^"]);
    if (parent !== base.head) throw new Error("Git HEAD changed during the resource commit. Inspect the new commit.");
    if (await git(checkout.root, ["diff-tree", "--no-commit-id", "--name-only", "-z", "-r", sha]) !== `${base.path}\0`) throw new Error("A repository hook changed the commit's file set. Inspect the new commit; it was not reported as a successful resource-only commit.");
    return { sha, branch: base.branch };
  } catch (error) {
    throw new ResourceEditorError("commit-failed", `The file was saved, but its Git commit failed. Inspect Git status before retrying. ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

export function resourceLockPath(path: string, checkout?: ResourceCheckout): string {
  return checkout?.gitDir === undefined ? join(dirname(path), ".forgerie-resource-editor.lock") : join(checkout.gitDir, "forgerie-resource-editor.lock");
}
