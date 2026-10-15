import { useRef, useState } from "react";
import { FolderIcon, WorkflowIcon } from "lucide-react";
import type { TriggerWorkflow, TriggerWorkflowsResponse } from "@shared/triggers";
import { PropertyList } from "../ui/PropertyList";
import { FormLock } from "../ui/FormLock";
import { SettingsField } from "../ui/settings/SettingsField";
import { ChoicePicker } from "../ui/ChoicePicker";
import { OptionPicker } from "../ui/OptionPicker";
import { ToggleGroup } from "../ui/ToggleGroup";
import { TimeField } from "../ui/TimeField";
import { ModelPicker, type ModelBinding, type PickerOpen } from "../ui/ModelPicker";
import { TextButton } from "../ui/TextButton";
import { PageSection } from "../ui/PageSection";
import { WorkflowInputFields } from "../workflows/WorkflowInputFields";
import { thinkingLevelsFor, type Project } from "../newSession";
import type { SessionModel } from "../contracts";
import { RUN_LATE_CHOICES } from "./triggersModel";
import { thinkingLevelOf } from "./triggerValues";
import { fieldDomId, inputFields, type DraftProblems, type TriggerDraft } from "./triggerDraft";
import { clockChangeHint, zoneLabel, DAY_SHORT, graceWords, runLateHint, WEEK, type Weekday } from "./triggerWords";
import { fixedCwds, gapShort, hasTargets, isSpread, targetChip, targetHint, targetNames, workflowGap, type ProjectName } from "./triggerTargets";

/** The workflows every target project can run, and why the others are left out, as the server lists them. */
export type WorkflowsLoad = { type: "loading" }
  | { type: "ready"; workflows: readonly TriggerWorkflow[]; diagnostics: TriggerWorkflowsResponse["diagnostics"] }
  | { type: "failed"; message: string };
/** The registered projects, as the session list reads them. */
export type ProjectsLoad = { type: "loading" } | { type: "ready"; projects: readonly Project[] } | { type: "failed"; message: string };

const modelOf = (spec: string | undefined): SessionModel | undefined => {
  if (!spec) return undefined;
  const slash = spec.indexOf("/");
  return slash > 0 ? { provider: spec.slice(0, slash), id: spec.slice(slash + 1) } : undefined;
};

/**
 * Shape: what a trigger does and when, as a short property list: the target
 * projects and the workflow, the days and time in a zone, the model, and how
 * late a run may start. The workflow's inputs follow at full width. Each
 * problem shows under its field. A chosen workflow that the target projects do
 * not share stays chosen and says why at once. In a workflow file's side
 * panel (`placement="panel"`) the file is the workflow, so the form keeps only
 * the schedule's fields, with short labels, and the panel shows the inputs.
 */
