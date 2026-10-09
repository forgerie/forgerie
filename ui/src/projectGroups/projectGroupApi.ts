import { z } from "zod";
import { projectSchema, type Fetch } from "../newSession";
import { createWorktreeApi, worktreeInfoSchema, worktreeRecordSchema } from "../worktrees/worktreeApi";
const groupSchema = z.object({ id: z.string(), name: z.string(), projectIds: z.array(z.string()), revision: z.number().int(), createdAt: z.string(), updatedAt: z.string() });
export type ProjectGroup = z.infer<typeof groupSchema>;
const catalogSchema = z.object({ groups: z.array(groupSchema), projects: z.array(projectSchema) });
export type GroupCatalog = z.infer<typeof catalogSchema>;
const contextSchema = catalogSchema.extend({ home: projectSchema.optional(), related: z.array(worktreeInfoSchema) });
export type ProjectContext = z.infer<typeof contextSchema>;
export function createProjectGroupApi(request: Fetch) {
  async function call<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
    const response = await request(url, { ...init, signal: AbortSignal.timeout(60_000) });
    const body: unknown = await response.json();
    if (!response.ok) throw new Error(z.object({ error: z.string() }).safeParse(body).data?.error ?? `Request failed: ${response.status}`);
    return schema.parse(body);
  }
  const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return {
    list: () => call("/api/project-groups", catalogSchema),
    register: (path: string) => call("/api/projects", projectSchema, json("POST", { path })),
    allWorkspaces: () => call("/api/project-workspaces/all", z.object({ related: z.array(worktreeInfoSchema) })),
    worktrees: createWorktreeApi(request),
    save: (name: string, projectIds: string[], group?: ProjectGroup) => call(`/api/project-groups${group ? `/${encodeURIComponent(group.id)}` : ""}`, groupSchema,
      json(group ? "PUT" : "POST", { name, projectIds, ...(group ? { revision: group.revision } : {}) })),
    remove: (group: ProjectGroup) => call(`/api/project-groups/${encodeURIComponent(group.id)}?revision=${group.revision}`, z.object({ removed: z.boolean() }), { method: "DELETE" }),
    context: (ref: { id: string; cwd: string }) => call(`/api/project-workspaces?${new URLSearchParams(ref)}`, contextSchema),
    prepare: (ref: { id: string; cwd: string }, projectId: string, requestId: string) => call("/api/project-workspaces", worktreeRecordSchema, json("POST", { ...ref, projectId, requestId })),
  };
}
export type ProjectGroupApi = ReturnType<typeof createProjectGroupApi>;
