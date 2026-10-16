import { FlagIcon } from "lucide-react";
import { AlertCard } from "../ui/AlertCard";
import { DecisionRecord } from "../ui/DecisionRecord";
import { IconCount } from "../ui/IconCount";
import { ListSection } from "../ui/ListSection";
import { age, deciderName, flaggedCount, KIND_PHRASE, type Decision } from "./decisionsModel";

/**
 * Shape: decisions the agents made without the reader, newest first. Each says
 * who decided and when, the question, the choice, and the reason; a flagged
 * guess carries a flag in the margin until confirmed. A decision that has not
 * been overturned can be overturned:
 * its Overturn opens the note field in the sheet's footer. An overturned one
 * shows the reader's note under its struck choice. Until the first read
 * answers, the list says it is reading; a failed read says why, with Retry,
 * above whatever was read before.
 */
export function DecisionList({ title, decisions, readError, now, target, busy = false, placement, onRetry, onChoose, onConfirm }: {
  title: string;
  /** Newest first. Undefined until the first read answers. */
  decisions: readonly Decision[] | undefined;
  readError?: string | undefined;
  /** The clock the ages are measured from. */
  now: number;
  /** The decision whose note field is open. */
  target?: string | undefined;
  /** A review action is on its way: no other can start. */
  busy?: boolean;
  /** "document": the list follows other content in a sheet, set apart by the sheet's largest gap. */
  placement?: "list" | "document";
  onRetry: () => void;
  /** Opens or closes the note field for one decision. Absent: the log is read only. */
  onChoose?: ((id: string) => void) | undefined;
  /** Confirms a flagged guess without asking the agent to redo work. */
  onConfirm?: ((id: string) => Promise<boolean>) | undefined;
}) {
  const flagged = decisions === undefined ? 0 : flaggedCount(decisions);
  const failure = readError !== undefined && <AlertCard label="The decisions could not be read" title="The decisions could not be read"
    actions={[{ label: "Retry", onPress: onRetry }]}>{readError}</AlertCard>;
  if (decisions === undefined && readError !== undefined) return failure;
  return <>
    {failure}
    <ListSection title={title} placement={placement}
      aside={flagged > 0 ? <IconCount icon={<FlagIcon aria-hidden />} count={flagged} label={`${String(flagged)} flagged ${flagged === 1 ? "guess" : "guesses"}`} /> : undefined}
      empty={decisions === undefined ? "Reading the decisions…" : "No decisions yet."}
      note={onChoose !== undefined && decisions !== undefined && decisions.length > 0
        ? "Overturning a decision sends your note to the agent that acted on it, which redoes the work. If that agent has finished, the parent agent gets the note." : undefined}>
      {decisions?.map((decision) => {
        const overturned = decision.state.kind === "overturned" ? decision.state : undefined;
        return <DecisionRecord key={decision.id} subject={deciderName(decision.by)} phrase={KIND_PHRASE[decision.kind]}
          time={age(decision.at, now)} timeTitle={new Date(decision.at).toLocaleString()} status={overturned ? "Overturned" : decision.state.kind === "confirmed" ? "Confirmed" : undefined}
          question={decision.question} choice={decision.choice} reason={decision.reason}
          flag={decision.flagged && decision.state.kind !== "confirmed" ? overturned ? "Flagged guess, overturned" : "Flagged guess" : undefined}
          correction={overturned && { label: "you", text: overturned.note, time: age(overturned.at, now) }}
          action={overturned === undefined && onChoose !== undefined
            ? { label: "Overturn", pressed: target === decision.id, disabled: busy, onPress: () => onChoose(decision.id) } : undefined}
          secondaryAction={decision.kind === "guess" && decision.flagged && decision.state.kind === "standing" && onConfirm !== undefined
            ? { label: "Looks right", disabled: busy, onPress: () => { void onConfirm(decision.id); } } : undefined} />;
      })}
    </ListSection>
  </>;
}
