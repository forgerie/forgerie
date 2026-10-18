import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
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
  /** Absolute folders whose repositories may push to their default branch without a gate. */
  pushDefaultFolders: readonly string[];
}

/** Every stop waits for the user, and reviews have no limit. Sessions without a configured reader use this. */
export const WAIT_FOR_USER: WorkflowAutonomy = { landStops: false, approveStops: false, reviewRounds: undefined, pushDefaultFolders: [] };

/**
 * The folders a user wrote, as absolute paths. `none`, blanks, relative paths and the filesystem root are dropped:
 * a relative path would resolve against the daemon's folder, and the root would allow every repository.
 */
export function parsePushFolders(text: string, home = homedir()): string[] {
  return text.split(/[,\n]/u).map((part) => part.trim()).filter((part) => part !== "" && part.toLowerCase() !== "none")
    .map((part) => part === "~" ? home : part.startsWith("~/") ? join(home, part.slice(2)) : part)
    .filter((part) => isAbsolute(part)).map((part) => resolve(part)).filter((part) => part !== "/");
}

export function readWorkflowAutonomy(config: Pick<PiWebConfig, "plugins">): WorkflowAutonomy {
  const entry = config.plugins?.[workflowAutonomyManifest.id];
  if (!appPluginEnabled(workflowAutonomyManifest, entry)) return WAIT_FOR_USER;
  const values = resolveAppSettings(workflowAutonomyManifest, entry?.settings);
  const rounds = Number(values["review_rounds"]);
  return { landStops: values["land_stops"] === true, approveStops: values["approve_stops"] === true,
    reviewRounds: Number.isInteger(rounds) && rounds > 0 ? rounds : undefined,
    pushDefaultFolders: parsePushFolders(String(values["push_default_folders"] ?? "none")) };
}

/** An unreadable config means every stop waits: the safe choice is the user's. */
export function createWorkflowAutonomyReader(options: LoadOptions): () => WorkflowAutonomy {
  return () => {
    try { return readWorkflowAutonomy(loadPiWebConfig(options).config); }
    catch { return WAIT_FOR_USER; }
  };
}
