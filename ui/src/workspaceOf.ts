import { z } from "zod";

const projectsSchema = z.array(z.object({ id: z.string().min(1), path: z.string().min(1) }));
const workspacesSchema = z.array(z.object({ id: z.string().min(1), projectId: z.string().min(1), path: z.string().min(1) }));
export type Read = <T>(path: string, schema: z.ZodType<T>, signal: AbortSignal) => Promise<T>;
export interface WorkspaceRef { projectId: string; workspaceId: string }

const normalize = (path: string) => path.replace(/\/+$/u, "") || "/";
const contains = (root: string, path: string) => path === root || path.startsWith(root === "/" ? "/" : `${root}/`);

/**
 * The registered workspace for a folder. Per-folder reads (files, skills,
 * prompt templates) go through it, never the server process's own folder.
 */
export async function workspaceOf(cwd: string, read: Read, signal: AbortSignal): Promise<WorkspaceRef> {
  const target = normalize(cwd);
  const projects = await read("/api/projects", projectsSchema, signal);
  // Common case first. Registered worktrees can live outside the project's root,
  // so fall back to other projects before reporting an unregistered workspace.
  projects.sort((a, b) => Number(contains(normalize(b.path), target)) - Number(contains(normalize(a.path), target))
    || b.path.length - a.path.length);
  for (const project of projects) {
    const workspaces = await read(`/api/projects/${encodeURIComponent(project.id)}/workspaces`, workspacesSchema, signal);
    const found = workspaces.find((item) => normalize(item.path) === target);
    if (found) { signal.throwIfAborted(); return { projectId: found.projectId, workspaceId: found.id }; }
  }
  throw new Error("This folder is not a registered workspace, so its files and commands cannot be listed.");
}
