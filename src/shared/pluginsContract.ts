import { z } from "zod";
import { appSettingDefSchema } from "./appPlugins.js";

/**
 * `app`: a plugin bundled with this app (`appPlugins.ts`). Its changes need no restart.
 */
export const pluginKindSchema = z.enum(["package", "extension", "app", "builtin"]);
export const pluginSchema = z.object({
  id: z.string(), kind: pluginKindSchema, name: z.string(), source: z.string(),
  /** What the plugin does, in its author's words. Empty when it does not say. */
  description: z.string(),
  enabled: z.boolean(), settings: z.record(z.string(), z.unknown()).optional(),
  /** App plugins only: the settings the plugin declares, in the order Settings shows them. */
  fields: z.array(appSettingDefSchema).optional(),
  /** Pi packages only, from the installed package.json. */
  version: z.string().optional(),
  /** Pi packages only: false when the source is configured but nothing is on disk. */
  installed: z.boolean().optional(),
  /** Pi packages only: the entry loads only some of the package's resources. */
  filtered: z.boolean().optional(),
});
export type ManagedPlugin = z.infer<typeof pluginSchema>;
export const catalogSchema = z.object({
  profileDir: z.string(), configPath: z.string(), home: z.string(), revision: z.string(), plugins: z.array(pluginSchema),
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
