import { realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";

/** Agents make throwaway clones and worktrees here. A fixed path, so a changed TMPDIR cannot widen the exemption. */
export const SCRATCH_ROOT = "/tmp";

export interface DisposableWorktreeSources {
  /** The directory that holds throwaway clones and worktrees. */
  scratchRoot: string;
  /** Paths of the session's active child worktrees. */
  childWorktrees(): Promise<readonly string[]>;
}

/**
 * A worktree root is disposable when its real path is strictly inside the scratch root, or is one of the session's child worktrees.
 * Real paths make symlinks into the scratch root count as their target. Any failure answers false.
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
      return false;
    } catch { return false; }
  };
}
