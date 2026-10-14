import { RISK_LABEL_ENTRY_KIND } from "../../shared/riskLabels.js";
import { PROCESS_EVENTS_KIND, processEventText } from "./durableProcessEvents.js";
/**
 * Write entries that Forgerie appends to a parent transcript for the reader, not the model: a child's question,
 * the user's answer, a steer, a workflow stop, and a workflow proposal. The transcript shows them as cards.
 */
import { childEntryText, isChildEntryKind } from "./durableChildAgents.js";
import { isWorkflowEntryKind, workflowEntryText } from "./durableWorkflowRuns.js";

import { GATED_ACTION_ENTRY_KIND } from "../../shared/gatedActions.js";

export const isHostEntryKind = (kind: string): boolean => kind === RISK_LABEL_ENTRY_KIND || kind === PROCESS_EVENTS_KIND || kind === GATED_ACTION_ENTRY_KIND || isChildEntryKind(kind) || isWorkflowEntryKind(kind);
export const hostEntryText = (kind: string, data: unknown): string => kind === RISK_LABEL_ENTRY_KIND ? "Risk opinion (not approval)" : kind === PROCESS_EVENTS_KIND ? processEventText(data) : kind === GATED_ACTION_ENTRY_KIND ? `Gated action: ${JSON.stringify(data)}` : isWorkflowEntryKind(kind) ? workflowEntryText(kind, data) : childEntryText(kind, data);
