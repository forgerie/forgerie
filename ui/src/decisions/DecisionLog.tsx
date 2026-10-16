import { useEffect, useState, type ReactNode } from "react";
import { CircleDotIcon, FlagIcon, MessageSquareIcon, ShieldCheckIcon, SquareIcon } from "lucide-react";
import { AlertCard } from "../ui/AlertCard";
import { DecisionRecord } from "../ui/DecisionRecord";
import { DisclosureRow } from "../ui/DisclosureRow";
import { ListSection } from "../ui/ListSection";
import { ToggleGroup } from "../ui/ToggleGroup";
import { age, deciderName, KIND_PHRASE, type Decision, type DecisionKind } from "./decisionsModel";
import { FILTER_LABEL, filterCounts, gatedWord, logSections, type DecisionFilter, type DecisionGroup } from "./decisionGroups";

const KIND_ICON: Record<DecisionKind, ReactNode> = {
  gated: <ShieldCheckIcon aria-hidden />, "child-answer": <MessageSquareIcon aria-hidden />, guess: <FlagIcon aria-hidden />,
  "auto-stop": <SquareIcon aria-hidden />, issue: <CircleDotIcon aria-hidden />,
};

/**
 * Shape: the session's decision log. Flagged guesses come first, each in full with Overturn, because the agent chose
 * them without the reader. Every other decision is one line, grouped by day, with neighbours that read the same
 * folded into one line that counts them. A line opens to each decision in full; a gated action already ran, so its
 * open line says a correction cannot undo it. Toggles narrow the log to one kind. Until the first read answers, the
 * log says it is reading; a failed read says why, with Retry, above what was read before.
 */
export function DecisionLog({ decisions, readError, now, target, busy = false, onRetry, onChoose }: {
  /** Undefined until the first read answers. */
  decisions: readonly Decision[] | undefined;
  readError?: string | undefined;
  now: number;
  /** The decision whose note field is open. */
  target?: string | undefined;
  /** An overturn is on its way: no other can start. */
  busy?: boolean;
  onRetry: () => void;
  /** Opens or closes the note field for one decision. Absent: the log is read only. */
  onChoose?: ((id: string) => void) | undefined;
}) {
  const [filter, setFilter] = useState<DecisionFilter>("all");
  // Ids of decisions the reader opened, or chose to overturn. An overturned guess leaves the flagged section for its
  // day's lines, and stays open there, so the reader sees their note land.
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set(target === undefined ? [] : [target]));
  useEffect(() => { if (target !== undefined) setOpened((current) => current.has(target) ? current : new Set([...current, target])); }, [target]);
  const failure = readError !== undefined && <AlertCard label="The decisions could not be read" title="The decisions could not be read"
    actions={[{ label: "Retry", onPress: onRetry }]}>{readError}</AlertCard>;
  if (decisions === undefined && failure) return failure;
  if (decisions === undefined || decisions.length === 0) return <>{failure}<ListSection title="Decisions" empty={decisions === undefined ? "Reading the decisions…" : "No decisions yet."} /></>;
  const counts = filterCounts(decisions);
  const active = counts.some((chip) => chip.filter === filter) ? filter : "all";
  const { flagged, days } = logSections(decisions, now, active);
  const isOpen = (group: DecisionGroup) => group.decisions.some((decision) => decision.id === target || opened.has(decision.id));
  const toggle = (group: DecisionGroup) => setOpened((current) => {
    const next = new Set(current);
    for (const { id } of group.decisions) if (isOpen(group)) next.delete(id); else next.add(id);
    return next;
  });
  // Said once, under the last section, while the log can be overturned.
  const note = onChoose === undefined ? undefined
    : "Overturning a decision sends your note to the agent that acted on it, which redoes the work. If that agent has finished, the parent agent gets the note.";
  const record = (decision: Decision) => {
    const overturned = decision.state.kind === "overturned" ? decision.state : undefined;
    return <DecisionRecord key={decision.id} subject={deciderName(decision.by)} phrase={KIND_PHRASE[decision.kind]}
      time={age(decision.at, now)} timeTitle={new Date(decision.at).toLocaleString()} status={overturned ? "Overturned" : undefined}
      question={decision.question} choice={decision.choice} reason={decision.reason}
      flag={decision.flagged ? overturned ? "Flagged guess, overturned" : "Flagged guess" : undefined}
      correction={overturned && { label: "you", text: overturned.note, time: age(overturned.at, now) }}
      action={overturned === undefined && onChoose !== undefined
        ? { label: decision.kind === "gated" ? "Send a correction" : "Overturn", pressed: target === decision.id, disabled: busy, onPress: () => onChoose(decision.id) } : undefined} />;
  };
  return <>
    {failure}
    {counts.length > 2 && <ToggleGroup label="Show" field value={active} onChange={setFilter}
      options={counts.map((chip) => ({ value: chip.filter, label: FILTER_LABEL[chip.filter], count: chip.count }))} />}
    {flagged.length > 0 && <ListSection title="Flagged guesses" aside={`${String(flagged.length)} chosen without you`} empty=""
      note={days.length === 0 ? note : undefined}>{flagged.map(record)}</ListSection>}
    {days.map((day, index) => <ListSection key={day.key} title={day.label} aside={String(day.groups.reduce((sum, group) => sum + group.decisions.length, 0))} empty=""
      note={index === days.length - 1 ? note : undefined}>
      {day.groups.map((group) => {
        const first = group.decisions[0]!;
        const overturned = first.state.kind === "overturned";
        const gated = first.kind === "gated";
        return <DisclosureRow key={group.key} icon={KIND_ICON[first.kind]} iconLabel={KIND_PHRASE[first.kind]} title={first.question}
          line={gated ? undefined : <><code>{deciderName(first.by)}</code> {KIND_PHRASE[first.kind]}: {first.choice}</>}
          status={overturned ? "Overturned" : gated ? gatedWord(first.choice) : undefined} count={group.decisions.length}
          time={group.decisions.map((decision) => age(decision.at, now)).join(", ")} timeTitle={new Date(first.at).toLocaleString()}
          struck={overturned} open={isOpen(group)} onToggle={() => toggle(group)}
          note={gated && !overturned && onChoose !== undefined ? "The action already ran. A correction tells the agent what to do next; it does not undo the action." : undefined}>
          <ul>{group.decisions.map(record)}</ul>
        </DisclosureRow>;
      })}
    </ListSection>)}
  </>;
}
