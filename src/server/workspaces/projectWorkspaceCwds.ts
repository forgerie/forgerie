import { realpath, stat } from "node:fs/promises";
import type { Project, WorkspaceListing } from "../types.js";
import { cwdPathsEqual } from "../workingDirectory.js";

interface ProjectLister {
  list(): Promise<Project[]>;
}

interface WorkspaceLister {
  list(project: Project): Promise<WorkspaceListing[]>;
}

export interface ProjectWorkspaceCwdsDeps {
  projects: ProjectLister;
  workspaces: WorkspaceLister;
}

/**
 * Resolves the set of workspace paths that belong to the same registered project
 * as a given working directory.
 *
 * Sessions spawned by an agent are constrained to workspaces of the spawning
 * session's own project, so this set bounds where related sessions of any cwd
 * can live. Authorization callers must inject fresh workspace discovery so
 * external Git inventory changes take effect on the next check.
 */
export interface ProjectWorkspaceCwds {
  registeredProjects?(): Promise<Pick<Project, "name" | "path">[]>;
  /** One registered root per project, including roots that are currently unavailable. */
  registeredCwds?(): Promise<string[]>;
  /**
   * Workspace paths of the registered project containing `cwd`, or undefined
   * when no registered project contains it. The result includes `cwd` itself.
   */
  forCwd(cwd: string): Promise<string[] | undefined>;
  /** Existing canonical workspace directories, for security-sensitive callers. */
  canonicalForCwd?(cwd: string): Promise<string[] | undefined>;
}

export class RegisteredProjectWorkspaceCwds implements ProjectWorkspaceCwds {
  constructor(private readonly deps: ProjectWorkspaceCwdsDeps) {}

  registeredProjects(): Promise<Project[]> { return this.deps.projects.list(); }

  async registeredCwds(): Promise<string[]> {
    return [...new Set((await this.deps.projects.list()).map((project) => project.path))];
  }

  async canonicalForCwd(cwd: string): Promise<string[] | undefined> {
    for (const project of await this.deps.projects.list()) {
      const paths: string[] = [];
      for (const workspace of await this.deps.workspaces.list(project)) {
        try {
          const path = await realpath(workspace.path);
          if ((await stat(path)).isDirectory()) paths.push(path);
        } catch { /* Missing or inaccessible directories are not eligible workspace destinations. */ }
      }
      if (paths.includes(cwd)) return [...new Set(paths)];
    }
    return undefined;
  }

  async forCwd(cwd: string): Promise<string[] | undefined> {
    const projects = await this.deps.projects.list();
    for (const project of projects) {
      const workspaces = await this.deps.workspaces.list(project);
      const paths = workspaces.map((workspace) => workspace.path);
      if (paths.some((path) => cwdPathsEqual(path, cwd))) return paths;
    }
    return undefined;
  }
}

/** Workspace paths of `cwd`'s project other than `cwd` itself. */
export async function siblingWorkspaceCwds(locator: ProjectWorkspaceCwds, cwd: string): Promise<string[]> {
  const paths = await locator.forCwd(cwd);
  return (paths ?? []).filter((path) => !cwdPathsEqual(path, cwd));
}
