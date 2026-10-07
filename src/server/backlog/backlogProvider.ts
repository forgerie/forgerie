import type { BacklogConfig, BacklogItem, BacklogProviderId, BacklogWarning, Project } from "../../shared/apiTypes.js";

export interface ScannedBacklogItem { item: BacklogItem; body: string }
export interface BacklogProviderScan { entries: ScannedBacklogItem[]; warnings: BacklogWarning[] }

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
  scan(project: Project, repo: string, config: BacklogConfig | undefined): Promise<BacklogProviderScan>;
  /** The first prompt for a session dedicated to this item. */
  prompt(entry: ScannedBacklogItem): string;
}
