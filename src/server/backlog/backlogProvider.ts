import type { AzureWorkItemImageRef } from "../azureDevops/azureWorkItemImages.js";
import type { BacklogImageSummary, BacklogLaunchContent } from "../../shared/backlog.js";
import type { BacklogScope } from "../../shared/backlog.js";
import type { BacklogConfig, BacklogItem, BacklogProviderId, BacklogWarning, Project } from "../../shared/apiTypes.js";

export interface BacklogScanContext { scope: BacklogScope; githubLogin?: string }
export interface ScannedBacklogItem {
  item: BacklogItem; body: string;
  azureImages?: { organization: string; refs: AzureWorkItemImageRef[] };
  imageSummary?: BacklogImageSummary;
}
export interface BacklogProviderScan { entries: ScannedBacklogItem[]; warnings: BacklogWarning[]; sources?: BacklogProviderId[] }

/**
 * One place backlog items come from. A provider reports items with readiness derived from its own data
 * (ready, blocked, closed). It never sees claims: Forgerie owns them and overlays them after every scan.
 */
export interface BacklogProvider {
  readonly id: BacklogProviderId;
  /**
   * `repo` is the canonical checkout root; `config` is the project's `backlog` settings, already validated.
   * A thrown error becomes one project-error warning.
   */
  scan(project: Project, repo: string, config: BacklogConfig | undefined, context?: BacklogScanContext): Promise<BacklogProviderScan>;
  /** The first prompt for a session dedicated to this item. */
  prompt(entry: ScannedBacklogItem): string;
  /** Launch-only I/O. Scans and detail reads never download attachments. */
  prepareLaunch?(entry: ScannedBacklogItem): Promise<BacklogLaunchContent>;
}

/** Standalone boards never receive a local project or repository. */
export interface BacklogSourceProvider extends Pick<BacklogProvider, "prompt" | "prepareLaunch"> {
  readonly id: "azure-devops";
  scan(source: import("../../shared/backlogSources.js").BacklogSource, context?: BacklogScanContext): Promise<BacklogProviderScan>;
}
