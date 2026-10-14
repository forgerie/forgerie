// What a part or the capture page hands the triggers shapes besides the triggers themselves:
// a fixed clock, project names, and folder, workflow, and model reads answered from fixtures.
import { destinationLabel } from "../../newSession";
import type { TriggerRowActions } from "../TriggerRow";
import type { TriggerPageActions } from "../TriggerPage";
import type { WordClock } from "../triggerWords";
import type { WorkflowsLoad } from "../TriggerForm";
import { draftProblems, type DraftProblems, type TriggerDraft } from "../triggerDraft";
import { workflowGap } from "../triggerTargets";
import { commonWorkflows, HOST_ZONE, models, NOW, projects } from "./triggers";

export const clock: WordClock = { now: NOW, locale: "en-US", browserZone: HOST_ZONE, hostZone: HOST_ZONE };
export const projectLabel = (cwd: string) => destinationLabel(cwd, projects);
/** The registered projects, read. */
export const folders = { type: "ready" as const, projects };
export const listModels = async () => models;

export const ZONES = ["America/Denver", "America/New_York", "America/Los_Angeles", "Europe/Berlin", "Europe/London", "Asia/Tokyo", "UTC"];

const nothing = () => undefined;
export const rowActions: TriggerRowActions = {
  onOpen: nothing, onEdit: nothing, onAcknowledge: nothing, onPause: nothing, onResume: nothing, onRunNow: nothing, onDelete: nothing, onOpenSession: nothing,
};
export const pageActions: TriggerPageActions = {
  onDraft: nothing, onSave: nothing, onDiscard: nothing, onBack: nothing, onClose: nothing, onRetry: nothing, onReload: nothing,
  onRunNow: nothing, onPause: nothing, onResume: nothing, onAcknowledge: nothing, onDelete: nothing, onCopyId: nothing, onOpenSession: nothing,
};
/** What the binding derives from a draft: the shared workflows and the draft's problems, a gap in the workflow included. */
export function draftScenario(draft: TriggerDraft): { workflows: WorkflowsLoad; problems: DraftProblems } {
  const common = commonWorkflows(draft.targets);
  const workflow = common.workflows.find((item) => item.name === draft.workflow);
  return { workflows: { type: "ready", ...common }, problems: draftProblems(draft, workflow, workflowGap(draft.workflow, common, projectLabel)) };
}
