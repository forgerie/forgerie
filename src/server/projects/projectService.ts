import { mkdir, realpath, stat } from "node:fs/promises";
import type { ProjectStore } from "../storage/projectStore.js";
import type { Project } from "../types.js";
import { expandUserPath } from "./directorySuggestions.js";

/** The requested project folder does not exist. The caller may offer to create it. */
export class MissingFolderError extends Error {
  readonly code = "missing-folder";
  constructor(readonly path: string) {
    super(`No folder at ${path}`);
    this.name = "MissingFolderError";
  }
}

const isMissing = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT";

export class ProjectService {
  constructor(private readonly store: ProjectStore) {}

  list(): Promise<Project[]> {
    return this.store.list();
  }

  async add(input: { name?: string; path: string; create?: boolean }): Promise<Project> {
    const requestedPath = expandUserPath(input.path);
    if (input.create === true) await mkdir(requestedPath, { recursive: true });
    const resolved = await realpath(requestedPath).catch((error: unknown) => {
      throw isMissing(error) ? new MissingFolderError(requestedPath) : error;
    });
    const s = await stat(resolved);
    if (!s.isDirectory()) throw new Error("Project path must be a directory");
    return this.store.add(input.name === undefined ? { path: resolved } : { name: input.name, path: resolved });
  }

  async close(id: string): Promise<void> {
    if (!(await this.store.remove(id))) throw new Error("Project not found");
  }

  async requireProject(id: string): Promise<Project> {
    const project = await this.store.get(id);
    if (!project) throw new Error("Project not found");
    return project;
  }
}
