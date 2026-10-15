// The trigger as a workflow file, as data: the side panel's draft, the schedule block a save writes, and the words of
// the file's states. Pure. The page holds the file's text and the panel's draft; nothing reaches the server until Save.
import type { Trigger } from "@shared/triggers";
import {
  DEFAULT_LATE, lateMinutes, lateText,
  type TriggerFileDocument, type TriggerFileSaveRequest, type TriggerFileState, type TriggerFileVersion, type WorkflowScheduleBlock,
} from "@shared/triggerFiles";
import { nextOccurrence } from "@shared/triggerSchedules";
import type { WorkflowDefinition } from "@shared/workflowRuns";
import type { Project } from "../newSession";
import type { RouteListStep } from "../ui/RouteList";
import type { WorkflowInput } from "../workflows/workflowsModel";
import type { FileTrigger } from "./triggersApi";
import { draftOf, isDirty, type TriggerDraft } from "./triggerDraft";
import { thinkingLevelOf, WEEK, type Weekday } from "./triggerValues";
import { scheduleOf, scheduleWords, timeOfDay, zoneWords, type WordClock } from "./triggerWords";
import { targetSummary, targetsKey, type ProjectName } from "./triggerTargets";

type BlockDays = NonNullable<WorkflowScheduleBlock["days"]>;
/**
 * Days as the block's type holds them. The contract builds its weekday union from `WEEKDAYS.map(...)`, which TypeBox
 * reads as an array, not a tuple, so the static type of `days` is `never[]` although the schema accepts weekday names.
 * The values here are weekday names; the cast only bridges that typing gap.
 */
const blockDays = (days: readonly Weekday[]): BlockDays => [...days] as unknown as BlockDays;
const daysOfBlock = (days: BlockDays | undefined): readonly string[] | undefined => days as readonly string[] | undefined;

/** The file a trigger reads its settings from, when the server says. */
export const fileOf = (trigger: Trigger): TriggerFileState | undefined => (trigger as FileTrigger).file;
/** "nightly-maintenance.md". */
export const fileName = (path: string) => path.split("/").filter(Boolean).at(-1) ?? path;

/** The side panel: the trigger form's schedule fields, and whether the schedule is paused. The workflow is the file. */
export interface ScheduleDraft extends TriggerDraft { paused: boolean }

/** `provider/model-id:level` split into the model and a thinking level this app knows. */
function modelParts(spec: string | undefined): Pick<TriggerDraft, "model" | "thinkingLevel"> {
  if (!spec) return { model: undefined, thinkingLevel: undefined };
  const colon = spec.lastIndexOf(":");
  const level = colon > 0 ? thinkingLevelOf(spec.slice(colon + 1)) : undefined;
  return level ? { model: spec.slice(0, colon), thinkingLevel: level } : { model: spec, thinkingLevel: undefined };
}
const modelSpec = (draft: Pick<TriggerDraft, "model" | "thinkingLevel">) =>
  draft.model ? `${draft.model}${draft.thinkingLevel ? `:${draft.thinkingLevel}` : ""}` : undefined;

/**
 * What the side panel starts from: the file's `schedule:` block when the server could read it, else the settings that
 * run now. The projects come from the trigger, where the server has already turned names into folders.
 */
export function scheduleDraftOf(trigger: Trigger, document: TriggerFileDocument | undefined, hostZone: string): ScheduleDraft {
  const running: ScheduleDraft = { ...draftOf(trigger), workflow: "", paused: trigger.state.kind === "paused" };
  const block = document?.schedule;
  if (!block) return running;
  const listed = daysOfBlock(block.days);
  const days = listed ? WEEK.filter((day) => listed.includes(day)) : [...WEEK];
  return {
    ...running, ...modelParts(block.model),
    repeat: days.length === 7 ? "daily" : "days", days, at: block.at, timezone: block.timezone ?? hostZone, zoneChosen: true,
    grace: lateMinutes(block.late ?? DEFAULT_LATE) ?? running.grace, paused: block.paused === true,
    targets: block.projects === "all" ? { kind: "all" } : running.targets.kind === "all" ? { kind: "projects", cwds: [...block.projects] } : running.targets,
    inputs: Object.fromEntries(Object.entries(block.inputs ?? {}).map(([name, value]) => [name, String(value)])),
  };
}

