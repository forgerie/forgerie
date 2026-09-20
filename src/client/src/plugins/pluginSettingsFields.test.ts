import { describe, expect, it } from "vitest";
import { readPluginSettingsFields } from "./pluginSettingsFields";

describe("readPluginSettingsFields", () => {
  it("returns an empty list when a plugin declares no settings", () => {
    expect(readPluginSettingsFields("quota", undefined)).toEqual([]);
    expect(readPluginSettingsFields("quota", [])).toEqual([]);
  });

  it("keeps a well-formed boolean field, with and without a description", () => {
    expect(readPluginSettingsFields("quota", [
      { id: "five_hour", label: "Five-hour window", description: "The rolling allowance.", type: "boolean", default: true },
      { id: "seven_day", label: "Seven-day window", type: "boolean", default: false },
    ])).toEqual([
      { id: "five_hour", label: "Five-hour window", description: "The rolling allowance.", type: "boolean", default: true },
      { id: "seven_day", label: "Seven-day window", type: "boolean", default: false },
    ]);
  });

  it("rejects a field type the host cannot render", () => {
    expect(() => readPluginSettingsFields("quota", [{ id: "limit", label: "Limit", type: "number", default: 3 }]))
      .toThrow("Unsupported settings field type for quota.limit: number");
  });

  it("rejects a duplicate field id", () => {
    expect(() => readPluginSettingsFields("quota", [
      { id: "five_hour", label: "Five-hour window", type: "boolean", default: true },
      { id: "five_hour", label: "Five-hour window (again)", type: "boolean", default: true },
    ])).toThrow("Duplicate settings field id for quota: five_hour");
  });

  it("rejects a missing id, label, or default", () => {
    expect(() => readPluginSettingsFields("quota", [{ label: "No id", type: "boolean", default: true }]))
      .toThrow("Invalid settings field id for quota: undefined");
    expect(() => readPluginSettingsFields("quota", [{ id: "limit", type: "boolean", default: true }]))
      .toThrow("Invalid settings field label for quota.limit");
    expect(() => readPluginSettingsFields("quota", [{ id: "limit", label: "Limit", type: "boolean" }]))
      .toThrow("Settings field default must be a boolean for quota.limit");
  });

  it("rejects a settings list that is not an array", () => {
    expect(() => readPluginSettingsFields("quota", "five_hour"))
      .toThrow("Invalid settings fields for quota: five_hour");
  });
});