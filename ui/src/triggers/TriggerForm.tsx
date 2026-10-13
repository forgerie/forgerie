import { useRef, useState } from "react";
import { WorkflowIcon } from "lucide-react";
import type { TriggerWorkflow } from "@shared/triggers";
import { PropertyList } from "../ui/PropertyList";
import { FormLock } from "../ui/FormLock";
import { SettingsField } from "../ui/settings/SettingsField";
import { DestinationPicker } from "../ui/DestinationPicker";
import { OptionPicker } from "../ui/OptionPicker";
import { ToggleGroup } from "../ui/ToggleGroup";
import { TimeField } from "../ui/TimeField";
import { ModelPicker, type ModelBinding, type PickerOpen } from "../ui/ModelPicker";
import { TextButton } from "../ui/TextButton";
import { PageSection } from "../ui/PageSection";
import { ProblemList } from "../ui/ProblemList";
import { WorkflowInputFields } from "../workflows/WorkflowInputFields";
import { thinkingLevelsFor, type Project, type Workspace } from "../newSession";
import type { SessionModel } from "../contracts";
import { RUN_LATE_CHOICES } from "./triggersModel";
import { thinkingLevelOf } from "./triggerWire";
import { inputFields, type DraftProblems, type TriggerDraft } from "./triggerDraft";
import { clockChangeHint, zoneLabel, DAY_SHORT, graceWords, runLateHint, WEEK, type Weekday } from "./triggerWords";

/** The project's saved workflows, as the server lists them for a folder. */
export type WorkflowsLoad = { type: "loading" } | { type: "ready"; workflows: readonly TriggerWorkflow[] } | { type: "failed"; message: string };

const modelOf = (spec: string | undefined): SessionModel | undefined => {
  if (!spec) return undefined;
  const slash = spec.indexOf("/");
  return slash > 0 ? { provider: spec.slice(0, slash), id: spec.slice(slash + 1) } : undefined;
};

/**
 * Shape: what a trigger does and when, as a short property list: the project
 * and workflow, the days and time in a zone, the model, and how late a run may
 * start. The workflow's inputs follow at full width. Each problem shows under
 * its field.
 */
