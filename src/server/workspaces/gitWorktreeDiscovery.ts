import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sanitizedGitEnv } from "../git/gitEnv.js";

const execFileAsync = promisify(execFile);

export interface GitWorktreeInfo {
  path: string;
  branch?: string;
  bare?: boolean;
  detached?: boolean;
  /** Git reports a linked worktree as prunable when its checkout directory no longer exists. */
  prunable?: boolean;
}

export async function isGitRepository(path: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", path, "rev-parse", "--is-inside-work-tree"], { env: sanitizedGitEnv() });
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

export async function discoverGitWorktrees(path: string): Promise<GitWorktreeInfo[]> {
  const { stdout } = await execFileAsync("git", ["-C", path, "worktree", "list", "--porcelain"], { env: sanitizedGitEnv() });
  return parseGitWorktreeList(stdout);
}

export interface GitWorktreeDiscoveryOptions {
  now?: () => number;
  /** Default 0: read Git on every call. Sessiond enables a short window for project views. */
  cacheMs?: number;
}

interface GitWorktreeRunner {
  isGitRepository(path: string): Promise<boolean>;
  discoverGitWorktrees(path: string): Promise<GitWorktreeInfo[]>;
}

interface DiscoveryEntry<T> { at: number; value: Promise<T> }

/** Git facts for read-only workspace discovery; lifecycle ownership checks use fresh reads. */
export class GitWorktreeDiscovery {
  private readonly repositories = new Map<string, DiscoveryEntry<boolean>>();
  private readonly worktrees = new Map<string, DiscoveryEntry<GitWorktreeInfo[]>>();
  private readonly now: () => number;
  constructor(private readonly git: GitWorktreeRunner = { isGitRepository, discoverGitWorktrees }, private readonly settings: GitWorktreeDiscoveryOptions = {}) {
    this.now = settings.now ?? Date.now;
  }

  isGitRepository(path: string): Promise<boolean> {
    return this.read(this.repositories, path, () => this.git.isGitRepository(path));
  }
  discoverGitWorktrees(path: string): Promise<GitWorktreeInfo[]> {
    return this.read(this.worktrees, path, () => this.git.discoverGitWorktrees(path));
  }
  invalidate(): void {
    // A repo can be registered through its main path, a linked path, or a symlink. Clear all
    // project discovery entries rather than run more Git children to resolve those aliases.
    this.repositories.clear();
    this.worktrees.clear();
  }

  private read<T>(cache: Map<string, DiscoveryEntry<T>>, path: string, read: () => Promise<T>): Promise<T> {
    const window = this.settings.cacheMs ?? 0;
    if (window <= 0) return read();
    const held = cache.get(path);
    if (held !== undefined && this.now() - held.at < window) return held.value;
    const value = read();
    // A pending read is shared even when Git takes longer than the cache window.
    const entry = { at: Infinity, value };
    cache.set(path, entry);
    void value.then(() => { entry.at = this.now(); }, () => {
      if (cache.get(path) === entry) cache.delete(path);
    });
    return value;
  }
}

/**
 * Parses `git worktree list --porcelain` output into facts only. Deciding which worktrees a
 * project should show (for example hiding prunable ones) is workspace policy, not parsing.
 */
export function parseGitWorktreeList(stdout: string): GitWorktreeInfo[] {
  const chunks = stdout.trim().split(/\n\s*\n/).filter(Boolean);

  return chunks.map((chunk) => {
    const info: GitWorktreeInfo = { path: "" };
    for (const line of chunk.split("\n")) {
      const [key, ...rest] = line.split(" ");
      const value = rest.join(" ");
      if (key === "worktree") info.path = value;
      if (key === "branch") info.branch = value.replace(/^refs\/heads\//, "");
      if (key === "bare") info.bare = true;
      if (key === "detached") info.detached = true;
      if (key === "prunable") info.prunable = true;
    }
    return info;
  }).filter((w) => w.path);
}
