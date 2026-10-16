import type { ActionRun } from "../../shared/actionRuns.js";
export const RUN_TIME = "2026-10-01T12:00:00Z";
export function actionRun(extra: Partial<ActionRun> = {}): ActionRun {
  return { repo: "owner/repo", runId: 4812, attempt: 1, workflow: "CI", workflowPath: ".github/workflows/ci.yml", title: "Build", event: "push", branch: "main", headSha: "a".repeat(40), actor: "owner", url: "https://github.com/owner/repo/actions/runs/4812", status: "running", conclusion: null, createdAt: RUN_TIME, updatedAt: RUN_TIME, pullNumbers: [], jobs: [], complete: true, ...extra };
}
