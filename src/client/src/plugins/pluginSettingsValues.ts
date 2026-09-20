import type { PiWebPluginConfigMap, PiWebPluginSettings } from "../api";
import { parseMachineScopedPluginId } from "../../../shared/machinePluginIds";

/**
 * Saved settings for one loaded plugin.
 *
 * A remote plugin is registered under a machine-scoped id, while the config
 * file and the plugin list use the plugin's own id. Try the registered id
 * first, then the id the settings are saved under. Missing config is an empty
 * object: the plugin then falls back to each field's declared default.
 */
export function pluginSettingsValues(pluginConfig: PiWebPluginConfigMap, qualifiedPluginId: string): PiWebPluginSettings {
  const direct = pluginConfig[qualifiedPluginId];
  if (direct?.settings !== undefined) return direct.settings;
  const sourcePluginId = parseMachineScopedPluginId(qualifiedPluginId)?.pluginId ?? qualifiedPluginId;
  return pluginConfig[sourcePluginId]?.settings ?? {};
}
