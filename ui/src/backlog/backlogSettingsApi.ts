import { Check } from "typebox/value";
import { BacklogSettingsResponseSchema, type BacklogSettingsResponse } from "@shared/backlogSettings";
import type { BacklogConfig } from "@shared/backlog";
import type { BacklogSourceInput } from "@shared/backlogSources";
import { projectSchema, type Fetch } from "../newSession";
import { z } from "zod";
import { modelsResponseSchema, type SessionModel } from "../contracts";
import { suggestionModelSchema, type SuggestionModel } from "./suggestions/suggestionsApi";

/** The global default model for suggestions, from a settings response. The shared schema gains it on the server's side. */
export const suggestionsDefaultOf = (settings: BacklogSettingsResponse): SuggestionModel | undefined =>
  suggestionModelSchema.optional().catch(undefined).parse((settings as { suggestionsDefault?: unknown }).suggestionsDefault);
/** A project's own model for suggestions, from its backlog settings. */
export const projectSuggestionsOf = (backlog: BacklogConfig): SuggestionModel | undefined =>
  suggestionModelSchema.optional().catch(undefined).parse((backlog as { suggestions?: unknown }).suggestions);
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
    /** The model a suggestion's File and act starts on when its project sets none. Null: the chat's own model. */
    suggestionsDefault: (suggestionsDefault: SuggestionModel | null) => call("/api/backlog/settings/suggestions-default", json("PUT", { suggestionsDefault })),
    /** The models a session in `cwd` may use, for the model fields. */
    models: async (cwd: string, signal?: AbortSignal): Promise<SessionModel[]> => modelsResponseSchema.parse(await call(`/api/models?${new URLSearchParams({ cwd }).toString()}`,
      signal ? { signal } : undefined)).models,
    /** A new Azure DevOps source. The server refuses one that overlaps another source's board (409). */
    createSource: (input: BacklogSourceInput) => call("/api/backlog/settings/sources", json("POST", input)),
    saveSource: (id: string, input: BacklogSourceInput, baseRevision: number) => call(`/api/backlog/settings/sources/${encodeURIComponent(id)}`, json("PUT", { ...input, baseRevision })),
    /** Live claims on the source's items stay, and can still be released from the backlog. */
    removeSource: (id: string, baseRevision: number) => call(`/api/backlog/settings/sources/${encodeURIComponent(id)}`, json("DELETE", { baseRevision })),
  };
}
export type BacklogSettingsApi = ReturnType<typeof createBacklogSettingsApi>;
