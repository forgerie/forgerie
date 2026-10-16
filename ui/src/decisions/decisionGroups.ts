// How the session's decision sheet orders the log: flagged guesses first, as cards, then the rest one line each,
// by day, with repeats folded. The run sheet's short list keeps DecisionList's flat order.
import { DECISION_KINDS, sortDecisions, type Decision, type DecisionKind } from "./decisionsModel";

/** Which decisions the sheet shows: all, the standing flagged guesses, or one kind. */
export type DecisionFilter = "all" | "flagged" | DecisionKind;

/** A filter chip's words, in the order the chips sit. */
export const FILTER_LABEL: Record<DecisionFilter, string> = {
  all: "All", flagged: "Flagged", gated: "Gated actions", "child-answer": "Answers", guess: "Guesses", "auto-stop": "Stops", issue: "Issues",
};

const isFlagged = (decision: Decision) => decision.flagged && decision.state.kind === "standing";

/** The chips with something to show, with their counts. All always comes first. */
export function filterCounts(decisions: readonly Decision[]): { filter: DecisionFilter; count: number }[] {
  const kinds = DECISION_KINDS.map((kind) => ({ filter: kind as DecisionFilter, count: decisions.filter((decision) => decision.kind === kind).length }));
  const flagged = decisions.filter(isFlagged).length;
  return [{ filter: "all", count: decisions.length }, ...(flagged > 0 ? [{ filter: "flagged" as const, count: flagged }] : []), ...kinds.filter((kind) => kind.count > 0)];
}

export function applyFilter(decisions: readonly Decision[], filter: DecisionFilter): Decision[] {
  return decisions.filter((decision) => filter === "all" || (filter === "flagged" ? isFlagged(decision) : decision.kind === filter));
}

/** Decisions that read the same, side by side in time: one line, with how many times. */
export interface DecisionGroup { key: string; decisions: readonly Decision[] }
/** One day of the log. `label`: "Today", "Yesterday", or the date. */
export interface DecisionDay { key: string; label: string; groups: readonly DecisionGroup[] }

const sameLine = (a: Decision, b: Decision) => a.kind === b.kind && a.by === b.by && a.question === b.question && a.choice === b.choice
  && a.state.kind === "standing" && b.state.kind === "standing" && !isFlagged(a) && !isFlagged(b);

/** Folds neighbouring decisions that read the same into one group. The input's order stays. */
export function foldRepeats(decisions: readonly Decision[]): DecisionGroup[] {
  const groups: { key: string; decisions: Decision[] }[] = [];
  for (const decision of decisions) {
    const last = groups.at(-1);
    if (last && sameLine(last.decisions[0]!, decision)) last.decisions.push(decision);
    else groups.push({ key: decision.id, decisions: [decision] });
  }
  return groups;
}

function localDay(at: number): string {
  const date = new Date(at);
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** "Today", "Yesterday", or a short local date such as "Mon 12 Oct". */
export function dayLabel(at: number, now: number): string {
  const day = localDay(at);
  if (day === localDay(now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === localDay(yesterday.getTime())) return "Yesterday";
  return new Date(at).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

/**
 * The sheet's two parts. `flagged`: standing flagged guesses, newest first, which the reader should look at. `days`:
 * everything else, newest first, by local day, with repeats folded. A filter narrows both.
 */
export function logSections(decisions: readonly Decision[], now: number, filter: DecisionFilter = "all"): { flagged: Decision[]; days: DecisionDay[] } {
  const shown = sortDecisions(applyFilter(decisions, filter));
  const flagged = shown.filter(isFlagged);
  const days: { key: string; label: string; items: Decision[] }[] = [];
  for (const decision of shown.filter((item) => !isFlagged(item))) {
    const key = localDay(decision.at);
    const last = days.at(-1);
    if (last?.key === key) last.items.push(decision);
    else days.push({ key, label: dayLabel(decision.at, now), items: [decision] });
  }
  return { flagged, days: days.map((day) => ({ key: day.key, label: day.label, groups: foldRepeats(day.items) })) };
}

/** A gated action's choice as its one status word: "approved" reads "Approved". */
export function gatedWord(choice: string): string {
  const word = choice.trim();
  return word === "" ? word : `${word[0]!.toUpperCase()}${word.slice(1)}`;
}
