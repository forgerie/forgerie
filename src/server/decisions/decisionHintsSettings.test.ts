import { mkdtemp, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import * as config from "../../config.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDecisionHintsSettingsReader, readDecisionHintsSettings } from "./decisionHintsSettings.js";

afterEach(() => { vi.restoreAllMocks(); });

describe("decision hints settings", () => {
  it("reads and validates unchanged config once, and keeps cached settings private to the reader", async () => {
    const dir = await mkdtemp(join(tmpdir(), "decision-settings-cache-"));
    const load = vi.spyOn(config, "loadPiWebConfig");
    try {
      const path = join(dir, "config.json");
      await writeFile(path, JSON.stringify({plugins: {"decision-hints": {enabled: true, settings: {model: "FIRST"}}}}));
      const read = createDecisionHintsSettingsReader({env: {PI_WEB_CONFIG: path}});
      const first = read();
      expect(first).toMatchObject({enabled: true, model: "FIRST"});
      first.model = "caller mutation";
      expect(read().model).toBe("FIRST");
      expect(read().model).toBe("FIRST");
      expect(load).toHaveBeenCalledTimes(1);
      const otherReader = createDecisionHintsSettingsReader({env: {PI_WEB_CONFIG: path}});
      expect(otherReader().model).toBe("FIRST");
      expect(load).toHaveBeenCalledTimes(2);
    } finally { await rm(dir, {recursive: true, force: true}); }
  });

  it("reloads edited, replaced, repaired, removed and recreated config without a restart", async () => {
    const dir = await mkdtemp(join(tmpdir(), "decision-settings-reload-"));
    const load = vi.spyOn(config, "loadPiWebConfig");
    try {
      const path = join(dir, "config.json");
      const write = (model: string) => writeFile(path, JSON.stringify({plugins: {"decision-hints": {enabled: true, settings: {model}}}}));
      await write("FIRST");
      const read = createDecisionHintsSettingsReader({env: {PI_WEB_CONFIG: path}});
      expect(read().model).toBe("FIRST");
      await write("OTHER");
      await utimes(path, 1_700_000_001, 1_700_000_001);
      expect(read().model).toBe("OTHER");
      expect(load).toHaveBeenCalledTimes(2);
      const before = await stat(path);
      const replacement = join(dir, "replacement.json");
      await writeFile(replacement, JSON.stringify({plugins: {"decision-hints": {enabled: true, settings: {model: "THIRD"}}}}));
      await utimes(replacement, before.atime, before.mtime);
      await rename(replacement, path);
      expect(read().model).toBe("THIRD");
      expect(load).toHaveBeenCalledTimes(3);
      await writeFile(path, "not json");
      expect(read().enabled).toBe(false);
      expect(read().enabled).toBe(false);
      expect(load).toHaveBeenCalledTimes(4);
      await write("FIXED");
      expect(read()).toMatchObject({enabled: true, model: "FIXED"});
      expect(load).toHaveBeenCalledTimes(5);
      await rm(path);
      expect(read().enabled).toBe(false);
      await write("AGAIN");
      expect(read()).toMatchObject({enabled: true, model: "AGAIN"});
      expect(load).toHaveBeenCalledTimes(6);
    } finally { await rm(dir, {recursive: true, force: true}); }
  });

  it("checks the resolved path on each read and fails off when stat cannot read it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "decision-settings-path-"));
    try {
      await writeFile(join(dir, "config.json"), JSON.stringify({plugins: {"decision-hints": {enabled: true}}}));
      const env = {PI_WEB_CONFIG: "config.json"};
      const read = createDecisionHintsSettingsReader({env, cwd: dir});
      expect(read().enabled).toBe(true);
      env.PI_WEB_CONFIG = "config.json/not-a-directory";
      expect(read().enabled).toBe(false);
      env.PI_WEB_CONFIG = "config.json";
      expect(read().enabled).toBe(true);
    } finally { await rm(dir, {recursive: true, force: true}); }
  });
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
