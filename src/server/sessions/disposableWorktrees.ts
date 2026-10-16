import { copyFile, lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";

/** Agents make throwaway clones and worktrees here. A fixed path, so a changed TMPDIR cannot widen the exemption. */
export const SCRATCH_ROOT = "/tmp";
/** Project folders that hold agent worktrees, beside the main checkout. */
const PROJECT_WORKTREE_FOLDERS = new Set([".worktree", ".worktrees"]);
/** Forgerie's own session (`s-<8 hex>`) and child (`c-<64 hex>`) worktrees belong to other chats; never treat them as disposable here. */
const MANAGED_WORKTREE = /^(?:s-[0-9a-f]{8}|c-[0-9a-f]{64})$/u;
/** A backup larger than this fails, and the action then waits for the user. */
const BACKUP_LIMIT_BYTES = 200 * 1024 * 1024;

export interface ProjectWorktreeBackup {
  /** Runs read-only Git commands. */
  git(cwd: string, args: readonly string[]): Promise<string>;
  /** Backups go in a new folder below this one. */
  directory: string;
  now(): Date;
}

export interface DisposableWorktreeSources {
  /** The directory that holds throwaway clones and worktrees. */
  scratchRoot: string;
  /** Paths of the session's active child worktrees. */
  childWorktrees(): Promise<readonly string[]>;
  /** Omitted: project worktrees are not disposable. */
  projectBackup?: ProjectWorktreeBackup;
}

/**
 * A worktree root is disposable when its real path is strictly inside the scratch root, or is one of the session's child worktrees.
 * A linked worktree in the project's `.worktree/` or `.worktrees/` folder is disposable after its uncommitted work is backed up.
 * This check has that one effect: it writes the backup before it answers true. Real paths make symlinks count as their target.
 * Any failure answers false, so the action waits for the user.
 */
export function disposableWorktree(sources: DisposableWorktreeSources): (worktreeRoot: string) => Promise<boolean> {
  return async (worktreeRoot) => {
    try {
      const target = await realpath(worktreeRoot);
      const fromScratch = relative(await realpath(sources.scratchRoot), target);
      if (fromScratch !== "" && !isAbsolute(fromScratch) && fromScratch.split(sep)[0] !== "..") return true;
      for (const path of await sources.childWorktrees()) {
        if (await realpath(path).catch(() => undefined) === target) return true;
      }
      const backup = sources.projectBackup;
      if (backup === undefined || !(await isProjectWorktree(target, (cwd, args) => backup.git(cwd, args)))) return false;
      await backUpWorktree(target, backup);
      return true;
    } catch { return false; }
  };
}

async function isProjectWorktree(target: string, git: ProjectWorktreeBackup["git"]): Promise<boolean> {
  if (MANAGED_WORKTREE.test(basename(target)) || !PROJECT_WORKTREE_FOLDERS.has(basename(dirname(target)))) return false;
  const top = await realpath((await git(target, ["rev-parse", "--show-toplevel"])).trim());
  if (top !== target) return false;
  const common = await realpath((await git(target, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim());
  const gitDir = await realpath((await git(target, ["rev-parse", "--path-format=absolute", "--git-dir"])).trim());
  // A linked worktree has its own Git folder. Its folder's parent must be the main checkout that owns the repository.
  return gitDir !== common && basename(common) === ".git" && dirname(common) === dirname(dirname(target));
}

/** Writes HEAD, status, a binary diff of tracked changes and copies of untracked files. Ignored files are not kept. */
async function backUpWorktree(target: string, backup: ProjectWorktreeBackup): Promise<void> {
  const stamp = backup.now().toISOString().replace(/[:.]/gu, "-");
  const folder = join(backup.directory, `${basename(target)}-${stamp}`);
  const untracked = (await backup.git(target, ["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter(path => path !== "");
  let bytes = 0;
  for (const path of untracked) bytes += (await lstat(join(target, path))).size;
  if (bytes > BACKUP_LIMIT_BYTES) throw new Error("Worktree backup is too large");
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "worktree.json"), `${JSON.stringify({
    path: target,
    head: (await backup.git(target, ["rev-parse", "HEAD"])).trim(),
    branch: (await backup.git(target, ["branch", "--show-current"])).trim(),
    at: backup.now().toISOString(),
  }, null, 2)}\n`);
  await writeFile(join(folder, "status.txt"), await backup.git(target, ["status", "--porcelain=v1"]));
  await writeFile(join(folder, "tracked.patch"), await backup.git(target, ["diff", "--binary", "HEAD"]));
  for (const path of untracked) {
    const destination = join(folder, "untracked", path);
    await mkdir(dirname(destination), { recursive: true });
    if ((await lstat(join(target, path))).isFile()) await copyFile(join(target, path), destination);
  }
}