/** The panel differs from where it started. */
export const settingsChanged = (draft: ScheduleDraft, start: ScheduleDraft) => draft.paused !== start.paused || isDirty(draft, start);

/** The inputs the file declares, task first, and their defaults as text. */
export function declaredInputs(definition: WorkflowDefinition | null | undefined): { inputs: [string, WorkflowInput][]; defaults: Record<string, string> } {
  const inputs = Object.entries(definition?.inputs ?? {}).sort(([a], [b]) => Number(b === "task") - Number(a === "task"));
  return { inputs, defaults: Object.fromEntries(inputs.map(([name, input]) => [name, input.default === undefined ? "" : String(input.default)])) };
}

type Overrides = NonNullable<WorkflowScheduleBlock["inputs"]>;
/**
 * The values that differ from the file's defaults, typed as the file declares them. A value the reader cleared falls
 * back to the default. A number that is not one stays as typed: the server refuses it with its own words.
 */
export function inputOverrides(definition: WorkflowDefinition | null | undefined, values: Readonly<Record<string, string>>): Overrides {
  const { inputs, defaults } = declaredInputs(definition);
  const declared = new Map(inputs);
  const result: Overrides = {};
  for (const [name, raw] of Object.entries(values).sort(([a], [b]) => a.localeCompare(b))) {
    if (raw.trim() === "" || raw === defaults[name]) continue;
    const input = declared.get(name);
    const number = Number(raw);
    result[name] = input?.type === "boolean" ? raw === "true" : input?.type === "number" && Number.isFinite(number) ? number : raw;
  }
  return result;
}

/** A project as the file names it: its registered name, else its folder. */
const projectEntry = (cwd: string, projects: readonly Project[]) => projects.find((project) => project.path === cwd)?.name ?? cwd;

/** A whole block from the panel, for a file whose block the server could not read. */
function fullBlock(trigger: Trigger, draft: ScheduleDraft, definition: WorkflowDefinition | null | undefined, projects: readonly Project[]): WorkflowScheduleBlock {
  const model = modelSpec(draft);
  const inputs = inputOverrides(definition, draft.inputs);
  return {
    name: trigger.name, at: draft.at, ...draft.repeat === "days" && draft.days.length < 7 ? { days: blockDays(WEEK.filter((day) => draft.days.includes(day))) } : {},
    timezone: draft.timezone, late: lateText(draft.grace),
    projects: draft.targets.kind === "all" ? "all" : draft.targets.cwds.map((cwd) => projectEntry(cwd, projects)),
    ...model ? { model } : {}, ...draft.paused ? { paused: true } : {}, ...Object.keys(inputs).length ? { inputs } : {},
  };
}

/**
 * The `schedule:` block a save writes: the file's own block with only the panel's changes made, so a key the reader
 * did not touch keeps its form (a project name stays a name, an omitted zone stays omitted). A file whose block the
 * server could not read gets a whole block from the panel.
 */
export function scheduleBlockOf({ trigger, document, start, draft, projects }: {
  trigger: Trigger; document: TriggerFileDocument | undefined; start: ScheduleDraft; draft: ScheduleDraft; projects: readonly Project[];
}): WorkflowScheduleBlock {
  const definition = document?.definition;
  if (!document?.schedule) return fullBlock(trigger, draft, definition, projects);
  const block: WorkflowScheduleBlock = { ...document.schedule };
  const days = (value: ScheduleDraft) => value.repeat === "daily" || value.days.length === 7 ? "daily" : WEEK.filter((day) => value.days.includes(day)).join(",");
  if (days(draft) !== days(start)) {
    if (days(draft) === "daily") delete block.days; else block.days = blockDays(WEEK.filter((day) => draft.days.includes(day)));
  }
  if (draft.at !== start.at) block.at = draft.at;
  if (draft.timezone !== start.timezone) block.timezone = draft.timezone;
  if (draft.grace !== start.grace) block.late = lateText(draft.grace);
  if (targetsKey(draft.targets) !== targetsKey(start.targets)) {
    block.projects = draft.targets.kind === "all" ? "all" : draft.targets.cwds.map((cwd) => projectEntry(cwd, projects));
  }
  if (modelSpec(draft) !== modelSpec(start)) {
    const model = modelSpec(draft);
    if (model) block.model = model; else delete block.model;
  }
  if (draft.paused !== start.paused) {
    if (draft.paused) block.paused = true; else delete block.paused;
  }
  const overrides = inputOverrides(definition, draft.inputs);
  if (JSON.stringify(overrides) !== JSON.stringify(inputOverrides(definition, start.inputs))) {
    if (Object.keys(overrides).length) block.inputs = overrides; else delete block.inputs;
  }
  return block;
}

