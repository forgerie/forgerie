import { statSync } from "node:fs";
import { loadPiWebConfig, piWebConfigPath, type LoadOptions, type PiWebConfig } from "../../config.js";
import { decisionHintsManifest } from "../../shared/appPluginManifests.js";
import { appPluginEnabled, resolveAppSettings } from "../../shared/appPlugins.js";

export interface DecisionHintsSettings {
  enabled: boolean;
  baseUrl: string;
  model: string;
  attention: boolean;
  risk_labels: boolean;
  sensitivity: "low" | "normal" | "high";
}

/** Settings contain no credential. Defaults and the master switch come from the app manifest. */
export function readDecisionHintsSettings(config: Pick<PiWebConfig, "plugins">): DecisionHintsSettings {
  const entry = config.plugins?.[decisionHintsManifest.id];
  const values = resolveAppSettings(decisionHintsManifest, entry?.settings);
  const sensitivity = values["sensitivity"];
  return {
    enabled: appPluginEnabled(decisionHintsManifest, entry),
    baseUrl: String(values["gateway_url"]), model: String(values["model"]),
    attention: values["attention"] === true, risk_labels: values["risk_labels"] === true,
    sensitivity: sensitivity === "low" || sensitivity === "high" ? sensitivity : "normal",
  };
}

/** Each use stats the config; only changed files are read and validated.
 * An unreadable config means no hints, not an error on the user-visible path.
 */
export function createDecisionHintsSettingsReader(options: LoadOptions): () => DecisionHintsSettings {
  const off = readDecisionHintsSettings({});
  let cached: { path: string; revision: string; settings: DecisionHintsSettings } | undefined;
  return () => {
    try {
      const path = piWebConfigPath(options.env, options.cwd);
      const stat = statSync(path, {throwIfNoEntry: false});
      if (stat === undefined) { cached = undefined; return {...off}; }
      // Detect atomic replacement and permission changes as well as ordinary edits.
      const revision = [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs, stat.mode].join(":");
      if (cached?.path !== path || cached.revision !== revision) {
        let settings: DecisionHintsSettings;
        try { settings = readDecisionHintsSettings(loadPiWebConfig(options).config); }
        catch { settings = off; }
        cached = {path, revision, settings};
      }
      return {...cached.settings};
    } catch {
      cached = undefined;
      return {...off};
    }
  };
}
