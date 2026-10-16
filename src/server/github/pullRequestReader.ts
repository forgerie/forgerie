import type { PullLink, PullRemark, PullRequest, RepositoryOpenPulls } from "../../shared/pullRequests.js";

export interface PullSnapshot { pull: PullRequest; remarks: PullRemark[]; ownLogin?: string }
/** Provider adapters resolve the session's repository and return the shared watch input. */
export interface PullRequestReader {
  readonly provider: PullLink["provider"];
  repo(cwd: string): Promise<{ slug: string }>;
  openPulls(cwd: string): Promise<RepositoryOpenPulls>;
  pull(cwd: string, number: number, annotations?: boolean): Promise<PullSnapshot>;
}
