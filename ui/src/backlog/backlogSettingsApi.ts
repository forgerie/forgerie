import { Check } from "typebox/value";
import { BacklogSettingsResponseSchema, type BacklogSettingsResponse } from "@shared/backlogSettings";
import type { BacklogConfig } from "@shared/backlog";
import { projectSchema, type Fetch } from "../newSession";
import { z } from "zod";
export interface BacklogSettingsCatalog { settings: BacklogSettingsResponse; projects: z.infer<typeof projectSchema>[] }
export class BacklogSettingsRefusal extends Error { constructor(message: string, readonly status: number) { super(message); } }
export function createBacklogSettingsApi(fetchFn: Fetch) {
  async function call(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetchFn(path, init); const value: unknown = await response.json();
    if (!response.ok) throw new BacklogSettingsRefusal(z.object({ error: z.string() }).safeParse(value).data?.error ?? `HTTP ${String(response.status)}`, response.status);
    return value;
  }
  const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return {
    list: async (): Promise<BacklogSettingsCatalog> => {
      const [settings, projects] = await Promise.all([call("/api/backlog/settings"), call("/api/projects")]);
      if (!Check(BacklogSettingsResponseSchema, settings)) throw new Error("Invalid backlog settings response.");
      return { settings, projects: z.array(projectSchema).parse(projects) };
    },
    save: (projectId: string, backlog: BacklogConfig, baseRevision: number) => call(`/api/backlog/settings/projects/${encodeURIComponent(projectId)}`, json("PUT", { backlog, baseRevision })),
    remove: (projectId: string, baseRevision: number) => call(`/api/backlog/settings/projects/${encodeURIComponent(projectId)}`, json("DELETE", { baseRevision })),
    githubLogin: (githubLogin: string | null) => call("/api/backlog/settings/github-login", json("PUT", { githubLogin })),
  };
}
export type BacklogSettingsApi = ReturnType<typeof createBacklogSettingsApi>;
