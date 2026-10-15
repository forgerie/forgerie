import type { WorkflowDefinition } from "@shared/workflowRuns";
import { FormLock } from "../ui/FormLock";
import { Lede } from "../ui/Lede";
import { PageSection } from "../ui/PageSection";
import { RouteList } from "../ui/RouteList";
import type { SessionModel } from "../contracts";
import { WorkflowInputFields } from "../workflows/WorkflowInputFields";
import { TriggerForm, type ProjectsLoad, type WorkflowsLoad } from "./TriggerForm";
import { declaredInputs, routeSteps, type ScheduleDraft } from "./triggerFile";
import type { DraftProblems } from "./triggerDraft";
import type { ProjectName } from "./triggerTargets";

/** The file is the workflow, so the panel's form chooses none. */
const NO_WORKFLOWS: WorkflowsLoad = { type: "ready", workflows: [], diagnostics: [] };

/**
 * Shape: a workflow file's front matter as controls beside its text. Schedule
 * first, with Pause at its heading; then the route the file's `workflow:` block
 * draws, read-only, with Edit stages opening the file's source there; then the
 * inputs, where a value that differs from the file's default becomes an
 * override in the schedule block. Nothing here writes until the page saves.
 */
export function TriggerFilePanel({ draft, onDraft, problems, disabled, definition, unreadable, hostZone, timezones, projectName, projects, listModels, locale, onEditStages }: {
  draft: ScheduleDraft; onDraft: (draft: ScheduleDraft) => void;
  problems: DraftProblems; disabled: boolean;
  /** The file's `workflow:` block, or null when the server could not read it. */
  definition: WorkflowDefinition | null | undefined;
  /** Why the route cannot show, when the file itself cannot be read. */
  unreadable?: string | undefined;
  hostZone: string; timezones: readonly string[];
  projectName: ProjectName; projects: ProjectsLoad;
  listModels: (signal: AbortSignal) => Promise<SessionModel[]>;
  locale?: string | undefined;
  /** Opens the file's source at its stages. Absent while the source cannot be edited. */
  onEditStages?: (() => void) | undefined;
}) {
  const { inputs, defaults } = declaredInputs(definition);
  const values = { ...defaults, ...draft.inputs };
  const steps = routeSteps(definition);
  // The draft holds overrides only: a value set back to the file's default is no override.
  const without = (name: string) => Object.fromEntries(Object.entries(draft.inputs).filter(([key]) => key !== name));
  const setInput = (name: string, value: string) => onDraft({ ...draft, inputs: value === defaults[name] ? without(name) : { ...draft.inputs, [name]: value } });
  const resetInput = (name: string) => onDraft({ ...draft, inputs: without(name) });
  return <>
    <PageSection title="Schedule" spacing="panel"
      action={{ label: "Pause", pressed: draft.paused, disabled, onPress: () => onDraft({ ...draft, paused: !draft.paused }),
        title: draft.paused ? "Paused. Press again to run on schedule. Save writes it into the file." : "Stop future runs. Save writes paused: true into the file." }}>
      <TriggerForm placement="panel" draft={draft} onDraft={(next) => onDraft({ ...draft, ...next })} problems={problems} disabled={disabled}
        hostZone={hostZone} timezones={timezones} projectName={projectName} projects={projects} workflows={NO_WORKFLOWS} listModels={listModels} locale={locale} />
    </PageSection>
    <PageSection title="Route" spacing="panel" action={onEditStages ? { label: "Edit stages", title: "Open the stages in Source", onPress: onEditStages } : undefined}>
      {unreadable ? <Lede>{unreadable}</Lede> : definition === null ? <Lede>Forgerie cannot read the route in this file. Fix the workflow block in Source.</Lede>
        : <RouteList label="Route" head="hidden" steps={steps} empty="No stages. The agent follows the prose." />}
    </PageSection>
    {inputs.length > 0 ? <PageSection title="Inputs, used by each run" spacing="panel">
      <FormLock locked={disabled}>
        <WorkflowInputFields inputs={inputs} values={values} onChange={setInput}
          reset={{ values: defaults, label: "Use the file's default", onReset: resetInput }} />
      </FormLock>
    </PageSection> : null}
  </>;
}
