import { describe, expect, it } from "vitest";
import { machineScopedPluginId } from "../../../shared/machinePluginIds";
import { pluginSettingsValues } from "./pluginSettingsValues";

describe("pluginSettingsValues", () => {
  it("returns the settings saved under the plugin's own id", () => {
    expect(pluginSettingsValues({ quota: { settings: { five_hour: false } } }, "quota")).toEqual({ five_hour: false });
  });

  it("finds a remote plugin's settings through its machine-scoped registration id", () => {
    const qualified = machineScopedPluginId("remote-a", "quota");
    expect(pluginSettingsValues({ quota: { settings: { seven_day: false } } }, qualified)).toEqual({ seven_day: false });
  });

  it("prefers settings saved under the registration id when both exist", () => {
    const qualified = machineScopedPluginId("remote-a", "quota");
    expect(pluginSettingsValues({ quota: { settings: { seven_day: false } }, [qualified]: { settings: { five_hour: false } } }, qualified)).toEqual({ five_hour: false });
  });

  it("returns an empty object when the plugin has no saved settings", () => {
    expect(pluginSettingsValues({}, "quota")).toEqual({});
    expect(pluginSettingsValues({ quota: { enabled: true } }, "quota")).toEqual({});
  });
});