export function TriggerForm({ draft, onDraft, problems, disabled, hostZone, timezones, projectLabel, projects, workflows, listModels, locale }: {
  draft: TriggerDraft; onDraft: (draft: TriggerDraft) => void;
  problems: DraftProblems; disabled: boolean;
  /** The daemon host's zone, the default for a new schedule. */
  hostZone: string;
  /** Every zone the server accepts. */
  timezones: readonly string[];
  projectLabel: string;
  projects: { list: (signal: AbortSignal) => Promise<Project[]>; workspaces: (projectId: string, signal: AbortSignal) => Promise<Workspace[]> };
  workflows: WorkflowsLoad;
  listModels: (signal: AbortSignal) => Promise<SessionModel[]>;
  locale?: string | undefined;
}) {
  const modelAnchor = useRef<HTMLDivElement>(null);
  const [modelOpen, setModelOpen] = useState<PickerOpen>();
  const set = (change: Partial<TriggerDraft>) => onDraft({ ...draft, ...change });
  const listed = workflows.type === "ready" ? workflows.workflows : [];
  const workflow = listed.find((item) => item.name === draft.workflow);
  const fields = inputFields(workflow, draft);
  const model = modelOf(draft.model);
  const modelBinding: ModelBinding = {
    model, thinkingLevel: draft.thinkingLevel, disabled, emptyLabel: "Default for new sessions",
    listModels, listThinkingLevels: async () => thinkingLevelsFor(model),
    onModel: async (provider, id) => set({ model: `${provider}/${id}` }),
    onThinkingLevel: async (level) => set({ thinkingLevel: thinkingLevelOf(level) }),
  };
  const workflowStatus = workflows.type === "loading" ? { tone: "status" as const, text: "Reading the project's workflows…" }
    : workflows.type === "failed" ? { tone: "alert" as const, text: `Could not read the project's workflows: ${workflows.message}` }
    : listed.length === 0 ? { tone: "status" as const, text: "This project has no saved workflows. Add one in Settings, under Skills and prompts." } : undefined;
  const lateChoices = RUN_LATE_CHOICES.includes(draft.grace as (typeof RUN_LATE_CHOICES)[number]) ? [...RUN_LATE_CHOICES] : [...RUN_LATE_CHOICES, draft.grace].sort((a, b) => a - b);
  // While a save is in flight every control is locked, so nothing typed during the request is lost when it lands.
  return <FormLock locked={disabled}>
    <PropertyList label="Trigger settings">
      <SettingsField label="Project" hint="Each run starts a new session in this folder." problem={problems.project}>
        <DestinationPicker binding={{ cwd: draft.cwd, label: draft.cwd ? projectLabel : "Choose a project", lead: "Runs in", disabled,
          listProjects: projects.list, listWorkspaces: projects.workspaces,
          onChoose: (cwd) => { if (cwd !== draft.cwd) set({ cwd, workflow: "", inputs: {} }); } }} />
      </SettingsField>
      <SettingsField label="Workflow" problem={problems.workflow} hint={!draft.cwd ? "Choose a project to see its workflows." : workflow ? workflow.hasLandStop
        ? "Ends at a land stop, so each run waits for you to land it."
        : "This workflow has no land stop. Its runs do not wait for your review." : undefined}>
        <OptionPicker label="Workflow" value={draft.workflow || undefined} placeholder="Choose a workflow" search="Find a workflow"
          icon={<WorkflowIcon aria-hidden size={14} />} disabled={disabled || !draft.cwd} status={workflowStatus}
          options={listed.map((item) => ({ id: item.name, name: item.name, current: item.name === draft.workflow, blocked: item.kind === "script",
            details: item.kind === "script" ? ["Scripts cannot run on a schedule"] : item.description ? [item.description] : undefined }))}
          onChoose={(name) => set({ workflow: name, inputs: {} })} />
      </SettingsField>
      <SettingsField label="Repeat">
        <ToggleGroup label="Repeat" value={draft.repeat} onChange={(repeat) => set({ repeat })}
          options={[{ value: "daily", label: "Every day" }, { value: "days", label: "Some days" }]} />
      </SettingsField>
      {draft.repeat === "days" ? <SettingsField label="Days" problem={problems.days}>
        <ToggleGroup multiple label="Days" value={draft.days} onChange={(days) => set({ days })}
          options={WEEK.map((day: Weekday) => ({ value: day, label: DAY_SHORT[day] }))} />
      </SettingsField> : null}
      <SettingsField label="Time" hint={clockChangeHint(draft.at)} problem={problems.time}>
        <TimeField label="Time" value={draft.at} disabled={disabled} onChange={(at) => set({ at })} />
      </SettingsField>
      <SettingsField label="Time zone" problem={problems.timezone}
        hint={draft.timezone !== hostZone ? `Forgerie's host uses ${hostZone}.` : undefined}>
        <OptionPicker label="Time zone" value={zoneLabel(draft.timezone)} placeholder="Choose a time zone" search="Find a time zone" disabled={disabled}
          options={(timezones.includes(draft.timezone) ? timezones : [draft.timezone, ...timezones]).map((zone) =>
            ({ id: zone, name: zoneLabel(zone), current: zone === draft.timezone, ...zone === hostZone ? { variant: "host" } : {} }))}
          onChoose={(timezone) => set({ timezone, zoneChosen: true })} />
      </SettingsField>
      <SettingsField label="Model" problem={problems.model}>
        <div ref={modelAnchor}>
          <ModelPicker binding={modelBinding} anchor={modelAnchor} open={modelOpen} onOpenChange={setModelOpen} />
          {draft.model && !disabled ? <TextButton label="Use the default" onPress={() => set({ model: undefined, thinkingLevel: undefined })} /> : null}
        </div>
      </SettingsField>
      <SettingsField label="Run late" hint={runLateHint(draft.at, draft.grace, locale)} problem={problems.late}>
        <ToggleGroup label="Run late" value={String(draft.grace)} onChange={(value) => set({ grace: Number(value) })}
          options={lateChoices.map((minutes) => ({ value: String(minutes), label: graceWords(minutes) }))} />
      </SettingsField>
    </PropertyList>
    {fields.inputs.length > 0 ? <PageSection title="Inputs">
      <WorkflowInputFields inputs={fields.inputs} values={fields.values} onChange={(name, value) => set({ inputs: { ...draft.inputs, [name]: value } })} />
      {problems.inputs ? <div data-problem=""><ProblemList label="Input problem" problems={[problems.inputs]} /></div> : null}
    </PageSection> : null}
  </FormLock>;
}
