import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sanitizedGitEnv } from "../git/gitEnv.js";
import type { WorktreeReview } from "../../shared/sessionWorktree.js";

const execute = promisify(execFile);
const MAX_DIFF = 512 * 1024;

/** Read an owned checkout only. Separate snapshots avoid hiding staged changes behind an unstaged reversal. */
export async function readWorktreeReview(path: string, base: string): Promise<WorktreeReview> {
  async function git(args: string[]): Promise<string> {
    const { stdout } = await execute("git", args, { cwd: path, env: sanitizedGitEnv(), maxBuffer: 4 * 1024 * 1024 });
    return stdout;
  }
  async function patch(label: string, args: string[]) {
    const diff = await git(["diff", "--no-ext-diff", "--no-textconv", "--color=never", ...args]);
    return { label, diff: diff.slice(0, MAX_DIFF), truncated: diff.length > MAX_DIFF };
  }
  const head = (await git(["rev-parse", "HEAD"])).trim();
  const sections = await Promise.all([
    patch("Committed changes", [`${base}...${head}`]),
    patch("Staged changes", ["--cached"]),
    patch("Unstaged changes", []),
  ]);
  const untracked = (await git(["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean);
  // Untracked paths are listed, not opened: a symlink can point outside this checkout.
  return { head, sections, untracked };
}