export function TriggerForm({ draft, onDraft, problems, disabled, hostZone, timezones, projectName, projects, workflows, listModels, locale, placement = "page" }: {
  draft: TriggerDraft; onDraft: (draft: TriggerDraft) => void;
  problems: DraftProblems; disabled: boolean;
  /** The daemon host's zone, the default for a new schedule. */
  hostZone: string;
  /** Every zone the server accepts. */
  timezones: readonly string[];
  projectName: ProjectName;
  projects: ProjectsLoad;
  workflows: WorkflowsLoad;
  listModels: (signal: AbortSignal) => Promise<SessionModel[]>;
  locale?: string | undefined;
  placement?: "page" | "panel" | undefined;
}) {
  const panel = placement === "panel";
  const modelAnchor = useRef<HTMLDivElement>(null);
  const [modelOpen, setModelOpen] = useState<PickerOpen>();
  // The fixed list the reader had before All projects, so turning All off gives it back.
  const lastFixed = useRef<readonly string[]>(fixedCwds(draft.targets));
  const set = (change: Partial<TriggerDraft>) => onDraft({ ...draft, ...change });
  const targeted = hasTargets(draft.targets);
  const spread = isSpread(draft.targets);
  const listed = workflows.type === "ready" ? workflows.workflows : [];
  const workflow = listed.find((item) => item.name === draft.workflow);
  const gap = workflows.type === "ready" && targeted ? workflowGap(draft.workflow, workflows, projectName) : undefined;
  // Names some target project has but not every one, with why: so a missing workflow is explained, not just absent.
  const leftOut = workflows.type === "ready" ? [...new Set(workflows.diagnostics.map((item) => item.name))]
    .filter((name) => name && !listed.some((item) => item.name === name)).sort() : [];
  const roots = projects.type === "ready" ? projects.projects : [];
  // A saved target that is not a registered project's own folder, such as a worktree, stays listed so it can be unchecked.
  const saved = fixedCwds(draft.targets).filter((cwd) => !roots.some((project) => project.path === cwd));
  const choices = [...roots.map((project) => ({ id: project.path, label: project.name, detail: project.path })),
    ...saved.map((cwd) => ({ id: cwd, label: projectName(cwd), detail: cwd }))];
  const chooseCwds = (cwds: string[]) => { lastFixed.current = cwds; set({ targets: { kind: "projects", cwds } }); };
  const chooseAll = (on: boolean) => set({ targets: on ? { kind: "all" } : { kind: "projects", cwds: [...lastFixed.current] } });
  const fields = inputFields(workflow, draft);
  const model = modelOf(draft.model);
  const modelBinding: ModelBinding = {
    model, thinkingLevel: draft.thinkingLevel, disabled, emptyLabel: "Default for new sessions",
    listModels, listThinkingLevels: async () => thinkingLevelsFor(model),
    onModel: async (provider, id) => set({ model: `${provider}/${id}` }),
    onThinkingLevel: async (level) => set({ thinkingLevel: thinkingLevelOf(level) }),
  };
  const whose = spread ? "the projects'" : "the project's";
  const workflowStatus = workflows.type === "loading" ? { tone: "status" as const, text: `Reading ${whose} workflows…` }
    : workflows.type === "failed" ? { tone: "alert" as const, text: `Could not read ${whose} workflows: ${workflows.message}` }
    : listed.length > 0 ? undefined
    : spread ? { tone: "status" as const, text: "No workflow is common to these projects. A global workflow, in Settings under Skills and prompts, runs in every project." }
    : { tone: "status" as const, text: "This project has no saved workflows. Add one in Settings, under Skills and prompts." };
  const landWords = workflow ? workflow.hasLandStop ? spread ? "Ends at a land stop, so each project's run waits for you to land it."
    : "Ends at a land stop, so each run waits for you to land it." : "This workflow has no land stop. Its runs do not wait for your review." : undefined;
  const workflowHint = !targeted ? "Choose a project to see its workflows."
    : [gap ? undefined : landWords, spread ? "Only workflows every target project can run are listed. Global workflows run in every project." : undefined]
      .filter(Boolean).join(" ") || undefined;
  const projectsLegend = projects.type === "loading" ? "Reading projects…" : projects.type === "failed" ? `Could not read projects: ${projects.message}` : "Projects";
  const lateChoices = RUN_LATE_CHOICES.includes(draft.grace as (typeof RUN_LATE_CHOICES)[number]) ? [...RUN_LATE_CHOICES] : [...RUN_LATE_CHOICES, draft.grace].sort((a, b) => a - b);
  // While a save is in flight every control is locked, so nothing typed during the request is lost when it lands.
  return <FormLock locked={disabled}>
    <PropertyList label={panel ? "Schedule settings" : "Trigger settings"} narrow={panel}>
      <SettingsField label={panel ? "Projects" : "Project"} fieldId={fieldDomId("project")} hint={targeted ? targetHint(draft.targets) : undefined} problem={problems.project}>
        <ChoicePicker label="Target projects" lead="Runs in" icon={<FolderIcon aria-hidden size={14} />} disabled={disabled}
          value={targetChip(draft.targets, projectName)} placeholder="Choose projects" title={targeted ? targetNames(draft.targets, projectName) : undefined}
          list={{ legend: projectsLegend, choices, chosen: [...fixedCwds(draft.targets)], missing: "Project no longer registered", search: "Find a project",
            onChange: chooseCwds,
            every: { label: "All projects", detail: "Every registered project, including projects added later.", on: draft.targets.kind === "all", onChange: chooseAll } }} />
      </SettingsField>
      {panel ? null : <SettingsField label="Workflow" fieldId={fieldDomId("workflow")} problem={problems.workflow ?? gap} hint={workflowHint}>
        <OptionPicker label="Workflow" value={draft.workflow || undefined} placeholder="Choose a workflow" search="Find a workflow"
          icon={<WorkflowIcon aria-hidden size={14} />} disabled={disabled || !targeted} status={workflowStatus}
          options={[...listed.map((item) => ({ id: item.name, name: item.name, current: item.name === draft.workflow, blocked: item.kind === "script",
            details: item.kind === "script" ? ["Scripts cannot run on a schedule"] : item.description ? [item.description] : undefined })),
          ...workflows.type === "ready" ? leftOut.map((name) => ({ id: name, name, current: name === draft.workflow, blocked: true,
            details: [gapShort(name, workflows.diagnostics, projectName) ?? "Not common to every target project"] })) : []]}
          onChoose={(name) => set({ workflow: name, inputs: {} })} />
      </SettingsField>}
      <SettingsField label="Repeat">
        <ToggleGroup label="Repeat" value={draft.repeat} onChange={(repeat) => set({ repeat })}
          options={[{ value: "daily", label: "Every day" }, { value: "days", label: "Some days" }]} />
      </SettingsField>
      {draft.repeat === "days" ? <SettingsField label="Days" fieldId={fieldDomId("days")} problem={problems.days}>
        <ToggleGroup multiple label="Days" value={draft.days} onChange={(days) => set({ days })}
          options={WEEK.map((day: Weekday) => ({ value: day, label: DAY_SHORT[day] }))} />
      </SettingsField> : null}
      <SettingsField label="Time" fieldId={fieldDomId("time")} hint={clockChangeHint(draft.at)} problem={problems.time}>
        <TimeField label="Time" value={draft.at} disabled={disabled} onChange={(at) => set({ at })} />
      </SettingsField>
      <SettingsField label="Time zone" fieldId={fieldDomId("timezone")} problem={problems.timezone}
        hint={draft.timezone !== hostZone ? `Forgerie's host uses ${hostZone}.` : undefined}>
        <OptionPicker label="Time zone" value={zoneLabel(draft.timezone)} placeholder="Choose a time zone" search="Find a time zone" disabled={disabled}
          options={(timezones.includes(draft.timezone) ? timezones : [draft.timezone, ...timezones]).map((zone) =>
            ({ id: zone, name: zoneLabel(zone), current: zone === draft.timezone, ...zone === hostZone ? { variant: "host" } : {} }))}
          onChoose={(timezone) => set({ timezone, zoneChosen: true })} />
      </SettingsField>
      <SettingsField label="Model" fieldId={fieldDomId("model")} problem={problems.model}>
        <div ref={modelAnchor}>
          <ModelPicker binding={modelBinding} anchor={modelAnchor} open={modelOpen} onOpenChange={setModelOpen} />
          {draft.model && !disabled ? <TextButton label="Use the default" onPress={() => set({ model: undefined, thinkingLevel: undefined })} /> : null}
        </div>
      </SettingsField>
      <SettingsField label="Run late" fieldId={fieldDomId("late")} hint={runLateHint(draft.at, draft.grace, locale)} problem={problems.late}>
        <ToggleGroup label="Run late" value={String(draft.grace)} onChange={(value) => set({ grace: Number(value) })}
          options={lateChoices.map((minutes) => ({ value: String(minutes), label: graceWords(minutes) }))} />
      </SettingsField>
    </PropertyList>
    {!panel && (fields.inputs.length > 0 || problems.inputs) ? <PageSection title="Inputs" fieldId={fieldDomId("inputs")} problem={problems.inputs}>
      <WorkflowInputFields inputs={fields.inputs} values={fields.values} onChange={(name, value) => set({ inputs: { ...draft.inputs, [name]: value } })} />
    </PageSection> : null}
  </FormLock>;
}
