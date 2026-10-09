import type { StatusTone } from "../ui/StatusChip";

/** What the session header's chip must know. Every field is plain, so the rule is a pure function. */
export interface StatusFacts {
  /** Set when Pi never runs here again, such as a landed worktree. */
  readOnly?: "Landed" | "Discarded" | "Read-only" | undefined;
  connection: "loading" | "ready" | "reconnecting" | "failed";
  /** An extension dialog waits on the reader. It outranks activity. */
  dialogOpen: boolean;
  /** An ask waits on the reader. The run that asked still counts as running. */
  askOpen: boolean;
  sending: boolean;
  compaction: "idle" | "running" | "queued";
  running: boolean;
  shellRunning: boolean;
  problems: number;
}
export interface SessionStatusView {
  label: string;
  tone: StatusTone;
  /** Problems counted beside the label. Zero when the label already says them. */
  count: number;
  countLabel: string | undefined;
  /** The chip opens a panel: connection trouble or problems to read. */
  hasDetail: boolean;
}

export const problemsLabel = (count: number) => count === 1 ? "1 problem" : `${String(count)} problems`;

/**
 * One word for the session. Connection trouble outranks everything, because
 * nothing else is current while it lasts. Then what the session is doing.
 * Problems name the chip only when the session is idle; otherwise they ride
 * along as a count, so "Running" never hides behind an old failure.
 */
export function sessionStatus(facts: StatusFacts): SessionStatusView {
  const problems = facts.problems;
  const counted = (label: string, tone: StatusTone, detail = false): SessionStatusView => ({
    label, tone, count: problems, countLabel: problems > 0 ? problemsLabel(problems) : undefined, hasDetail: detail || problems > 0,
  });
  if (facts.readOnly) return counted(facts.readOnly, "neutral");
  if (facts.connection === "loading") return counted("Connecting", "neutral");
  if (facts.connection === "reconnecting") return counted("Reconnecting", "warn", true);
  if (facts.connection === "failed") return counted("Disconnected", "bad", true);
  if (facts.dialogOpen) return counted("Waiting for you", "attention");
  if (facts.sending) return counted("Sending", "live");
  if (facts.compaction === "running") return counted("Compacting", "live");
  if (facts.compaction === "queued") return counted("Compaction queued", "neutral");
  if (facts.running) return counted("Running", "live");
  if (facts.shellRunning) return counted("Running shell command", "live");
  if (facts.askOpen) return counted("Waiting for you", "attention");
  if (problems > 0) return { label: problems === 1 ? "Problem" : problemsLabel(problems), tone: "bad", count: 0, countLabel: undefined, hasDetail: true };
  return counted("Connected", "quiet");
}
