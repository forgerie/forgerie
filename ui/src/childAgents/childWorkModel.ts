import { z } from "zod";
import { actionResultSchema, discardPreviewSchema, type WorktreeActionResult } from "../worktrees/worktreeApi";
import { blockedText } from "../worktrees/worktreeModel";
import type { ChildSummary } from "./childAgentsModel";

export { actionResultSchema, discardPreviewSchema };
export const reviewSchema = z.object({ head: z.string(), sections: z.array(z.object({ label: z.string(), diff: z.string(), truncated: z.boolean() })), untracked: z.array(z.string()) });
const usage = z.object({ input: z.number(), output: z.number(), cacheRead: z.number(), cacheWrite: z.number(), totalTokens: z.number(), cost: z.object({ total: z.number() }) });
export const runsSchema = z.object({ retentionDays: z.number(), records: z.array(z.object({
  id: z.string(), session: z.object({ id: z.string(), cwd: z.string() }),
  child: z.object({ name: z.string(), conversationId: z.number(), agent: z.string().nullable(), agentFile: z.object({ path: z.string(), sha256: z.string() }).optional() }),
  model: z.object({ provider: z.string(), modelId: z.string() }).nullable(), startedAt: z.number(), turns: z.number(),
  state: z.discriminatedUnion("kind", [z.object({ kind: z.literal("running") }), z.object({ kind: z.literal("finished"), outcome: z.enum(["answered", "failed", "stopped"]), finishedAt: z.number(), durationMs: z.number(), timing: z.enum(["observed", "recovered"]) })]),
  usage: z.object({ models: z.record(z.string(), usage), tools: z.record(z.string(), usage) }).nullable(),
})) });
const identity = { id: z.string(), repo: z.string(), path: z.string(), branch: z.string() };
const report = z.object({ startedAt: z.string(), finishedAt: z.string(), removed: z.array(z.object(identity)),
  kept: z.array(z.object({ ...identity, reason: z.string(), detail: z.string().optional() })) });
export const cleanupStateSchema = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("never-run") }), z.object({ phase: z.literal("running"), previous: report.optional() }),
  z.object({ phase: z.literal("done"), report }), z.object({ phase: z.literal("failed"), error: z.string(), previous: report.optional() }),
]);
export type Runs = z.infer<typeof runsSchema>;
export type ChildDetail =
  | { kind: "none" }
  | { kind: "loading"; title: string }
  | { kind: "failed"; message: string }
  | { kind: "review"; data: z.infer<typeof reviewSchema> }
  | { kind: "discard"; data: z.infer<typeof discardPreviewSchema> }
  | { kind: "runs"; data: Runs }
  | { kind: "cleanup"; data: z.infer<typeof cleanupStateSchema> };

/** Readiness is a policy, not a commit count. Unknown Git status fails closed. */
export function landBlocker(child: ChildSummary): string | undefined {
  if (!child.worktree) return "This child uses the shared folder.";
  if (child.worktree.state !== "active") return "This worktree is already closed.";
  if (child.worktree.statusError) return child.worktree.statusError;
  if (child.busy || child.questions.length > 0) return "Stop the child or wait for its work to finish.";
  if (child.worktree.dirty) return "Commit the changed files before landing.";
  if (child.worktree.ahead === 0) return "No new commits to land.";
  return undefined;
}
export function resultText(result: WorktreeActionResult, branch: string): string {
  switch (result.kind) {
    case "landed": return `Landed on ${branch} at ${result.sha.slice(0, 8)}.${cleanupText(result.cleanup)}`;
    case "discarded": return `Worktree discarded.${cleanupText(result.cleanup)}`;
    case "blocked": return `Action refused. ${blockedText(result.reason, branch)}${result.files.length ? ` Files: ${result.files.join(", ")}` : ""}`;
    case "conflict": return `Rebase onto ${result.defaultBranch} failed and was aborted. Resolve and commit these files before retrying: ${result.files.join(", ")}`;
    case "stale-preview": return "The worktree changed. Nothing was discarded. Review a fresh discard preview before confirming again.";
  }
}
function cleanupText(cleanup: { kind: "pending" } | { kind: "done" } | { kind: "failed"; error: string }): string {
  return cleanup.kind === "failed" ? ` Cleanup failed: ${cleanup.error} Retry cleanup without repeating the Git change.` : cleanup.kind === "pending" ? " Folder cleanup is pending." : " Folder removed.";
}
export function runCost(run: Runs["records"][number]): number | undefined {
  if (run.usage === null) return undefined;
  return [...Object.values(run.usage.models), ...Object.values(run.usage.tools)].reduce((sum, value) => sum + value.cost.total, 0);
}
export function totalCost(runs: Runs): string {
  const known = runs.records.reduce((sum, run) => sum + (runCost(run) ?? 0), 0);
  return `${money(known)}${runs.records.some((run) => run.usage === null) ? " + unknown" : ""}`;
}
/**
 * What one child has cost across its runs, from the run history. Undefined while no run of it is on record or any of
 * its runs has no usage, so a row never shows a partial sum as the whole.
 */
export function childCost(runs: Runs | undefined, conversationId: number): number | undefined {
  const own = runs?.records.filter((run) => run.child.conversationId === conversationId) ?? [];
  if (own.length === 0) return undefined;
  let sum = 0;
  for (const run of own) { const cost = runCost(run); if (cost === undefined) return undefined; sum += cost; }
  return sum;
}
export function money(value: number | undefined): string { return value === undefined ? "Unknown cost" : `$${value.toFixed(2)}`; }