/** The save request: the editor's text against the hash it was read at, and the block only when the panel changed. */
export function saveRequestOf(input: Parameters<typeof scheduleBlockOf>[0] & { text: string; baseSha256: string }): TriggerFileSaveRequest {
  return { text: input.text, baseSha256: input.baseSha256, ...settingsChanged(input.draft, input.start) ? { schedule: scheduleBlockOf(input) } : {} };
}

/** The `description:` of the file's front matter, when it is one line or a folded block. */
export function descriptionOf(text: string): string | undefined {
  const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text)?.[1];
  if (front === undefined) return undefined;
  const lines = front.split(/\r?\n/u);
  const at = lines.findIndex((line) => /^description:/u.test(line));
  if (at < 0) return undefined;
  const value = lines[at]?.replace(/^description:\s*/u, "").trim() ?? "";
  if (value === "" || /^[>|][-+]?$/u.test(value)) {
    const block: string[] = [];
    for (const line of lines.slice(at + 1)) { if (!/^\s+\S/u.test(line)) break; block.push(line.trim()); }
    return block.join(" ").trim() || undefined;
  }
  const quoted = /^(["'])(.*)\1$/u.exec(value);
  return (quoted ? quoted[2] : value)?.trim() || undefined;
}

/** The 1-based line where a key such as `stages` starts in the file, for Edit stages to open Source there. */
export function lineOf(text: string, key: string): number | undefined {
  const index = text.split(/\r?\n/u).findIndex((line) => new RegExp(`^\\s*${key}:`, "u").test(line));
  return index < 0 ? undefined : index + 1;
}

const DAY = 86_400_000;
const dayKey = (ms: number, zone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
/** "Today, 9:41 AM", "Yesterday, 8:02 PM", or "Oct 13, 8:02 PM", in the browser's zone. */
export function dayTimeWords(ms: number, clock: WordClock): string {
  const zone = clock.browserZone;
  const time = new Intl.DateTimeFormat(clock.locale, { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(ms);
  if (dayKey(ms, zone) === dayKey(clock.now, zone)) return `Today, ${time}`;
  if (dayKey(ms, zone) === dayKey(clock.now - DAY, zone)) return `Yesterday, ${time}`;
  return `${new Intl.DateTimeFormat(clock.locale, { timeZone: zone, month: "short", day: "numeric" }).format(ms)}, ${time}`;
}
/** "today at 9:41 AM" or "Oct 13 at 8:02 PM", inside a sentence. */
function dayTimeInline(ms: number, clock: WordClock): string {
  const [day = "", time = ""] = dayTimeWords(ms, clock).split(", ");
  return `${day === "Today" || day === "Yesterday" ? day.toLowerCase() : day} at ${time}`;
}

export const VERSION_SOURCE: Record<TriggerFileVersion["source"], string> = {
  forgerie: "Saved here", outside: "Changed outside Forgerie", migration: "Written by the upgrade",
};

/** The projects a run reaches, inside a sentence: "in all 7 projects", "in forgerie", "in every project". */
function reachWords(draft: ScheduleDraft, projectName: ProjectName): string {
  if (draft.targets.kind === "all") return "in every project";
  const count = draft.targets.cwds.length;
  if (count === 1) return `in ${projectName(draft.targets.cwds[0] ?? "")}`;
  return `in all ${String(count)} projects`;
}

/** "Fri at 2:00 AM": the next run of the panel's schedule, as the saving notice says it. */
function nextRunWords(draft: ScheduleDraft, clock: WordClock): string | undefined {
  try {
    const next = nextOccurrence(scheduleOf(draft.repeat === "daily" ? WEEK : draft.days, draft.at, draft.timezone), clock.now);
    const weekday = new Intl.DateTimeFormat(clock.locale, { timeZone: draft.timezone, weekday: "short" }).format(next);
    const zone = draft.timezone === clock.browserZone ? "" : ` ${zoneWords(draft.timezone)}`;
    return `${weekday} at ${timeOfDay(draft.at, clock.locale)}${zone}`;
  } catch { return undefined; }
}

/** What Save does, before the reader presses it. `when` is the next run, which the notice sets strong. */
export function savingWords(draft: ScheduleDraft, start: ScheduleDraft, clock: WordClock, projectName: ProjectName): { before: string; when?: string | undefined; after: string } {
  if (draft.paused) {
    return { before: start.paused ? "Saving writes the file. The trigger stays paused, so no run is due. Launches by hand read it."
      : "Saving writes the file and pauses the trigger. No run starts until you resume it. Launches by hand read the file.", after: "" };
  }
  const when = nextRunWords(draft, clock);
  if (!when) return { before: `Saving writes the file. The next run reads it ${reachWords(draft, projectName)}. Launches by hand read it too.`, after: "" };
  return { before: "Saving writes the file. The next run, ", when, after: `, reads it ${reachWords(draft, projectName)}. Launches by hand read it too.` };
}

/** The settings that run now, in a few words: "every day at 1:00 AM, 7 projects". */
function runningWords(trigger: Trigger, clock: WordClock, projectName: ProjectName): string {
  const schedule = scheduleWords(trigger.schedule, clock.hostZone, clock.locale);
  return `${schedule.charAt(0).toLowerCase()}${schedule.slice(1)}, ${targetSummary(trigger.action.targets, projectName)}`;
}

const isNight = (ms: number, zone: string) => {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", hourCycle: "h23" }).format(ms));
  return hour >= 21 || hour < 5;
};

/** The notice for a file the server cannot read as a schedule: which line, what is wrong, and what runs meanwhile. */
export function invalidWords(trigger: Trigger, file: TriggerFileState, clock: WordClock, projectName: ProjectName) {
  const line = file.problem?.line;
  const next = trigger.state.kind === "active" ? trigger.state.nextFireAt : undefined;
  const subject = next === undefined ? "When it resumes, the trigger uses"
    : next - clock.now < DAY && isNight(next, trigger.schedule.timezone) ? "Tonight's run uses" : "The next run uses";
  const saved = file.lastGoodAt === undefined ? "" : `, saved ${dayTimeInline(file.lastGoodAt, clock)}`;
  return {
    line,
    title: line === undefined ? "The file has an error." : `Line ${String(line)} of the file has an error.`,
    message: file.problem?.message ?? "Forgerie cannot read its schedule.",
    running: `${subject} the last good version${saved}: ${runningWords(trigger, clock, projectName)}.`,
  };
}

/** The notice for a file, or its schedule, that is gone. `hasText`: the file is still there, without a schedule. */
export function missingWords(trigger: Trigger, file: TriggerFileState, hasText: boolean): { title: string; text: string } {
  const runs = trigger.history.length;
  const kept = runs === 0 ? " Its run history stays." : ` Its ${runs === 1 ? "run stays" : `${String(runs)} runs stay`} under Runs.`;
  return hasText
    ? { title: "The file has no schedule now, so the trigger is paused.",
      text: `Change a setting in the side panel and save to write the schedule back, or add a schedule block in Source.${kept}` }
    : { title: "The file is gone, so the trigger is paused.",
      text: `Forgerie cannot find ${file.path}. When the file and its schedule are back, Forgerie reads them again.${kept}` };
}

/** Steps of the route, read from the file's `workflow:` block: stage names, workers with their agent and model, and stops. */
export function routeSteps(definition: WorkflowDefinition | null | undefined): RouteListStep[] {
  return (definition?.stages ?? []).map((stage, index) => {
    const stop = stage.stop === "land" ? "You land the branches" : stage.stop === "approve" ? "You approve" : undefined;
    const workers = stage.workers ?? [];
    return {
      key: stage.id, number: index + 1, name: stage.name,
      detail: workers.length > 0 ? stop : stop ?? stage.does,
      stopTone: stop === undefined ? undefined : "faint", stopLabel: stop,
      items: workers.map((worker) => ({
        key: worker.name, name: worker.name, kind: worker.agent ?? "general helper", tones: ["faint"], blocksLabel: "Not started",
        lines: worker.model ? [{ key: "model", text: worker.model }] : undefined,
      })),
    };
  });
}
