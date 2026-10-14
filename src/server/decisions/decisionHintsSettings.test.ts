import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createDecisionHintsSettingsReader, readDecisionHintsSettings } from "./decisionHintsSettings.js";

describe("decision hints settings", () => {
  it("is off by default and resolves typed defaults", () => {
    expect(readDecisionHintsSettings({})).toEqual({ enabled: false, baseUrl: "", model: "fast", attention: true, risk_labels: true, sensitivity: "normal" });
  });
  it("reads the master switch and each feature independently", () => {
    expect(readDecisionHintsSettings({ plugins: { "decision-hints": { enabled: true, settings: { gateway_url: "http://localhost:4000", model: "chosen", attention: false, risk_labels: true, sensitivity: "high" } } } }))
      .toEqual({ enabled: true, baseUrl: "http://localhost:4000", model: "chosen", attention: false, risk_labels: true, sensitivity: "high" });
  });
  it("uses safe defaults for invalid field values", () => {
    expect(readDecisionHintsSettings({ plugins: { "decision-hints": { settings: { gateway_url: "file:///secret", model: "", sensitivity: "extreme", attention: "yes" } } } }))
      .toEqual(readDecisionHintsSettings({}));
  });
  it("re-reads the config on use without a daemon restart and fails off on unreadable config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "decision-settings-"));
    try {
      const path = join(dir, "config.json"); const read = createDecisionHintsSettingsReader({ env: { PI_WEB_CONFIG: path } });
      expect(read().enabled).toBe(false);
      await writeFile(path, JSON.stringify({ plugins: { "decision-hints": { enabled: true, settings: { model: "updated", sensitivity: "low" } } } }));
      expect(read()).toMatchObject({ enabled: true, model: "updated", sensitivity: "low" });
      await writeFile(path, "not json"); expect(read().enabled).toBe(false);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
