// The trigger form as data: a draft, its problems, and the request it becomes.
// Pure. The page holds a draft; nothing reaches the server until Save or Create.
import { DEFAULT_MISSED_GRACE_MINUTES, type Trigger, type TriggerAction, type TriggerCreate, type TriggerUpdate, type TriggerWorkflow } from "@shared/triggers";
import { launchInputs, proposalInputs, type WorkflowInput } from "../workflows/workflowsModel";
import { scheduleDays, scheduleOf } from "./triggerWords";
import { thinkingLevelOf, WEEK, wireThinkingLevel, type ThinkingLevel, type Weekday } from "./triggerWire";

export interface TriggerDraft {
  name: string;
  cwd: string;
  workflow: string;
  repeat: "daily" | "days";
  days: Weekday[];
  at: string;
  timezone: string;
  /** The reader picked the zone, so the host's zone arriving later does not replace it. */
  zoneChosen: boolean;
  /** `provider/model-id`, or absent for the new-session default. */
  model?: string | undefined;
  thinkingLevel?: ThinkingLevel | undefined;
  grace: number;
  /** Typed input values, as text until the request reads them. */
  inputs: Record<string, string>;
}

/** A new trigger: every night at 3:00 AM in the host's zone, run late up to 6 hours. */
export function emptyDraft(timezone: string, cwd = ""): TriggerDraft {
  return { name: "", cwd, workflow: "", repeat: "daily", days: [...WEEK], at: "03:00", timezone, zoneChosen: false, grace: DEFAULT_MISSED_GRACE_MINUTES, inputs: {} };
}

export function draftOf(trigger: Trigger): TriggerDraft {
  const days = scheduleDays(trigger.schedule);
  return {
    name: trigger.name, cwd: trigger.action.cwd, workflow: trigger.action.workflow,
    repeat: trigger.schedule.kind === "daily" ? "daily" : "days", days, at: trigger.schedule.at, timezone: trigger.schedule.timezone, zoneChosen: true,
    model: trigger.action.model, thinkingLevel: thinkingLevelOf(trigger.action.thinkingLevel), grace: trigger.missedGraceMinutes,
    inputs: Object.fromEntries(Object.entries(trigger.action.inputs).map(([name, value]) => [name, String(value)])),
  };
}

/** The input fields a workflow asks for, task first, with any saved value it does not declare after them. */
export function inputFields(workflow: TriggerWorkflow | undefined, draft: TriggerDraft): { inputs: [string, WorkflowInput][]; values: Record<string, string> } {
  const declared = workflow?.inputs ?? {};
  const { inputs, values } = proposalInputs({ definition: { inputs: declared }, inputs: draft.inputs });
  return { inputs, values: { ...values, ...draft.inputs } };
}

export type DraftField = "name" | "project" | "workflow" | "days" | "time" | "timezone" | "model" | "late" | "inputs";
export type DraftProblems = Partial<Record<DraftField, string>>;
/** The order problems are listed and focused in: the page's order. */
export const FIELD_ORDER: readonly DraftField[] = ["name", "project", "workflow", "days", "time", "timezone", "model", "late", "inputs"];

/**
 * What stops the draft from saving, checked in the browser before any request.
 * `workflow` is the chosen workflow as the project lists it; undefined while the list is not read.
 */
export function draftProblems(draft: TriggerDraft, workflow: TriggerWorkflow | undefined): DraftProblems {
  const problems: DraftProblems = {};
  if (!draft.name.trim()) problems.name = "Give the trigger a name.";
  if (!draft.cwd) problems.project = "Choose a project.";
  if (!draft.workflow) problems.workflow = "Choose a workflow.";
  else if (workflow?.kind === "script") problems.workflow = "Scripts cannot run on a schedule. Choose a prose workflow.";
  if (draft.repeat === "days" && draft.days.length === 0) problems.days = "Choose at least one day.";
  if (workflow) {
    const typed = launchInputs({ definition: { inputs: workflow.inputs } }, inputFields(workflow, draft).values);
    if ("problem" in typed) problems.inputs = typed.problem;
  }
  return problems;
}
/** The stable DOM id of a field's row, so a page can move focus to the field a problem names. */
export const fieldDomId = (field: DraftField) => `trigger-field-${field}`;
/** The first field with a problem, in the page's order. */
export const firstProblem = (problems: DraftProblems): DraftField | undefined => FIELD_ORDER.find((field) => problems[field] !== undefined);
export const problemList = (problems: DraftProblems) => FIELD_ORDER.flatMap((field) => problems[field] ? [problems[field]] : []);

