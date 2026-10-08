import type { PullRequest } from "../../shared/pullRequests.js";
import type { GitHubPullSnapshot } from "./githubPullRead.js";
export const PR_TIME = "2026-10-07T12:00:00.000Z";
export const PR_SHA = "a".repeat(40);
export function pullSnapshot(patch: Partial<PullRequest> = {}): GitHubPullSnapshot {
  return { pull: { repo: "owner/repo", number: 9, title: "Fix tests", url: "https://github.com/owner/repo/pull/9", state: "open", head: "fix", headSha: PR_SHA, base: "main", author: "owner", updatedAt: PR_TIME, mergeability: "clean", files: 1, additions: 2, deletions: 1,
    checks: [{ id: "run:1", name: "tests", state: "passed", url: "https://github.com/check/1", required: true, updatedAt: PR_TIME }], reviews: [], comments: [], complete: true, merge: { kind: "allowed" }, ...patch }, remarks: [], ownLogin: "forgerie[bot]" };
}
