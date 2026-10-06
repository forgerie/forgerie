import { describe, expect, it } from "vitest";
import type { PiWebConfigResponse, PiWebConfigValues } from "../../api";
import { mergeSelectedMachinePluginConfig, pluginEnabledConfigPatch, pluginSettingsBoolean, pluginSettingsConfigPatch } from "./settingsPluginConfig";

describe("plugin settings config helpers", () => {
  it("builds plugin-only save patches while preserving existing plugin config", () => {
    const patch = pluginEnabledConfigPatch(
      {
        host: "127.0.0.1",
        plugins: {
          info: { enabled: true, settings: { theme: "dark" }, custom: "keep" },
          metrics: { enabled: false },
        },
      },
      "info",
      false,
    );

    expect(Object.keys(patch)).toEqual(["plugins"]);
    expect(patch).toEqual({
      plugins: {
        info: { enabled: false, settings: { theme: "dark" }, custom: "keep" },
        metrics: { enabled: false },
      },
    });
  });

  it("merges local selected-machine plugin config into gateway config without dropping gateway-only values", () => {
    const gateway = configResponse({
      host: "127.0.0.1",
      port: 8504,
      allowedHosts: ["gateway.local"],
      shortcuts: { "core:view.chat": "ctrl+1" },
      spawnSessions: false,
      plugins: { info: { enabled: false } },
    });
    const selectedMachine = configResponse({ plugins: { info: { enabled: true }, metrics: { enabled: false } } });

    expect(mergeSelectedMachinePluginConfig(gateway, selectedMachine)).toEqual({
      ...gateway,
      config: {
        host: "127.0.0.1",
        port: 8504,
        allowedHosts: ["gateway.local"],
        shortcuts: { "core:view.chat": "ctrl+1" },
        spawnSessions: false,
        plugins: { info: { enabled: true }, metrics: { enabled: false } },
      },
      effectiveConfig: {
        host: "127.0.0.1",
        port: 8504,
        allowedHosts: ["gateway.local"],
        shortcuts: { "core:view.chat": "ctrl+1" },
        spawnSessions: false,
        plugins: { info: { enabled: true }, metrics: { enabled: false } },
      },
    });
  });

  it("patches one plugin's saved settings without dropping its enablement or other keys", () => {
    const patch = pluginSettingsConfigPatch(
      {
        plugins: {
          quota: { enabled: true, settings: { five_hour: true, seven_day: true }, custom: "keep" },
          other: { enabled: false },
        },
      },
      "quota",
      { five_hour: false },
    );

    expect(Object.keys(patch)).toEqual(["plugins"]);
    expect(patch).toEqual({
      plugins: {
        quota: { enabled: true, settings: { five_hour: false, seven_day: true }, custom: "keep" },
        other: { enabled: false },
      },
    });
  });

  it("reads a saved boolean setting and falls back to the field default", () => {
    expect(pluginSettingsBoolean({ five_hour: false }, "five_hour", true)).toBe(false);
    expect(pluginSettingsBoolean({ five_hour: "no" }, "five_hour", true)).toBe(true);
    expect(pluginSettingsBoolean(undefined, "five_hour", true)).toBe(true);
    expect(pluginSettingsBoolean({ five_hour: true }, "five_hour", false)).toBe(true);
  });
});

function configResponse(config: PiWebConfigValues): PiWebConfigResponse {
  return {
    path: "/tmp/pi-web/config.json",
    exists: true,
    config,
    effectiveConfig: config,
    envOverrides: { host: false, port: false, allowedHosts: false, spawnSessions: false, subsessions: false, askUser: false, codemode: false, agentCommand: false, agentDir: false, agentSessionDir: false },
  };
}
