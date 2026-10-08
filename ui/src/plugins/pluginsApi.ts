import { z } from "zod";
import type { Fetch } from "../newSession";

export const pluginKindSchema = z.enum(["package", "extension", "forgerie", "builtin"]);
export const pluginSchema = z.object({
  id: z.string(), kind: pluginKindSchema, name: z.string(), source: z.string(), description: z.string(),
  enabled: z.boolean(), settings: z.record(z.string(), z.unknown()).optional(),
});
export type ManagedPlugin = z.infer<typeof pluginSchema>;
export const catalogSchema = z.object({
  profileDir: z.string(), configPath: z.string(), revision: z.string(), plugins: z.array(pluginSchema),
  restartRequired: z.boolean(), restartAvailable: z.boolean(),
});
export type PluginCatalog = z.infer<typeof catalogSchema>;
const sourceSchema = z.string().trim().min(1).max(2048).refine((value) => !/[\r\n\0]/u.test(value), "Use one package source.");
export const changeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("add"), source: sourceSchema }),
  z.object({ type: z.literal("toggle"), id: z.string(), enabled: z.boolean() }),
  z.object({ type: z.literal("remove"), id: z.string() }),
  z.object({ type: z.literal("settings"), id: z.string(), settings: z.record(z.string(), z.unknown()) }),
]);
export type PluginChange = z.infer<typeof changeSchema>;
export const mutationSchema = z.object({ revision: z.string().min(1), change: changeSchema });

export function createPluginsApi(fetchFn: Fetch) {
  async function call(path: string, init?: RequestInit): Promise<PluginCatalog> {
    const response = await fetchFn(path, init);
    const body: unknown = await response.json();
    if (!response.ok) {
      const error = z.object({ error: z.string() }).safeParse(body);
      throw new Error(error.success ? error.data.error : `Plugins request failed: HTTP ${String(response.status)}.`);
    }
    return catalogSchema.parse(body);
  }
  const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return {
    list: (signal?: AbortSignal) => call("/aui/plugins", signal ? { signal } : undefined),
    change: (revision: string, change: PluginChange) => call("/aui/plugins", post({ revision, change })),
    restart: (revision: string) => call("/aui/plugins/restart", post({ revision, confirm: true })),
  };
}
export type PluginsApi = ReturnType<typeof createPluginsApi>;
