/**
 * Write entries that Forgerie appends to a parent transcript for the reader, not the model: a child's question,
 * the user's answer, a steer, a workflow stop, and a workflow proposal. The transcript shows them as cards.
 */
import { childEntryText, isChildEntryKind } from "./durableChildAgents.js";
import { isWorkflowEntryKind, workflowEntryText } from "./durableWorkflowRuns.js";

export const isHostEntryKind = (kind: string): boolean => isChildEntryKind(kind) || isWorkflowEntryKind(kind);
export const hostEntryText = (kind: string, data: unknown): string => isWorkflowEntryKind(kind) ? workflowEntryText(kind, data) : childEntryText(kind, data);
