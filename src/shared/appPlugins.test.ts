import { describe, expect, it } from "vitest";
import { AppSettingsError, resolveAppSettings, storedAppSettings, type AppPluginManifest } from "./appPlugins.js";
import { APP_PLUGIN_MANIFESTS, decisionHintsManifest } from "./appPluginManifests.js";

const manifest: AppPluginManifest = {
  id: "meters", name: "Meters", description: "Draws meters.",
  settings: [
    { type: "url", id: "endpoint", label: "Address", description: "", default: "https://router.example/quota" },
    { type: "boolean", id: "five_hour", label: "Five-hour window", description: "", default: true },
  ],
};

describe("app plugin settings", () => {
  it("resolves every declared setting, keeping valid stored values and defaulting the rest", () => {
    expect(resolveAppSettings(manifest, undefined)).toEqual({ endpoint: "https://router.example/quota", five_hour: true });
    expect(resolveAppSettings(manifest, { five_hour: false, endpoint: "ftp://nope", stray: 1 })).toEqual({ endpoint: "https://router.example/quota", five_hour: false });
    expect(resolveAppSettings(manifest, { endpoint: "http://127.0.0.1:8317/quota", five_hour: "no" })).toEqual({ endpoint: "http://127.0.0.1:8317/quota", five_hour: true });
  });
  it("stores only values that differ from their default", () => {
    expect(storedAppSettings(manifest, { endpoint: "https://router.example/quota", five_hour: false })).toEqual({ five_hour: false });
    expect(storedAppSettings(manifest, { five_hour: true })).toEqual({});
  });
  it("refuses an unknown key, a wrong kind of value, and an address that is not http or https", () => {
    expect(() => storedAppSettings(manifest, { stray: true })).toThrow(AppSettingsError);
    expect(() => storedAppSettings(manifest, { five_hour: "false" })).toThrow("Five-hour window must be on or off.");
    expect(() => storedAppSettings(manifest, { endpoint: "javascript:alert(1)" })).toThrow("Address must be an http or https address.");
    expect(() => storedAppSettings(manifest, { endpoint: `https://x.example/${"a".repeat(2050)}` })).toThrow(AppSettingsError);
  });
  it("validates text, choices and an optional empty gateway address", () => {
    expect(storedAppSettings(decisionHintsManifest, { model: "chosen", sensitivity: "high", gateway_url: "" })).toEqual({ model: "chosen", sensitivity: "high" });
    expect(() => storedAppSettings(decisionHintsManifest, { model: " " })).toThrow(AppSettingsError);
    expect(() => storedAppSettings(decisionHintsManifest, { model: "a".repeat(2049) })).toThrow(AppSettingsError);
    expect(() => storedAppSettings(decisionHintsManifest, { sensitivity: "extreme" })).toThrow(AppSettingsError);
    expect(() => storedAppSettings(decisionHintsManifest, { gateway_url: "file:///secret" })).toThrow(AppSettingsError);
  });
  it("keeps every bundled plugin's defaults valid and its ids unique", () => {
    for (const plugin of APP_PLUGIN_MANIFESTS) {
      expect(storedAppSettings(plugin, resolveAppSettings(plugin, undefined))).toEqual({});
      expect(new Set(plugin.settings.map((def) => def.id)).size).toBe(plugin.settings.length);
    }
    expect(new Set(APP_PLUGIN_MANIFESTS.map((plugin) => plugin.id)).size).toBe(APP_PLUGIN_MANIFESTS.length);
  });
});
