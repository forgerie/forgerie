import type { StatusTone } from "../ui/StatusChip";
import { agentsLabel, backgroundAgentsLabel } from "./taskActivityModel";

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
  /**
   * The session's live Durable tasks: how many, and how many child agents
   * work in the background. `unsupported` for a session that is not Durable;
   * undefined until the first read returns.
   */
  tasks?: "unsupported" | { live: number; backgroundAgents: number } | undefined;
}
export interface SessionStatusView {
  label: string;
  tone: StatusTone;
  /** Problems counted beside the label. Zero when the label already says them. */
  count: number;
  countLabel: string | undefined;
  /** Background agents, as a quiet readout after the label, such as "2 agents". */
  aside: string | undefined;
  asideLabel: string | undefined;
  /** The chip opens a panel: connection trouble, problems to read, or the session's live tasks. */
  hasDetail: boolean;
}

export const problemsLabel = (count: number) => count === 1 ? "1 problem" : `${String(count)} problems`;

/**
 * One word for the session. Connection trouble outranks everything, because
 * nothing else is current while it lasts. Then what the session is doing.
 * Problems name the chip only when the session is idle; otherwise they ride
 * along as a count, so "Running" never hides behind an old failure.
 * Background agents ride along as a quiet aside. The panel also opens while
 * the session runs or has live tasks, so the reader can see what works.
 */
export function sessionStatus(facts: StatusFacts): SessionStatusView {
  const problems = facts.problems;
  const tasks = facts.tasks === "unsupported" ? undefined : facts.tasks ?? { live: 0, backgroundAgents: 0 };
  const agents = tasks?.backgroundAgents ?? 0;
  const working = tasks !== undefined && (facts.running || tasks.live > 0);
  const counted = (label: string, tone: StatusTone, detail = false): SessionStatusView => ({
    label, tone, count: problems, countLabel: problems > 0 ? problemsLabel(problems) : undefined,
    aside: agents > 0 ? agentsLabel(agents) : undefined, asideLabel: agents > 0 ? backgroundAgentsLabel(agents) : undefined,
    hasDetail: detail || problems > 0 || working,
  });
  // Pi never runs in a read-only session again, so nothing there is worth a panel.
  if (facts.readOnly) return { ...counted(facts.readOnly, "neutral"), aside: undefined, asideLabel: undefined, hasDetail: problems > 0 };
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
  if (problems > 0) return { ...counted(problems === 1 ? "Problem" : problemsLabel(problems), "bad", true), count: 0, countLabel: undefined };
  return counted("Connected", "quiet");
}
