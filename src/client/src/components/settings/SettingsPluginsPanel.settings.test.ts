// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PiWebConfigResponse, PiWebConfigValues, PiWebPluginInfo } from "../../api";
import type { PluginSettingsField } from "../../plugins/types";
import { SettingsPluginsPanel } from "./SettingsPluginsPanel";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("settings-plugins-panel plugin settings toggles", () => {
  it("renders one toggle per declared field, using the saved value and the field default", async () => {
    const panel = new SettingsPluginsPanel();
    panel.configResponse = configResponse({ plugins: { quota: { enabled: true, settings: { five_hour: false } } } });
    panel.pluginsResponse = { plugins: [pluginInfo("quota", true)] };
    panel.settingsFieldsForPlugin = settingsFields;
    document.body.append(panel);
    await panel.updateComplete;

    const toggles = settingToggles(panel);

    expect(toggles).toHaveLength(2);
    expect(toggles[0]?.checked).toBe(false);
    expect(toggles[1]?.checked).toBe(true);
    expect(panel.shadowRoot?.textContent).toContain("Settings");
  });

  it("reports a change with the plugin id, field id, and new value", async () => {
    const panel = new SettingsPluginsPanel();
    const onSavePluginSetting = vi.fn();
    panel.configResponse = configResponse({ plugins: { quota: { enabled: true } } });
    panel.pluginsResponse = { plugins: [pluginInfo("quota", true)] };
    panel.settingsFieldsForPlugin = settingsFields;
    panel.onSavePluginSetting = onSavePluginSetting;
    document.body.append(panel);
    await panel.updateComplete;

    const toggle = settingToggles(panel)[0];
    if (toggle === undefined) throw new Error("The five-hour toggle did not render");
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    await panel.updateComplete;

    expect(onSavePluginSetting).toHaveBeenCalledWith("quota", "five_hour", false);
  });

  it("renders no settings section for a plugin that declares no fields", async () => {
    const panel = new SettingsPluginsPanel();
    panel.configResponse = configResponse({ plugins: { plain: { enabled: true } } });
    panel.pluginsResponse = { plugins: [pluginInfo("plain", true)] };
    document.body.append(panel);
    await panel.updateComplete;

    expect(settingToggles(panel)).toHaveLength(0);
  });

  it("disables setting toggles while the selected machine config is unavailable", async () => {
    const panel = new SettingsPluginsPanel();
    panel.pluginsResponse = { plugins: [pluginInfo("quota", true)] };
    panel.settingsFieldsForPlugin = settingsFields;
    document.body.append(panel);
    await panel.updateComplete;

    const toggles = settingToggles(panel);

    expect(toggles).toHaveLength(2);
    expect(toggles.every((toggle) => toggle.disabled)).toBe(true);
  });
});

function settingToggles(panel: SettingsPluginsPanel): HTMLInputElement[] {
  return [...(panel.shadowRoot?.querySelectorAll<HTMLInputElement>(".plugin-setting input") ?? [])];
}

function settingsFields(pluginId: string): readonly PluginSettingsField[] {
  if (pluginId !== "quota") return [];
  return [
    { id: "five_hour", label: "Five-hour window", description: "The rolling five-hour allowance.", type: "boolean", default: true },
    { id: "seven_day", label: "Seven-day window", type: "boolean", default: true },
  ];
}

function configResponse(config: PiWebConfigValues): PiWebConfigResponse {
  return {
    path: "/tmp/pi-web/config.json",
    exists: true,
    config,
    effectiveConfig: config,
    envOverrides: { host: false, port: false, allowedHosts: false, spawnSessions: false, subsessions: false, askUser: false, agentCommand: false, agentDir: false, agentSessionDir: false },
  };
}

function pluginInfo(id: string, enabled: boolean): PiWebPluginInfo {
  return {
    id,
    module: `/pi-web-plugins/${id}/plugin.js`,
    source: "test",
    scope: "local",
    machineSpecific: false,
    enabled,
  };
}
