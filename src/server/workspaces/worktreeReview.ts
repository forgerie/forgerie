import type { BrowserFileAccess } from "../browserFileAccess.js";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sanitizedGitEnv } from "../git/gitEnv.js";
import type { WorktreeReview } from "../../shared/sessionWorktree.js";

const execute = promisify(execFile);
const MAX_DIFF = 512 * 1024;

/** Read an owned checkout only. Separate snapshots avoid hiding staged changes behind an unstaged reversal. */
export async function readWorktreeReview(path: string, base: string, browserFiles?: BrowserFileAccess): Promise<WorktreeReview> {
  async function git(args: string[]): Promise<string> {
    const { stdout } = await execute("git", args, { cwd: path, env: sanitizedGitEnv(), maxBuffer: 4 * 1024 * 1024 });
    return stdout;
  }
  async function patch(label: string, args: string[]) {
    if (browserFiles !== undefined) {
      const changed = (await git(["diff", "--name-only", "-z", ...args])).split("\0").filter(Boolean);
      const readable = (await Promise.all(changed.map(async file => ({ file, readable: await browserFiles.isReadable(join(path, file)) })))).filter(row => row.readable).map(row => row.file);
      if (readable.length === 0) return { label, diff: "", truncated: false };
      args.push("--", ...readable.map(file => `:(literal)${file}`));
    }
    const diff = await git(["diff", "--no-ext-diff", "--no-textconv", "--color=never", ...args]);
    return { label, diff: diff.slice(0, MAX_DIFF), truncated: diff.length > MAX_DIFF };
  }
  const head = (await git(["rev-parse", "HEAD"])).trim();
  const sections = await Promise.all([
    patch("Committed changes", [`${base}...${head}`]),
    patch("Staged changes", ["--cached"]),
    patch("Unstaged changes", []),
  ]);
  const gathered = (await git(["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean);
  const untracked = (await Promise.all(gathered.map(async file => ({ file, readable: await browserFiles?.isReadable(join(path, file)) ?? true })))).filter(row => row.readable).map(row => row.file);
  // Untracked paths are listed, not opened: a symlink can point outside this checkout.
  return { head, sections, untracked };
}
