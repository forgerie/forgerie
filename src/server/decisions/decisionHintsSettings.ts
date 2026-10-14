import { loadPiWebConfig, type LoadOptions, type PiWebConfig } from "../../config.js";
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

/** Sessiond captures its private environment; config edits are read on each background use.
 * An unreadable config means no hints, not an error on the user-visible path.
 */
export function createDecisionHintsSettingsReader(options: LoadOptions): () => DecisionHintsSettings {
  return () => {
    try { return readDecisionHintsSettings(loadPiWebConfig(options).config); }
    catch { return readDecisionHintsSettings({}); }
  };
}
