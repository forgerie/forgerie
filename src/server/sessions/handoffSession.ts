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
  sourceSnapshotFile: string;
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

Read the private branch snapshot at:
${context.sourceSnapshotFile}
Source session: ${context.sourceSessionId}${leaf}

${focus}

Reconstruct only the context needed to continue. Read the snapshot in bounded chunks and follow its references to durable plans, commits, diffs, and documents instead of copying them. Write a compact handoff document to .pi-web/handoffs/${context.handoffId}.md in this workspace. Include current state, decisions that must not be reopened without new evidence, next steps, relevant artifact paths, and useful skills.

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
