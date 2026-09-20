import type { PiWebConfigResponse, PiWebConfigValues, PiWebPluginSettings } from "../../api";

export function pluginEnabledConfigPatch(baseConfig: PiWebConfigValues, pluginId: string, enabled: boolean): PiWebConfigValues {
  const currentPlugins = baseConfig.plugins ?? {};
  const currentPluginConfig = currentPlugins[pluginId] ?? {};
  return {
    plugins: {
      ...currentPlugins,
      [pluginId]: { ...currentPluginConfig, enabled },
    },
  };
}

/**
 * A patch that changes saved values for one plugin's declared settings fields
 * while leaving its other config keys alone.
 */
export function pluginSettingsConfigPatch(baseConfig: PiWebConfigValues, pluginId: string, settings: PiWebPluginSettings): PiWebConfigValues {
  const currentPlugins = baseConfig.plugins ?? {};
  const currentPluginConfig = currentPlugins[pluginId] ?? {};
  return {
    plugins: {
      ...currentPlugins,
      [pluginId]: {
        ...currentPluginConfig,
        settings: { ...(currentPluginConfig.settings ?? {}), ...settings },
      },
    },
  };
}

/** The saved value for one boolean field, falling back to the field's default. */
export function pluginSettingsBoolean(settings: PiWebPluginSettings | undefined, fieldId: string, fallback: boolean): boolean {
  const value = settings?.[fieldId];
  return typeof value === "boolean" ? value : fallback;
}

export function mergeSelectedMachinePluginConfig(base: PiWebConfigResponse, selectedMachine: PiWebConfigResponse): PiWebConfigResponse {
  return {
    ...base,
    config: mergePluginConfig(base.config, selectedMachine.config),
    effectiveConfig: mergePluginConfig(base.effectiveConfig, selectedMachine.effectiveConfig),
  };
}

function mergePluginConfig(base: PiWebConfigValues, selectedMachine: PiWebConfigValues): PiWebConfigValues {
  if (selectedMachine.plugins === undefined) return base;
  return { ...base, plugins: selectedMachine.plugins };
}
