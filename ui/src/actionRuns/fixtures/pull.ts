/** One linked pull request, as the pull request panel reads it, whose head the derived runs ran on. */
import type { PullItem } from "../../pullRequests/pullRequestApi";
import { failedRun, session } from "./actionRuns";

export const pullItem: PullItem = {
  link: { session, repo: failedRun.repo, number: 142, watch: { kind: "off" } },
  pull: {
    repo: failedRun.repo, number: 142, title: "Retry dropped upload chunks", url: `https://github.com/${failedRun.repo}/pull/142`, state: "open",
    head: failedRun.branch, headSha: failedRun.headSha, base: "main", author: "simonwjackson", updatedAt: failedRun.updatedAt,
    mergeability: "clean", files: 4, additions: 86, deletions: 12,
    checks: [
      { id: "c1", name: "test (ubuntu-latest, node 24)", state: "failed", url: failedRun.url, required: true, seconds: 412 },
      { id: "c2", name: "lint", state: "passed", url: failedRun.url, required: true, seconds: 38 },
    ],
    reviews: [], comments: [], complete: true, merge: { kind: "blocked", reason: "Every required check must pass on this head commit." },
  },
};
