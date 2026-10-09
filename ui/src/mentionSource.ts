import { z } from "zod";
import type { Unstable_TriggerItem } from "@assistant-ui/react";
import type { Session } from "./contracts";
import { errorSchema, sessionModelSchema } from "./contracts";
import { workspaceOf } from "./workspaceOf";
import { modelPrefsSchema } from "@shared/modelPrefsContract";
import { hiddenModelsLabel, modelMenu, modelOptionGroups } from "./modelChoice";
import type { OptionGroup } from "./ui/OptionList";

/**
 * `#` suggestions: the model menu's groups, and how many matches it leaves out
 * because they are hidden, with the words of the command that shows or hides them.
 */
export interface ModelSuggestions { groups: readonly OptionGroup[]; hidden: number; toggle?: { show: string; hide: string } | undefined }
export interface MentionSource {
  readonly key: string;
  files(query: string, scope: "tracked" | "all", signal: AbortSignal): Promise<readonly Unstable_TriggerItem[]>;
  /** The model menu for `query`, under the lists in Settings. `showHidden` offers models off the shown list too. */
  models(query: string, options: { showHidden: boolean }, signal: AbortSignal): Promise<ModelSuggestions>;
}
export type MentionRequest = (path: string, init: RequestInit) => Promise<Response>;
const filesSchema = z.array(z.object({ path: z.string().min(1), kind: z.enum(["tracked", "untracked", "other"]) }));
// The menu reads context size and reasoning too, so the shared model schema keeps them.
const modelsSchema = z.object({ models: z.array(sessionModelSchema.extend({ provider: z.string().min(1), id: z.string().min(1) })) });
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
    async models(query, { showHidden }, signal) {
      const [{ models }, prefs] = await Promise.all([
        read(modelsPath, modelsSchema, signal), read("/aui/model-prefs", modelPrefsSchema, signal),
      ]);
      const menu = modelMenu(models, query, { prefs, showHidden });
      return { groups: modelOptionGroups(menu.groups), hidden: menu.hidden,
        toggle: menu.hidden > 0 ? { show: hiddenModelsLabel(menu.hidden, false), hide: hiddenModelsLabel(menu.hidden, true) } : undefined };
    },
  };
}
