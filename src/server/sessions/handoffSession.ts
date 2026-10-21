import { join } from "node:path";
import type { HandoffState } from "./handoffSessionTool.js";

export const HANDOFF_LIFECYCLE_CUSTOM_TYPE = "forgerie.handoff.lifecycle";
export const HANDOFF_STATUS_CUSTOM_TYPE = "forgerie.handoff.status";

export interface HandoffLifecycleContext {
  handoffId: string;
  sourceSessionId: string;
  sourceLeafId?: string;
  destinationSessionId?: string;
  cwd?: string;
  focus?: string;
  requestedAt: string;
}

export interface HandoffPreparationContext extends HandoffLifecycleContext {
  destinationSessionId: string;
  cwd: string;
  /** The full source branch as JSON. Large; for looking up single entries. */
  sourceSnapshotFile: string;
  /** The server-written readable digest of the same branch. The agent reads this first. */
  sourceDigestFile: string;
}

export interface HandoffTransition extends HandoffLifecycleContext {
  version: 1;
  state: HandoffState;
  at: string;
  error?: string;
}

export function handoffTransition(context: HandoffLifecycleContext, state: HandoffState, at: string, error?: string): HandoffTransition {
  return {
    version: 1,
    ...context,
    state,
    at,
    ...(error === undefined ? {} : { error }),
  };
}

export function handoffPreparationPrompt(context: HandoffPreparationContext): string {
  const focus = context.focus === undefined || context.focus.trim() === ""
    ? "Continue the source session's current work."
    : `Continuation focus: ${context.focus.trim()}`;
  const leaf = context.sourceLeafId === undefined ? "" : `\nSource cutoff leaf: ${context.sourceLeafId}`;
  return `Detached handoff ${context.handoffId} is preparing this destination session.
Source session: ${context.sourceSessionId}${leaf}

Read the source digest first:
${context.sourceDigestFile}
It is the source branch as readable Markdown: user messages and assistant replies, with tool traffic reduced to one line per call. The end of the digest holds the most recent and most relevant work. Read it with the read tool, starting from the end if it is long.

The raw branch is at:
${context.sourceSnapshotFile}
It is a large JSON file. Do not read it whole or write scripts to extract it. Each [n] in the digest is an index into its \`branch\` array. Look up a single entry only when the digest clips something the next step depends on, for example: jq '.branch[n]' <file>.

${focus}

Reconstruct only the context needed to continue. Check the workspace only for facts the next step depends on, such as git status and recent commits. Refer to durable plans, commits, diffs, and documents by path instead of copying them. Write a compact handoff document to this exact path:
${join(context.cwd, handoffDocumentPath(context))}
Include current state, decisions that must not be reopened without new evidence, next steps, relevant artifact paths, and useful skills.

Do not continue the underlying work in this turn. Finish after the handoff document is ready.`;
}

export function handoffContinuationPrompt(context: HandoffPreparationContext): string {
  const focus = context.focus === undefined || context.focus.trim() === ""
    ? "Continue the work described there."
    : `Continue with this focus: ${context.focus.trim()}`;
  return `Continue the work from the prepared handoff at .pi-web/handoffs/${context.handoffId}.md.

${focus}`;
}

export function handoffDocumentPath(context: Pick<HandoffPreparationContext, "cwd" | "handoffId">): string {
  return `.pi-web/handoffs/${context.handoffId}.md`;
}

export function handoffStatusContent(state: "preparing" | "ready" | "failed" | "continuation-failed", error?: string): string {
  if (state === "preparing") return "Preparing handoff context from the source session.";
  if (state === "ready") return "Handoff context is ready. Continuing the work now.";
  if (state === "continuation-failed") return `Handoff context is ready, but continuation delivery failed${error === undefined ? "." : `: ${error}`}`;
  return `Handoff preparation failed${error === undefined ? "." : `: ${error}`}`;
}