/** Which field a server's dotted path is about. */
export function fieldOf(path: string | undefined): DraftField | undefined {
  if (!path) return undefined;
  if (path === "name") return "name";
  if (path.startsWith("schedule.on")) return "days";
  if (path.startsWith("schedule.timezone")) return "timezone";
  if (path.startsWith("schedule")) return "time";
  if (path.startsWith("action.cwd")) return "project";
  if (path.startsWith("action.workflow")) return "workflow";
  if (path.startsWith("action.inputs")) return "inputs";
  if (path.startsWith("action.model") || path.startsWith("action.thinkingLevel")) return "model";
  if (path.startsWith("missedGraceMinutes")) return "late";
  return undefined;
}

function actionOf(draft: TriggerDraft, workflow: TriggerWorkflow | undefined): TriggerAction {
  // Only the values the draft holds: a declared default the reader never set stays out, so the server applies it.
  const typed = workflow ? launchInputs({ definition: { inputs: workflow.inputs } }, draft.inputs) : undefined;
  // Without the workflow's declaration, keep what was typed as text: the server checks it against the workflow.
  const inputs = typed && "inputs" in typed ? typed.inputs : Object.fromEntries(Object.entries(draft.inputs).filter(([, value]) => value.trim() !== ""));
  return { kind: "workflow", cwd: draft.cwd, workflow: draft.workflow, inputs,
    ...(draft.model ? { model: draft.model } : {}), ...(draft.thinkingLevel ? { thinkingLevel: wireThinkingLevel(draft.thinkingLevel) } : {}) };
}
const scheduleOfDraft = (draft: TriggerDraft) => scheduleOf(draft.repeat === "daily" ? WEEK : draft.days, draft.at, draft.timezone);

export function createOf(draft: TriggerDraft, workflow: TriggerWorkflow | undefined): TriggerCreate {
  return { name: draft.name.trim(), schedule: scheduleOfDraft(draft), action: actionOf(draft, workflow), missedGraceMinutes: draft.grace };
}

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const sortedInputs = (inputs: Readonly<Record<string, string>>) =>
  Object.fromEntries(Object.entries(inputs).filter(([, value]) => value !== "").sort(([a], [b]) => a.localeCompare(b)));
/** The reader changed what a run does: the project, the workflow, an input, the model, or the thinking level. */
function actionEdited(draft: TriggerDraft, saved: TriggerDraft): boolean {
  const action = (value: TriggerDraft) => ({ cwd: value.cwd, workflow: value.workflow, model: value.model ?? null, thinkingLevel: value.thinkingLevel ?? null,
    inputs: sortedInputs(value.inputs) });
  return !same(action(draft), action(saved));
}

/** Only what changed, against the revision the draft started from. */
export function updateOf(trigger: Trigger, draft: TriggerDraft, workflow: TriggerWorkflow | undefined, baseRevision: number): TriggerUpdate {
  const update: TriggerUpdate = { baseRevision };
  const name = draft.name.trim();
  if (name !== trigger.name) update.name = name;
  const schedule = scheduleOfDraft(draft);
  if (!same(schedule, scheduleOf(scheduleDays(trigger.schedule), trigger.schedule.at, trigger.schedule.timezone))) update.schedule = schedule;
  // The action goes only when one of its own fields was edited. Building it fills nothing in, but an unrelated edit
  // must not resend it: a new action re-arms the trigger on the server.
  if (actionEdited(draft, draftOf(trigger))) update.action = actionOf(draft, workflow);
  if (draft.grace !== trigger.missedGraceMinutes) update.missedGraceMinutes = draft.grace;
  return update;
}

/** The draft differs from what it started from. A zone that only followed the host is not a change. */
export function isDirty(draft: TriggerDraft, start: TriggerDraft): boolean {
  const comparable = (value: TriggerDraft) => ({ ...value, zoneChosen: false, days: value.repeat === "daily" ? [] : value.days,
    inputs: Object.fromEntries(Object.entries(value.inputs).sort(([a], [b]) => a.localeCompare(b))) });
  return !same(comparable(draft), comparable(start));
}
