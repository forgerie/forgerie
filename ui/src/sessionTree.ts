import { z } from "zod";
import { sessionSchema } from "./contracts";

/** Wire contract for `/tree`. Mirrors `SessionTree*` in the server's `src/shared/apiTypes.ts`. */
export const sessionTreeNodeKindSchema = z.enum(["user", "assistant", "tool-result", "bash", "custom-message", "compaction",
  "branch-summary", "model-change", "thinking-level-change", "session-info", "label", "custom", "other"]);
export type SessionTreeNodeKind = z.infer<typeof sessionTreeNodeKindSchema>;
export const sessionTreeNodeSchema = z.object({
  id: z.string(), parentId: z.string().nullable(),
  // A kind this client does not know yet still shows, as "other".
  kind: sessionTreeNodeKindSchema.catch("other"),
  summary: z.string(), timestamp: z.string().optional(), label: z.string().optional(),
});
export type SessionTreeNode = z.infer<typeof sessionTreeNodeSchema>;
export const sessionTreeSnapshotSchema = z.object({
  /** Pre-order, parent-linked projection of all retained roots and descendants. */
  nodes: z.array(sessionTreeNodeSchema),
  activeLeafId: z.string().nullable(),
  activePathIds: z.array(z.string()),
});
export type SessionTreeSnapshot = z.infer<typeof sessionTreeSnapshotSchema>;

export type SessionTreeSummaryChoice = { mode: "none" } | { mode: "default" } | { mode: "custom"; instructions: string };
export const SESSION_TREE_CUSTOM_INSTRUCTIONS_MAX_LENGTH = 10_000;
/** The server's prefix for an assistant turn that only called tools. */
export const SESSION_TREE_TOOL_CALL_SUMMARY_PREFIX = "Tool call: ";

export const treeNavigateResultSchema = z.union([
  z.object({ cancelled: z.literal(false), editorText: z.string().optional() }),
  z.object({ cancelled: z.literal(true), aborted: z.boolean().optional() }),
]);
export type TreeNavigateResult = z.infer<typeof treeNavigateResultSchema>;
/** A user entry forks "before" itself, so its text returns as the new session's draft. */
export const treeForkResultSchema = z.union([
  z.object({ cancelled: z.literal(false), session: sessionSchema, promptDraft: z.string().optional() }),
  z.object({ cancelled: z.literal(true) }),
]);
export type TreeForkResult = z.infer<typeof treeForkResultSchema>;

export type TreeNotice = { tone: "status" | "error"; message: string };
/** What the open navigator is doing. Only `idle` accepts a new action or a close. */
export type TreeOperation =
  | { type: "idle"; notice?: TreeNotice }
  | { type: "continuing"; summarizing: boolean; aborting: boolean; notice?: TreeNotice }
  | { type: "forking" };
export type TreeNavigator = { type: "closed" } | { type: "open"; tree: SessionTreeSnapshot; operation: TreeOperation };
export const closedTree: TreeNavigator = { type: "closed" };

/** What the caller applies after a successful action. The navigator is already closed. */
export type TreeOutcome =
  | { type: "continued"; editorText: string }
  | { type: "forked"; session: z.infer<typeof sessionSchema>; promptDraft?: string }
  | { type: "unchanged" };

export function openTree(tree: SessionTreeSnapshot): TreeNavigator {
  return { type: "open", tree, operation: { type: "idle" } };
}

/** Pure transition for a finished navigate request. */
export function afterNavigate(result: TreeNavigateResult): { outcome: TreeOutcome; notice?: TreeNotice } {
  if (!result.cancelled) return { outcome: { type: "continued", editorText: result.editorText ?? "" } };
  return { outcome: { type: "unchanged" }, notice: { tone: "status", message: result.aborted === true
    ? "Summarization cancelled. The session did not move."
    : "Navigation cancelled. The session did not move." } };
}

export function afterFork(result: TreeForkResult): { outcome: TreeOutcome; notice?: TreeNotice } {
  if (!result.cancelled) return { outcome: { type: "forked", session: result.session,
    ...(result.promptDraft === undefined ? {} : { promptDraft: result.promptDraft }) } };
  return { outcome: { type: "unchanged" }, notice: { tone: "status", message: "Fork cancelled. No new session was created." } };
}

/** Replace the open navigator's operation; a closed navigator stays closed. */
export function withOperation(navigator: TreeNavigator, operation: TreeOperation): TreeNavigator {
  return navigator.type === "open" ? { ...navigator, operation } : navigator;
}
