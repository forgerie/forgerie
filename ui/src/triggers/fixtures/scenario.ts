// What a part or the capture page hands the triggers shapes besides the triggers themselves:
// a fixed clock, project names, and folder, workflow, and model reads answered from fixtures.
import { destinationLabel } from "../../newSession";
import type { TriggerRowActions } from "../TriggerRow";
import type { TriggerPageActions } from "../TriggerPage";
import type { WordClock } from "../triggerWords";
import { HOST_ZONE, models, NOW, projects, workflows } from "./triggers";

export const clock: WordClock = { now: NOW, locale: "en-US", browserZone: HOST_ZONE, hostZone: HOST_ZONE };
export const projectLabel = (cwd: string) => destinationLabel(cwd, projects);
export const folders = {
  list: async () => projects,
  workspaces: async (projectId: string) => projects.filter((project) => project.id === projectId)
    .map((project) => ({ id: `${project.id}-main`, path: project.path, label: project.name, isMain: true })),
};
export const listModels = async () => models;
export const ready = { type: "ready" as const, workflows };
export const ZONES = ["America/Denver", "America/New_York", "America/Los_Angeles", "Europe/Berlin", "Europe/London", "Asia/Tokyo", "UTC"];

const nothing = () => undefined;
export const rowActions: TriggerRowActions = {
  onOpen: nothing, onEdit: nothing, onAcknowledge: nothing, onPause: nothing, onResume: nothing, onRunNow: nothing, onDelete: nothing, onOpenSession: nothing,
};
export const pageActions: TriggerPageActions = {
  onDraft: nothing, onSave: nothing, onDiscard: nothing, onBack: nothing, onClose: nothing, onRetry: nothing, onReload: nothing,
  onRunNow: nothing, onPause: nothing, onResume: nothing, onAcknowledge: nothing, onDelete: nothing, onCopyId: nothing, onOpenSession: nothing,
};
