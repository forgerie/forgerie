import { RECAP_ENTRY_KIND, recapDataSchema, type RecapData } from "@shared/sessionRecap";
import type { PiMessage } from "../contracts";
import type { AskState } from "../ask";
import type { GatedAction } from "../gatedActions/gatedActionsModel";
import type { ChildSummary } from "../childAgents/childAgentsModel";
import type { WorkflowRun } from "../workflows/workflowsModel";
import type { WaitingItem } from "../waitingOnYou";

export type RecapRequestState = { kind: "idle" } | { kind: "writing" } | { kind: "failed"; message: string };
export type RecapArtifact = { recap: RecapData };
export function recapOf(message: PiMessage): RecapData | undefined {
  if (message.role !== "custom" || message.customType !== RECAP_ENTRY_KIND) return undefined;
  // SDK projections add their own identity stamps; only the declared recap fields belong to the card.
  return recapDataSchema.safeParse(message.details).data;
}
/** The text a reader sees. A legacy recap shrinks to its goal and next step. */
export function recapSummary(data: RecapData): string {
  if ("summary" in data) return data.summary;
  const sentence = (text: string) => /[.!?]$/u.test(text) ? text : `${text}.`;
  return [data.goal, data.next].flatMap(part => part === null ? [] : [sentence(part)]).join(" ");
}
/** One quiet line of provenance under the note; the note itself carries the content. */
export function recapSource(data: RecapData): string {
  return `Written by ${data.model} from the last ${data.messageCount} messages.`;
}

/** Reader obligations come from the existing live stores, never the recap writer. */
export function recapNeeds(input: { ask: AskState; waiting: readonly WaitingItem[]; records?: readonly GatedAction[] | undefined;
  children: readonly ChildSummary[]; runs: readonly WorkflowRun[] }): string {
  const items = new Map<string, string>();
  for (const item of input.waiting) {
    if (item.kind === "gated") items.set(`g:${item.entry.id}`, `Approve ${item.entry.description}`);
    if (item.kind === "question") items.set(`q:${item.entry.questionId}`, `${item.entry.childName}: ${item.entry.question}`);
    if (item.kind === "stop") items.set(`s:${item.entry.runId}/${item.entry.stage}`, `${item.entry.stageName}: ${item.entry.summary}`);
  }
  for (const record of input.records ?? []) if (record.state.kind === "waiting") items.set(`g:${record.id}`, `Approve ${record.description}`);
  for (const child of input.children) for (const question of child.questions) items.set(`q:${question.questionId}`, `${child.name}: ${question.question}`);
  for (const run of input.runs) {
    if (run.state.kind !== "running") continue;
    for (const [stage, stop] of Object.entries(run.stops ?? {})) if (stop.state === "waiting" && !items.has(`s:${run.id}/${stage}`)) {
      items.set(`s:${run.id}/${stage}`, `Decide at ${run.stages?.find(item => item.id === stage)?.name ?? stage}`);
    }
    if (run.stall?.state === "flagged") items.set(`stall:${run.id}`, `Resolve ${run.stall.child}: ${run.stall.error}`);
  }
  if (input.ask.type === "open") items.set("ask", "Answer the open question form.");
  return [...items.values()].join("\n\n");
}
