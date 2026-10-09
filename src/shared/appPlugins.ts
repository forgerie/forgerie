import { z } from "zod";

/**
 * Plugins bundled with the browser app.
 *
 * A plugin declares who it is and what it can be set to here, as plain data,
 * so Forgerie's server can list it, validate its settings, and store them, and
 * Settings > Plugins can draw a form for it. Its interface lives in the browser
 * app (`ui/src/plugins/`), which registers it against the same id.
 *
 * Values are stored in Forgerie's config at `plugins[id]`, the same place the
 * original client's browser plugins used, so a plugin ported from that client
 * keeps the choices already saved under its id.
 */
const defBase = { id: z.string(), label: z.string(), description: z.string() };
/** One setting a plugin declares. The server sends these with the plugin catalog, so Settings draws the form without importing plugins. */
export const appSettingDefSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("boolean"), ...defBase, default: z.boolean() }),
  /** An http or https address. */
  z.object({ type: z.literal("url"), ...defBase, default: z.string() }),
]);
export type AppSettingDef = z.infer<typeof appSettingDefSchema>;
export type AppSettingValue = boolean | string;
export type AppSettings = Readonly<Record<string, AppSettingValue>>;
export interface AppPluginManifest {
  id: string;
  name: string;
  /** What the plugin does, in a sentence, for Settings > Plugins. */
  description: string;
  settings: readonly AppSettingDef[];
}

/** One plugin's state, as the browser app needs it to render: on or off, and every setting resolved. */
export const appPluginStatesSchema = z.object({
  plugins: z.array(z.object({ id: z.string(), enabled: z.boolean(), settings: z.record(z.string(), z.union([z.boolean(), z.string()])) })),
});
export type AppPluginStates = z.infer<typeof appPluginStatesSchema>;

export class AppSettingsError extends Error {}

const MAX_URL_LENGTH = 2048;
function isWebAddress(value: string): boolean {
  if (value.length > MAX_URL_LENGTH) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch { return false; }
}
function validValue(def: AppSettingDef, value: unknown): value is AppSettingValue {
  return def.type === "boolean" ? typeof value === "boolean" : typeof value === "string" && isWebAddress(value);
}

/**
 * Every setting the plugin declares, with its stored value where that value is
 * valid and its default otherwise. Keys the plugin does not declare are dropped.
 */
export function resolveAppSettings(manifest: AppPluginManifest, stored: Readonly<Record<string, unknown>> | undefined): AppSettings {
  return Object.fromEntries(manifest.settings.map((def) => {
    const value = stored?.[def.id];
    return [def.id, validValue(def, value) ? value : def.default];
  }));
}

/**
 * The values to store for a settings save: only those that differ from their
 * default, so a default Forgerie changes later reaches everyone who never
 * chose otherwise. Throws AppSettingsError for a key the plugin does not
 * declare or a value of the wrong kind; nothing is stored then.
 */
export function storedAppSettings(manifest: AppPluginManifest, input: Readonly<Record<string, unknown>>): Record<string, AppSettingValue> {
  const stored: Record<string, AppSettingValue> = {};
  for (const [key, value] of Object.entries(input)) {
    const def = manifest.settings.find((candidate) => candidate.id === key);
    if (def === undefined) throw new AppSettingsError(`${manifest.name} has no setting "${key}".`);
    if (!validValue(def, value)) {
      throw new AppSettingsError(def.type === "boolean" ? `${def.label} must be on or off.` : `${def.label} must be an http or https address.`);
    }
    if (value !== def.default) stored[key] = value;
  }
  return stored;
}
