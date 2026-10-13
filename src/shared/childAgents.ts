import type { ChildRetry } from "./childRetry.js";
import type { ChildWorktreeSummary } from "./sessionWorktree.js";

/** One item returned by GET /sessions/:id/children. */
export interface DurableChildSummary {
  name: string;
  conversationId: number;
  agent: string | null;
  busy: boolean;
  createdAt: number;
  worktree?: ChildWorktreeSummary;
  retry?: ChildRetry;
  /** Open questions, oldest first. */
  questions: { questionId: string; question: string; askedAt: number }[];
}
