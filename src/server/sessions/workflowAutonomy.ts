import { loadPiWebConfig, type LoadOptions, type PiWebConfig } from "../../config.js";
import { workflowAutonomyManifest } from "../../shared/appPluginManifests.js";
import { appPluginEnabled, resolveAppSettings } from "../../shared/appPlugins.js";

/** How far a workflow run goes without the user. Read at each decision, so a Settings change applies to running workflows. */
export interface WorkflowAutonomy {
  /** Forgerie lands at land stops. */
  landStops: boolean;
  /** Forgerie approves at approve stops. */
  approveStops: boolean;
  /** Must-fix review rounds before the agent moves on; undefined has no limit. */
  reviewRounds: number | undefined;
}

/** Every stop waits for the user, and reviews have no limit. Sessions without a configured reader use this. */
export const WAIT_FOR_USER: WorkflowAutonomy = { landStops: false, approveStops: false, reviewRounds: undefined };

export function readWorkflowAutonomy(config: Pick<PiWebConfig, "plugins">): WorkflowAutonomy {
  const entry = config.plugins?.[workflowAutonomyManifest.id];
  if (!appPluginEnabled(workflowAutonomyManifest, entry)) return WAIT_FOR_USER;
  const values = resolveAppSettings(workflowAutonomyManifest, entry?.settings);
  const rounds = Number(values["review_rounds"]);
  return { landStops: values["land_stops"] === true, approveStops: values["approve_stops"] === true,
    reviewRounds: Number.isInteger(rounds) && rounds > 0 ? rounds : undefined };
}

/** An unreadable config means every stop waits: the safe choice is the user's. */
export function createWorkflowAutonomyReader(options: LoadOptions): () => WorkflowAutonomy {
  return () => {
    try { return readWorkflowAutonomy(loadPiWebConfig(options).config); }
    catch { return WAIT_FOR_USER; }
  };
}
