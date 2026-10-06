import { z } from "zod";
import type { Unstable_TriggerItem } from "@assistant-ui/react";
import type { Session } from "./contracts";
import { errorSchema } from "./contracts";
import { workspaceOf } from "./workspaceOf";

export interface MentionSource {
  readonly key: string;
  files(query: string, scope: "tracked" | "all", signal: AbortSignal): Promise<readonly Unstable_TriggerItem[]>;
  models(query: string, signal: AbortSignal): Promise<readonly Unstable_TriggerItem[]>;
}
export type MentionRequest = (path: string, init: RequestInit) => Promise<Response>;
const filesSchema = z.array(z.object({ path: z.string().min(1), kind: z.enum(["tracked", "untracked", "other"]) }));
const modelsSchema = z.object({ models: z.array(z.object({ provider: z.string().min(1), id: z.string().min(1), name: z.string().optional() })) });
const LIMIT = 12;

/**
 * Lazy discovery. Every request uses the selected session/workspace, never the server process cwd.
 * `modelsPath` reads `#` model suggestions; a session that does not exist yet reads its folder's.
 */
export function createMentionSource(session: Session, request: MentionRequest,
  modelsPath = `/api/sessions/${encodeURIComponent(session.id)}/models?${new URLSearchParams({ cwd: session.cwd })}`): MentionSource {
  let destination: { projectId: string; workspaceId: string } | undefined;
  async function read<T>(path: string, schema: z.ZodType<T>, signal: AbortSignal): Promise<T> {
    const response = await request(path, { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), cache: "no-store" });
    if (!response.ok) {
      const error = errorSchema.safeParse(await response.json().catch(() => undefined));
      throw new Error(error.success ? error.data.error : `Request failed: HTTP ${response.status}`);
    }
    return schema.parse(await response.json());
  }
  async function workspace(signal: AbortSignal) {
    destination ??= await workspaceOf(session.cwd, read, signal).catch(() => {
      throw new Error("File suggestions need a registered workspace for this session.");
    });
    return destination;
  }
  return {
    key: JSON.stringify([session.id, session.cwd]),
    async files(query, scope, signal) {
      const target = await workspace(signal);
      const params = new URLSearchParams({ q: query, scope });
      const files = await read(`/api/projects/${encodeURIComponent(target.projectId)}/workspaces/${encodeURIComponent(target.workspaceId)}/files?${params}`, filesSchema, signal);
      return files.slice(0, LIMIT).map((file) => ({ id: file.path, type: "file", label: file.path, description: file.kind }));
    },
    async models(query, signal) {
      const { models } = await read(modelsPath, modelsSchema, signal);
      const needle = query.toLowerCase();
      return models.filter((model) => `${model.provider}/${model.id}`.toLowerCase().includes(needle)
        || model.name?.toLowerCase().includes(needle)).slice(0, LIMIT)
        .map((model) => ({ id: `${model.provider}/${model.id}`, type: "model", label: `${model.provider}/${model.id}`,
          ...(model.name && model.name !== model.id ? { description: model.name } : {}) }));
    },
  };
}
