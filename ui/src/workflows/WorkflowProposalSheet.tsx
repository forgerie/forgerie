import { useState } from "react";
import { ActionFooter } from "../ui/ActionFooter";
import { AlertCard } from "../ui/AlertCard";
import { Disclosure } from "../ui/Disclosure";
import { Lede } from "../ui/Lede";
import { MarkdownFragment } from "../ui/MarkdownFragment";
import { ReplyBox } from "../ui/ReplyBox";
import { RouteMap } from "../ui/RouteMap";
import { SheetDialog } from "../ui/SheetDialog";
import { WorkflowInputFields } from "./WorkflowInputFields";
import { launchInputs, proposalInputs, proposalOutcome, proseOf, routeSteps, type ProposalAction, type ProposalEntry, type WorkflowInputs, type WorkflowProposal } from "./workflowsModel";

const PENDING: Record<ProposalAction, string> = { start: "Starting…", changes: "Sending…", dismiss: "Dismissing…" };

/**
 * Shape: a workflow the agent proposed, opened from its card: the overview,
 * the inputs the agent filled (editable, the task first), the route with its
 * workers and stops, and the full instructions, closed. Start runs it in this
 * chat; Ask for changes needs a note and sends the agent back to propose
 * again; Dismiss closes it. Until the record arrives the sheet shows what the
 * card knows. A failed action keeps the sheet open and says why in the footer.
 */
export function WorkflowProposalSheet({ entry, proposal, readError, blocked, pending, error, onRetry, onStart, onChanges, onDismiss, onClose }: {
  entry: ProposalEntry;
  /** The record, once read. Its inputs and instructions are not in the entry. */
  proposal?: WorkflowProposal | undefined;
  /** Why the record could not be read. */
  readError?: string | undefined;
  /** Why the workflow cannot start now, such as another run in progress. */
  blocked?: string | undefined;
  pending?: ProposalAction | undefined;
  /** Why the last action failed. */
  error?: string | undefined;
  onRetry: () => void;
  onStart: (inputs: WorkflowInputs) => void;
  /** Resolves true once the server took the note. */
  onChanges: (note: string) => Promise<boolean>;
  onDismiss: () => void;
  onClose: () => void;
}) {
  const fields = proposal === undefined ? undefined : proposalInputs(proposal);
  // The agent's values arrive with the record; the reader's edits win from then on.
  const [typed, setTyped] = useState<Record<string, string>>();
  const values = typed ?? fields?.values ?? {};
  const [problem, setProblem] = useState<string>();
  const [changing, setChanging] = useState(false);
  const stages = proposal?.definition.stages ?? entry.stages;
  const closed = proposal !== undefined && proposal.state.kind !== "open" ? proposalOutcome(proposal) : undefined;
  const busy = pending !== undefined;
  const set = (name: string, value: string) => { setTyped({ ...values, [name]: value }); setProblem(undefined); };
  const start = () => {
    if (fields === undefined) return;
    const result = launchInputs({ definition: { inputs: Object.fromEntries(fields.inputs) } }, values);
    if ("problem" in result) setProblem(result.problem);
    else onStart(result.inputs);
  };
  const failure = problem ?? error;
  const note = closed ?? (busy ? PENDING[pending] : failure !== undefined ? <span role="alert">{failure}</span>
    : proposal === undefined ? readError === undefined ? "Reading the proposal…" : "Read the proposal again to start it."
    : blocked ?? (changing ? "The agent reads your note and proposes again." : "It runs in this chat. Nothing is saved to the repository."));
  const footer = <ActionFooter note={note} input={changing && closed === undefined ? <ReplyBox label="What should change in this workflow?" placeholder="Say what to change"
    sendLabel="Send changes" autoFocus disabled={busy} secondary={{ label: "Back", onPress: () => setChanging(false), disabled: busy }}
    onSend={async (text) => { if (!await onChanges(text)) throw new Error("Not sent"); }} /> : undefined} actions={[
    { label: "Dismiss", onPress: onDismiss, disabled: busy || closed !== undefined },
    { label: "Ask for changes", onPress: () => setChanging(true), disabled: busy || closed !== undefined },
    { label: "Start workflow", onPress: start, tone: "primary", disabled: busy || closed !== undefined || blocked !== undefined || fields === undefined },
  ]} />;
  const summary = proposal?.summary ?? entry.summary;
  const prose = proposal === undefined ? "" : proseOf(proposal.text);
  return <SheetDialog title={proposal?.name ?? entry.name} subtitle={stages.length === 0 ? "Proposed workflow" : `Proposed workflow, ${String(stages.length)} stages`}
    closeLabel="Close the proposal" onClose={onClose} footer={footer}>
    {summary.trim() !== "" && <Lede>{summary}</Lede>}
    {proposal === undefined && readError !== undefined && <AlertCard label="The proposal could not be read" title="The proposal could not be read"
      actions={[{ label: "Retry", onPress: onRetry }]}>{readError}</AlertCard>}
    {fields !== undefined && <WorkflowInputFields inputs={fields.inputs} values={values} onChange={set} />}
    {stages.length > 0 && <RouteMap label="What happens" steps={routeSteps(stages, undefined)} />}
    {prose !== "" && <Disclosure summary="Full instructions"><MarkdownFragment text={prose} /></Disclosure>}
  </SheetDialog>;
}
