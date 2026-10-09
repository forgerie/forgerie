import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { ProjectGroupInputSchema, ProjectGroupSchema, type ProjectGroup, type ProjectGroupInput } from "../../shared/projectGroups.js";
import type { ProjectService } from "./projectService.js";

const FileSchema = Type.Object({ version: Type.Literal(1), groups: Type.Array(ProjectGroupSchema) }, { additionalProperties: false });
export class GroupConflict extends Error {}
/** Sessiond is the sole writer. Reads always see a complete persisted snapshot. */
export class ProjectGroups {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly path: string, private readonly projects: Pick<ProjectService, "list">) {}
  async list(): Promise<ProjectGroup[]> {
    let source: string;
    try { source = await readFile(this.path, "utf8"); }
    catch (error) { if (missing(error)) return []; throw error; }
    const value: unknown = JSON.parse(source);
    if (!Check(FileSchema, value)) throw new Error("Invalid project group file; it has not been overwritten.");
    return value.groups;
  }
  save(input: ProjectGroupInput, existing?: { id: string; revision: number }): Promise<ProjectGroup> {
    return this.exclusive(async () => {
      if (!Check(ProjectGroupInputSchema, input) || !input.name.trim()) throw new Error("A group needs a name and distinct project IDs.");
      const groups = await this.list();
      const previous = existing === undefined ? undefined : groups.find((group) => group.id === existing.id);
      if (existing !== undefined && previous?.revision !== existing.revision) throw new GroupConflict("The group changed. Reload before saving.");
      const known = new Set((await this.projects.list()).map((project) => project.id));
      // Unavailable members survive edits, but new unknown references cannot be added.
      if (input.projectIds.some((id) => !known.has(id) && previous?.projectIds.includes(id) !== true)) throw new Error("Unknown project in group.");
      const now = new Date().toISOString();
      const group: ProjectGroup = { id: previous?.id ?? randomUUID(), name: input.name.trim(), projectIds: input.projectIds,
        revision: (previous?.revision ?? 0) + 1, createdAt: previous?.createdAt ?? now, updatedAt: now };
      await this.persist([...groups.filter((item) => item.id !== group.id), group]);
      return group;
    });
  }
  remove(id: string, revision: number): Promise<void> {
    return this.exclusive(async () => {
      const groups = await this.list();
      if (groups.find((group) => group.id === id)?.revision !== revision) throw new GroupConflict("The group changed. Reload before deleting.");
      await this.persist(groups.filter((group) => group.id !== id));
    });
  }
  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action);
    this.queue = result.catch(() => undefined);
    return result;
  }
  private async persist(groups: ProjectGroup[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${randomUUID()}.tmp`;
    try { await writeFile(temp, JSON.stringify({ version: 1, groups }), { mode: 0o600 }); await rename(temp, this.path); }
    finally { await unlink(temp).catch((error: unknown) => { if (!missing(error)) throw error; }); }
  }
}
function missing(error: unknown): boolean { return error instanceof Error && "code" in error && error.code === "ENOENT"; }
