import { z } from "zod";
import { projectSchema, type Fetch } from "../newSession";
import { createWorktreeApi, worktreeInfoSchema, worktreeRecordSchema } from "../worktrees/worktreeApi";
const groupSchema = z.object({ id: z.string(), name: z.string(), projectIds: z.array(z.string()), revision: z.number().int(), createdAt: z.string(), updatedAt: z.string() });
export type ProjectGroup = z.infer<typeof groupSchema>;
const catalogSchema = z.object({ groups: z.array(groupSchema), projects: z.array(projectSchema) });
export type GroupCatalog = z.infer<typeof catalogSchema>;
const contextSchema = catalogSchema.extend({ home: projectSchema.optional(), related: z.array(worktreeInfoSchema) });
export type ProjectContext = z.infer<typeof contextSchema>;
/** A refused request, with the server's machine-readable reason when it sent one. */
export class ApiError extends Error {
  constructor(message: string, readonly code?: string) { super(message); this.name = "ApiError"; }
}
/** The server refused a project folder because it does not exist. */
export const isMissingFolder = (cause: unknown) => cause instanceof ApiError && cause.code === "missing-folder";
const refusalSchema = z.object({ error: z.string(), code: z.string().optional() });
export function createProjectGroupApi(request: Fetch) {
  async function call<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
    const response = await request(url, { ...init, signal: AbortSignal.timeout(60_000) });
    const body: unknown = await response.json();
    if (!response.ok) {
      const refusal = refusalSchema.safeParse(body).data;
      throw new ApiError(refusal?.error ?? `Request failed: ${response.status}`, refusal?.code);
    }
    return schema.parse(body);
  }
  const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return {
    list: () => call("/api/project-groups", catalogSchema),
    /** `create` makes the folder first when it does not exist. */
    register: (path: string, create = false) => call("/api/projects", projectSchema, json("POST", create ? { path, create } : { path })),
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
