import { Type, type Static } from "typebox";
import type { ChildRetry } from "./childRetry.js";
import type { ChildWorktreeSummary } from "./sessionWorktree.js";

/** Safe row projection. Tool arguments, results, and transcript text never enter this payload. */
export const ChildActivitySchema = Type.Object({
  /** Estimated USD from committed pi.usage models + tools for this conversation across all runs. Null means unavailable. */
  costUsd: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
  lastTool: Type.Union([Type.Object({
    name: Type.String({ minLength: 1, maxLength: 80, pattern: "^[A-Za-z0-9_.:-]+$" }),
    at: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
  }), Type.Null()]),
});
export type ChildActivity = Static<typeof ChildActivitySchema>;

/** One item returned by GET /sessions/:id/children. */
export interface DurableChildSummary extends ChildActivity {
  name: string;
  conversationId: number;
  agent: string | null;
  busy: boolean;
  createdAt: number;
  worktree?: ChildWorktreeSummary;
  retry?: ChildRetry;
  /** Open questions, oldest first. */
  questions: { questionId: string; question: string; askedAt: number }[];
  /** The oldest question that waits for the parent agent's answer or escalation. The child does nothing until then. */
  waitingForParent?: { questionId: string; askedAt: number };
}
