import { ActionFooter } from "../ui/ActionFooter";
import { CommandBlock } from "../ui/CommandBlock";
import { DecisionCard } from "../ui/DecisionCard";
import { Disclosure } from "../ui/Disclosure";
import {
  argumentsText, consequenceOf, errorText, gatedIsWaiting, gatedMeta, gatedOutcome, resultText, saysMore, shownCall, unknownOutcome,
  type GatedAction, type GatedChoice, type GatedActionEntry,
} from "./gatedActionsModel";

/**
 * Shape: a call an agent made that Forgerie holds until the reader approves it,
 * in the thread. It says what the call does, shows the exact command (or the
 * call's short form, with every argument a step away), its category, and who
 * asked. Approve and run is the one filled choice, and the note above it says
 * what cannot be undone. In a short container the choices move up beside the
 * title. Once decided it closes to one line: running, ran (with what it
 * printed), failed (with the error), outcome unknown (a run a restart cut off,
 * which may have happened and never runs again), or refused. Without the choices, as in a
 * read-only transcript, it only says what became of the call.
 */
export function GatedActionCard({ entry, record, read, deciding, problem, onApprove, onRefuse }: {
  entry: GatedActionEntry;
  /** The session's record of this action, as last read. */
  record?: GatedAction | undefined;
  /** Whether the session's records were read at least once. Before that, the card trusts its entry. */
  read: boolean;
  /** The choice on its way for this action. */
  deciding?: GatedChoice | undefined;
  /** Why the last choice on this action failed. */
  problem?: string | undefined;
  /** Absent where the reader cannot decide, such as a read-only transcript. */
  onApprove?: (() => void) | undefined;
  onRefuse?: (() => void) | undefined;
}) {
  const waiting = gatedIsWaiting(record, read);
  const open = waiting && onApprove !== undefined && onRefuse !== undefined;
  const call = shownCall(entry, record);
  const all = argumentsText(entry, record);
  const state = record?.state;
  const printed = state?.kind === "ran" ? resultText(state.result) : "";
  const unknown = unknownOutcome(record);
  const error = state?.kind === "failed" && unknown === undefined ? errorText(state.error) : "";
  // Forgerie's own words on an interrupted run are prose for the reader; a tool's output stays in the code face.
  const output = printed.trim() !== "" ? <CommandBlock code={printed} label="Result" copyLabel="Copy result" lines={3} moreLabel="Show full result" />
    : unknown !== undefined && unknown.rest !== "" ? <p>{unknown.rest}</p>
    : saysMore(error) ? <CommandBlock code={error} label="Error" copyLabel="Copy error" lines={3} moreLabel="Show full error" /> : undefined;
  return <DecisionCard title={entry.description.trim() === "" ? entry.tool : entry.description} meta={gatedMeta(entry)}
    open={open} pinChoices problem={problem}
    closed={waiting ? "Waiting for a decision." : gatedOutcome(record)} closedTone={state?.kind === "failed" ? "bad" : undefined} closedDetail={output}
    footer={open && <ActionFooter note={deciding === "approve" ? "Approving…" : deciding === "refuse" ? "Refusing…" : undefined} actions={[
      { label: "Refuse", onPress: onRefuse, disabled: deciding !== undefined },
      { label: "Approve and run", onPress: onApprove, tone: "primary", disabled: deciding !== undefined },
    ]} />}>
    <CommandBlock code={call.code} label={call.shell ? "Command" : "Call"} copyLabel={call.shell ? "Copy command" : "Copy call"} shell={call.shell}
      lines={8} moreLabel={call.shell ? "Show the whole command" : "Show the whole call"} />
    {all !== undefined && <Disclosure summary={`All arguments to ${entry.tool}`}>
      <CommandBlock code={all} label="Arguments" copyLabel="Copy arguments" />
    </Disclosure>}
    {open && <p>{consequenceOf(entry.category)}</p>}
  </DecisionCard>;
}
