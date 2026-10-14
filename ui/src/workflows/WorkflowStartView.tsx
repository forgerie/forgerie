import { useState } from "react";
import { ActionFooter, type FooterAction } from "../ui/ActionFooter";
import { AlertCard } from "../ui/AlertCard";
import { FormLock } from "../ui/FormLock";
import { Lede } from "../ui/Lede";
import { LoadingLines } from "../ui/LoadingLines";
import { PageSection } from "../ui/PageSection";
import { ReplyBox } from "../ui/ReplyBox";
import { RuleBlock } from "../ui/RuleBlock";
import { SplitSheet } from "../ui/SplitSheet";
import type { WorkerModels } from "./WorkerModelPicker";
import { WorkflowInputFields } from "./WorkflowInputFields";
import { WorkflowPlan } from "./WorkflowPlan";
import { WorkflowRouteEditor } from "./WorkflowRouteEditor";
import { planDocument, planOf, planTitle } from "./workflowPlan";
import { changeLine, changesNote, modelChoices, reshapes, routeChanges, undoChange, type ModelChoices } from "./workflowRoute";
import {
  launchInputs, proposalInputs, proposalLaunchInputs, proposalOutcome, proseOf,
  type ProposalAction, type ProposalEntry, type SavedWorkflow, type WorkflowInput, type WorkflowInputs, type WorkflowProposal, type WorkflowStage,
} from "./workflowsModel";

/** What the sheet starts: a saved workflow file, or a workflow the agent proposed in this chat. */
export type StartSource =
  | { kind: "saved"; workflow: SavedWorkflow; initialTask?: string | undefined }
  | { kind: "proposal"; entry: ProposalEntry; proposal?: WorkflowProposal | undefined; readError?: string | undefined };

const PENDING: Record<ProposalAction, string> = { start: "Starting…", changes: "Sending…", dismiss: "Dismissing…" };
const NO_STAGES: readonly WorkflowStage[] = [];

const count = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

/**
 * Shape: a workflow before it starts, with the plan as the page you read. The plan pane renders the prose in the
 * chat's blocks, one section per stage. The rail holds the route, with a model picker for each worker, then the
 * inputs; the foot holds the actions. A saved workflow starts as its file says, with the models the reader picks. A
 * proposal can also change shape: Edit stages adds and removes stages and workers, and then Update the plan takes
 * Start's place and sends the changes to the agent as a note. A model change alone keeps Start, and the start sends it.
 * Until the proposal's record arrives the sheet shows what its card knows; a failed read offers Retry.
 */
