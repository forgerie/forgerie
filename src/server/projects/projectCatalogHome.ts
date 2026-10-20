import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { Project } from "../../shared/apiTypes.js";
import { cwdPathsEqual } from "../workingDirectory.js";
import { pathInside } from "../workspaces/sessionWorktreeStore.js";
import type { WorkspaceService } from "../workspaces/workspaceService.js";

/** Display-only home lookup; authorization uses its separate, uncached workspace discovery. */
export class ProjectCatalogHome {
  constructor(private readonly workspaces: Pick<WorkspaceService, "list">) {}

  async find(cwd: string, projects: Project[]): Promise<Project | undefined> {
    const canonical = await realpath(cwd).catch(() => cwd);
    const inventory = new CatalogInventory();
    const candidates = await Promise.all(projects.map(async (project) => {
      // Keep potential single-directory fallbacks too. A prefix is never sufficient to select a project.
      if (pathInside(project.path, canonical)) return project;
      const roots = await inventory.roots(project.path);
      return roots === undefined || roots.some((root) => pathInside(root, canonical)) ? project : undefined;
    }));
    // Filtering must not change the established longest registered-path order, including stable ties.
    for (const project of candidates.filter((item) => item !== undefined).sort((a, b) => b.path.length - a.path.length)) {
      if ((await this.workspaces.list(project)).some((workspace) => cwdPathsEqual(workspace.path, canonical) || pathInside(workspace.path, canonical))) return project;
    }
    return undefined;
  }
}

type RepositoryLocation = { kind: "repository"; common: string } | { kind: "none" } | { kind: "unknown" };

/** Request-local hints, not membership authority. Unknown metadata always falls back to Git. */
class CatalogInventory {
  private readonly directories = new Map<string, Promise<RepositoryLocation>>();
  private readonly repositories = new Map<string, Promise<string[] | undefined>>();

  async roots(path: string): Promise<string[] | undefined> {
    let canonical: string;
    try { canonical = await realpath(path); } catch { return undefined; }
    const location = await this.repository(canonical);
    if (location.kind === "unknown") return undefined;
    if (location.kind === "none") return [];
    const common = location.common;
    let held = this.repositories.get(common);
    if (held === undefined) {
      held = this.worktreeRoots(common);
      this.repositories.set(common, held);
    }
    return held;
  }

  private repository(path: string): Promise<RepositoryLocation> {
    let held = this.directories.get(path);
    if (held === undefined) {
      held = this.readRepository(path);
      this.directories.set(path, held);
    }
    return held;
  }

  private async readRepository(path: string): Promise<RepositoryLocation> {
    const marker = join(path, ".git");
    try {
      const entry = await lstat(marker);
      let gitdir: string;
      if (entry.isDirectory()) gitdir = marker;
      else if (entry.isFile()) {
        const text = (await readFile(marker, "utf8")).trimEnd();
        if (!text.startsWith("gitdir: ")) return { kind: "unknown" };
        gitdir = resolve(path, text.slice("gitdir: ".length));
      } else return { kind: "unknown" };
      if (await realpath(gitdir) !== gitdir) return { kind: "unknown" };
      let common = gitdir;
      try {
        common = resolve(gitdir, (await readFile(join(gitdir, "commondir"), "utf8")).trimEnd());
        if (await realpath(common) !== common) return { kind: "unknown" };
      } catch (error) { if (!missing(error)) return { kind: "unknown" }; }
      // Other layouts (bare, separate-git-dir, submodules, incomplete metadata) stay on the old path.
      if (basename(common) !== ".git" || !(await stat(join(gitdir, "HEAD"))).isFile()
        || !(await stat(join(common, "objects"))).isDirectory() || !(await stat(join(common, "refs"))).isDirectory()) return { kind: "unknown" };
      return { kind: "repository", common };
    } catch (error) {
      if (!missing(error)) return { kind: "unknown" };
      // Only an absent marker permits searching a parent. A broken gitdir pointer is uncertain.
      try { await stat(marker); return { kind: "unknown" }; } catch (markerError) { if (!missing(markerError)) return { kind: "unknown" }; }
      const parent = dirname(path);
      return parent === path ? { kind: "none" } : this.repository(parent);
    }
  }

  private async worktreeRoots(common: string): Promise<string[] | undefined> {
    try {
      let names: string[];
      try { names = await readdir(join(common, "worktrees")); }
      catch (error) { if (missing(error)) return [dirname(common)]; throw error; }
      const roots = await Promise.all(names.map(async (name) => {
        const gitdir = (await readFile(join(common, "worktrees", name, "gitdir"), "utf8")).trimEnd();
        if (!isAbsolute(gitdir)) return undefined;
        const root = dirname(gitdir);
        // Git/path aliases differ across layouts. Extra candidates are safe; excluding one is not.
        return [root, await realpath(root).catch(() => root)];
      }));
      // Git's forward registrations matter even if a checkout's own .git file changed independently.
      if (roots.some((root) => root === undefined)) return undefined;
      return [dirname(common), ...roots.filter((root) => root !== undefined).flat()];
    } catch { return undefined; }
  }
}

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
