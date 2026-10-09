import { z } from "zod";
import { appPluginStatesSchema, type AppSettings } from "@shared/appPlugins";
import type { PluginCatalog } from "@shared/pluginsContract";
import type { Fetch } from "../newSession";

export interface AppPluginState { enabled: boolean; settings: AppSettings }
/** Keyed by plugin id, without the catalog's `app:` prefix. */
export type AppPluginStateMap = ReadonlyMap<string, AppPluginState>;

export function createAppPluginStatesApi(fetchFn: Fetch) {
  return {
    async read(signal?: AbortSignal): Promise<AppPluginStateMap> {
      const response = await fetchFn("/aui/app-plugins", signal ? { signal } : undefined);
      const body: unknown = await response.json();
      if (!response.ok) {
        const error = z.object({ error: z.string() }).safeParse(body);
        throw new Error(error.success ? error.data.error : `Plugin states request failed: HTTP ${String(response.status)}.`);
      }
      return new Map(appPluginStatesSchema.parse(body).plugins.map((plugin) => [plugin.id, { enabled: plugin.enabled, settings: plugin.settings }]));
    },
  };
}
export type AppPluginStatesApi = ReturnType<typeof createAppPluginStatesApi>;

/** The bundled plugins' states inside a plugin catalog, which Settings > Plugins reads after every change. */
export function statesFromCatalog(catalog: PluginCatalog): AppPluginStateMap {
  const settingsSchema = z.record(z.string(), z.union([z.boolean(), z.string()]));
  return new Map(catalog.plugins.filter((plugin) => plugin.kind === "app").map((plugin) =>
    [plugin.id.slice("app:".length), { enabled: plugin.enabled, settings: settingsSchema.catch({}).parse(plugin.settings ?? {}) }]));
}

/**
 * The bundled plugins' on switches and settings, shared by the session list
 * that draws them and Settings > Plugins that changes them. `load` reads them
 * once; `apply` takes the catalog Settings holds after a change, so a toggle
 * shows under the session list without a reload. Until the first read
 * succeeds `get` is undefined and no plugin is drawn, because drawing one with
 * its defaults could show a bar the reader turned off.
 */
export function createAppPluginStore(api: AppPluginStatesApi) {
  let states: AppPluginStateMap | undefined;
  let reading = false;
  const listeners = new Set<() => void>();
  const set = (next: AppPluginStateMap) => { states = next; for (const listener of listeners) listener(); };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    get: (): AppPluginStateMap | undefined => states,
    load() {
      if (states !== undefined || reading) return;
      reading = true;
      api.read().then(set, (error: unknown) => {
        console.warn("Forgerie could not read its plugin settings; plugins stay hidden until Settings > Plugins loads.", error);
      }).finally(() => { reading = false; });
    },
    apply(catalog: PluginCatalog) { set(statesFromCatalog(catalog)); },
  };
}
export type AppPluginStore = ReturnType<typeof createAppPluginStore>;

export const appPluginStore = createAppPluginStore(createAppPluginStatesApi((path, init) => fetch(path, init)));