export function WorkflowStartView({ source, blocked, pending, error, models, agents = [], initial = {}, onStart, onChanges, onDismiss, onRetry, onBack, onClose }: {
  source: StartSource;
  /** Why it cannot start now, such as another run in progress. */
  blocked?: string | undefined;
  /** An action on its way. */
  pending?: ProposalAction | undefined;
  /** Why the last action failed. */
  error?: string | undefined;
  models: WorkerModels;
  /** The agents a new worker can run as. */
  agents?: readonly string[];
  /** Where the sheet opens: the reader's route, Edit stages on, or the note for changes open. */
  initial?: { route?: WorkflowStage[]; editing?: boolean; changing?: boolean } | undefined;
  onStart: (inputs: WorkflowInputs, models?: ModelChoices) => void;
  /** Resolves true once the server took the note. A proposal only. */
  onChanges?: ((note: string) => Promise<boolean>) | undefined;
  onDismiss?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  /** Back to the list the sheet was opened from. */
  onBack?: (() => void) | undefined;
  onClose: () => void;
}) {
  const proposal = source.kind === "proposal" ? source.proposal : undefined;
  const saved = source.kind === "saved" ? source.workflow : undefined;
  const ready = saved !== undefined || proposal !== undefined;
  const original = saved?.definition.stages ?? proposal?.definition.stages ?? (source.kind === "proposal" ? source.entry.stages : NO_STAGES);
  const fields: { inputs: [string, WorkflowInput][]; values: Record<string, string> } | undefined = saved !== undefined
    ? { inputs: Object.entries(saved.definition.inputs ?? {}).sort(([a], [b]) => Number(b === "task") - Number(a === "task")),
      values: Object.fromEntries(Object.entries(saved.definition.inputs ?? {}).map(([name, input]) => [name,
        name === "task" && source.kind === "saved" && source.initialTask !== undefined ? source.initialTask : input.default === undefined ? "" : String(input.default)])) }
    : proposal === undefined ? undefined : proposalInputs(proposal);
  // The values arrive with the record; the reader's edits win from then on.
  const [typed, setTyped] = useState<Record<string, string>>();
  const values = typed ?? fields?.values ?? {};
  /** Inputs the reader edited. With the agent's, they are the given values of a proposal, sent even when empty. */
  const [edited, setEdited] = useState<ReadonlySet<string>>(new Set());
  const [problem, setProblem] = useState<string>();
  const [route, setRoute] = useState<WorkflowStage[] | undefined>(initial.route);
  const stages = route ?? original;
  const [editing, setEditing] = useState(initial.editing === true);
  const [changing, setChanging] = useState(initial.changing === true);
  const [note, setNote] = useState(() => initial.changing === true && initial.route !== undefined
    ? changesNote(routeChanges(original, initial.route), initial.route, models.known) : "");
  const [here, setHere] = useState<string>();
  const [target, setTarget] = useState<{ stage: string; at: number }>();

  const closed = proposal !== undefined && proposal.state.kind !== "open" ? proposalOutcome(proposal) : undefined;
  const busy = pending !== undefined;
  const changes = routeChanges(original, stages);
  const stale = reshapes(changes).length > 0;
  const modelCount = changes.length - reshapes(changes).length;

  const set = (name: string, value: string) => { setTyped({ ...values, [name]: value }); setEdited(new Set([...edited, name])); setProblem(undefined); };
  const resetInput = (name: string) => {
    setTyped({ ...values, [name]: fields?.values[name] ?? "" });
    setEdited(new Set([...edited].filter((key) => key !== name)));
    setProblem(undefined);
  };
  const start = () => {
    if (fields === undefined) return;
    const result = saved !== undefined ? launchInputs(saved, values)
      : proposalLaunchInputs(fields.inputs, values, new Set([...Object.keys(proposal?.inputs ?? {}), ...edited]));
    if ("problem" in result) { setProblem(result.problem); return; }
    setProblem(undefined);
    onStart(result.inputs, modelChoices(changes));
  };
  const openChanges = () => { setNote(stale ? changesNote(changes, stages, models.known) : ""); setChanging(true); };
  const jump = (stage: string) => { setHere(stage); setTarget({ stage, at: (target?.at ?? 0) + 1 }); };

  const name = saved?.name ?? proposal?.name ?? (source.kind === "proposal" ? source.entry.name : "");
  const text = saved?.text ?? proposal?.text ?? "";
  const title = text === "" ? name : planTitle(text, name);
  const kind = saved !== undefined ? "Saved workflow" : "Proposed workflow";
  const plan = saved !== undefined ? planDocument(saved.body ?? proseOf(saved.text ?? ""), original) : proposal === undefined ? undefined : planOf(proposal.text, original);
  const summary = proposal?.summary ?? (source.kind === "proposal" ? source.entry.summary : saved?.description ?? "");

  const footNote = closed ?? (busy ? PENDING[pending]
    : !ready ? source.kind === "proposal" && source.readError !== undefined ? "Read the proposal again to start it." : "Reading the proposal…"
    : blocked ?? (changing ? stale ? `${count(changes.length, "route change goes", "route changes go")} to the agent with your note. It rewrites the plan to match, then proposes it again.`
      : "The agent reads your note and proposes again."
      : stale ? "You changed the route. Update the plan, then start the new one."
      : modelCount > 0 ? `${count(modelCount, "model", "models")} changed. The run uses ${modelCount === 1 ? "it" : "them"}; the plan stays as it is.`
      : saved !== undefined ? "It runs in this chat. You can keep talking while it works." : "It runs in this chat. Nothing is saved to the repository."));
  const startAction: FooterAction = { label: "Start workflow", tone: stale ? undefined : "primary", onPress: start,
    disabled: busy || !ready || blocked !== undefined || stale || closed !== undefined };
  const actions: FooterAction[] = closed !== undefined ? [] : saved !== undefined ? [startAction] : [
    { label: "Dismiss", onPress: () => onDismiss?.(), disabled: busy },
    stale ? startAction : { label: "Ask for changes", onPress: openChanges, disabled: busy || !ready },
    stale ? { label: "Update the plan", tone: "primary", onPress: openChanges, disabled: busy } : startAction,
  ];
  const foot = <ActionFooter stack note={footNote} problem={closed === undefined ? problem ?? error : undefined} actions={actions}
    input={changing && closed === undefined && onChanges !== undefined ? <ReplyBox label="What should change in this workflow?" placeholder="Say what to change"
      sendLabel={stale ? "Update the plan" : "Send changes"} autoFocus disabled={busy} draft={{ value: note, update: (change) => setNote(change) }}
      secondary={{ label: "Back", onPress: () => setChanging(false), disabled: busy }}
      onSend={async (sent) => { if (!await onChanges(sent)) throw new Error("Not sent"); }} /> : undefined} />;

  const readError = source.kind === "proposal" ? source.readError : undefined;
  /** Only a proposal changes shape: a saved file is edited where it lives. A proposal with no stages can be given its first. */
  const editable = source.kind === "proposal" && onChanges !== undefined;
  const document = plan !== undefined
    ? plan.overview === "" && plan.sections.length === 0 ? <Lede>{summary === "" ? "This workflow has no prose." : summary}</Lede>
      : <WorkflowPlan plan={plan} original={original} stages={stages} changes={changes} target={target} onInView={setHere} />
    : <>
      {summary.trim() !== "" && <Lede>{summary}</Lede>}
      {readError === undefined ? <LoadingLines label="Reading the plan…" widths={[92, 100, 64, 38]} />
        : <AlertCard label="The proposal could not be read" title="The proposal could not be read"
          actions={onRetry === undefined ? [] : [{ label: "Retry", onPress: onRetry }]}>{readError}</AlertCard>}
    </>;
  const lead = ready && stale && closed === undefined ? <RuleBlock title="The plan does not match your route yet" tone="warn"
    action={{ label: "Undo all", onPress: () => setRoute(undefined) }}
    items={changes.filter((change) => change.kind !== "model").map((change) => {
      const line = changeLine(change, stages, models.known);
      return { key: line, text: line, undo: { label: "Undo this change", onPress: () => setRoute(undoChange(original, stages, change)) } };
    })}
    note="Update the plan to send these to the agent. It rewrites the plan to match, and you start the new one." /> : undefined;
  const rail = <>
    {(original.length > 0 || stages.length > 0 || editable && ready && closed === undefined) && <WorkflowRouteEditor original={original} stages={stages}
      onChange={setRoute} editable={editable} editing={editing} onEditing={setEditing}
      disabled={!ready || busy || closed !== undefined} here={here} onJump={plan === undefined ? undefined : jump} models={models}
      resetLabel={saved !== undefined ? "Use the file's" : "Use the agent's"} agents={agents} />}
    {(fields === undefined || fields.inputs.length > 0) && <PageSection title="Inputs">
      {fields === undefined ? <Lede>The inputs arrive with the plan.</Lede>
        : <FormLock locked={busy || closed !== undefined}><WorkflowInputFields inputs={fields.inputs} values={values} onChange={set}
          reset={{ values: fields.values, label: saved !== undefined ? "Use the file's" : "Use the agent's", onReset: resetInput }} /></FormLock>}
    </PageSection>}
  </>;
  return <SplitSheet title={title} subtitle={<>{title !== name && <code>{name}</code>}<span>{original.length === 0 ? kind : `${kind}, ${count(original.length, "stage", "stages")}`}</span></>}
    closeLabel={saved !== undefined ? "Close the plan" : "Close the proposal"} onClose={onClose}
    back={onBack === undefined ? undefined : { label: "All workflows", onPress: onBack }}
    lead={lead} document={document} documentLabel="Plan" busy={!ready && readError === undefined} rail={rail} railLabel="Before you start" foot={foot} />;
}
