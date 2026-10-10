import type { ChildSummary } from "../childAgentsModel";
import type { ChildDetail, Runs } from "../childWorkModel";

export const FINISHED: ChildSummary = { name: "builder", conversationId: 44, agent: "worker", busy: false, questions: [], createdAt: 1791500000000,
  worktree: { path: "/code/forgerie/.worktrees/child-ui", branch: "fix/child-actions", repo: "/code/forgerie", defaultBranch: "main", ahead: 2, dirty: false, state: "active", cleanup: { kind: "pending" } } };
export const RUNS: Runs = { retentionDays: 90, records: [{ id: "r1", session: { id: "session-1", cwd: "/code/forgerie" },
  child: { name: "builder", conversationId: 44, agent: "worker", agentFile: { path: "/profile/agents/worker.md", sha256: "a".repeat(64) } }, model: { provider: "provider", modelId: "model" }, startedAt: 1791500000000,
  state: { kind: "finished", outcome: "answered", finishedAt: 1791500042000, durationMs: 42000, timing: "observed" }, turns: 6,
  usage: { models: { model: { input: 1200, output: 400, cacheRead: 0, cacheWrite: 0, totalTokens: 1600, cost: { total: 0.51 } } }, tools: {} } }] };
export const REVIEW: Extract<ChildDetail, { kind: "review" }> = { kind: "review", data: { head: "0123456789abcdef", sections: [
  { label: "Committed changes", diff: "diff --git a/actions.ts b/actions.ts\n--- a/actions.ts\n+++ b/actions.ts\n@@ -1 +1 @@\n-export const enabled = false;\n+export const enabled = true;", truncated: false },
  { label: "Staged changes", diff: "", truncated: false }, { label: "Unstaged changes", diff: "", truncated: false }], untracked: ["notes.txt"] } };
export const DISCARD: Extract<ChildDetail, { kind: "discard" }> = { kind: "discard", data: { worktreeId: "worktree-1", branch: "fix/child-actions", defaultBranch: "main", confirmationToken: "fixture-confirmation",
  commits: [{ sha: "12345678", subject: "Keep child actions reachable" }, { sha: "abcdefgh", subject: "Show real lifecycle state" }], dirtyFiles: ["src/action.ts", "README.md"] } };
export const CLEANUP: Extract<ChildDetail, { kind: "cleanup" }> = { kind: "cleanup", data: { phase: "done", report: { startedAt: "2026-10-09T12:00:00Z", finishedAt: "2026-10-09T12:00:01Z", removed: [],
  kept: [{ id: "worktree-1", repo: "/code/forgerie", path: "/code/forgerie/.worktrees/child-ui", branch: "fix/child-actions", reason: "in-use", detail: "The parent session still owns this worktree." }] } } };
