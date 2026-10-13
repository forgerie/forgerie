// The decision log: choices the agents made without the reader (docs/adr/0001, docs/adr/0005).
// The server side is src/server/sessions/durableDecisions.ts (the Durable doc `forgerie.decisions` per parent
// conversation); the routes are src/server/sessions/decisionRoutes.ts. The wire shape is src/shared/decisions.ts:
// these schemas mirror it field for field, and decisionsParity.test.ts holds them to it.
import { z } from "zod";

export const DECISION_KINDS = ["child-answer", "guess", "gated", "auto-stop", "issue"] as const;
export const decisionKindSchema = z.enum(DECISION_KINDS);
export const decisionStateSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("standing") }),
  z.strictObject({ kind: z.literal("overturned"), note: z.string(), at: z.number() }),
]);
export const decisionSchema = z.strictObject({
  id: z.string(),
  /** When it was decided, in epoch ms. */
  at: z.number(),
  kind: decisionKindSchema,
  /** Who decided: "parent", or "user" for the reader's own answer to an escalated question. */
  by: z.string(),
  /** The workflow run that was active when it was decided, if any. */
  runId: z.string().optional(),
  question: z.string(),
  choice: z.string(),
  reason: z.string(),
  /** A guess made in place of an escalation: the reader may want to look at it. */
  flagged: z.boolean(),
  state: decisionStateSchema,
});
export const decisionsSchema = z.array(decisionSchema);
/** The longest correction the server takes, counted before it trims. */
export const OVERTURN_NOTE_MAX = 8000;
/** The overturn route's body. */
export const decisionOverturnSchema = z.strictObject({ cwd: z.string().min(1), note: z.string().min(1).max(OVERTURN_NOTE_MAX) });
export type Decision = z.infer<typeof decisionSchema>;
export type DecisionKind = z.infer<typeof decisionKindSchema>;

/** Who decided, in the reader's words: the reader is "you". */
export function deciderName(by: string): string {
  return by === "user" ? "you" : by;
}

/** Newest first; two decisions at the same moment by id, descending, as the server lists them. Never changes its input. */
export function sortDecisions(decisions: readonly Decision[]): Decision[] {
  return [...decisions].sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
}

/**
 * Flagged guesses the reader has not overturned. Overturning one settles it, so it stops counting.
 * The session status's `flaggedDecisions` is the server's count of the same thing.
 */
export function flaggedCount(decisions: readonly Decision[]): number {
  return decisions.filter((decision) => decision.flagged && decision.state.kind === "standing").length;
}

/** A run's decisions, newest first. */
export function decisionsOfRun(decisions: readonly Decision[], runId: string): Decision[] {
  return sortDecisions(decisions.filter((decision) => decision.runId === runId));
}

/** What the decider did, after its name: "parent guessed". */
export const KIND_PHRASE: Record<DecisionKind, string> = {
  "child-answer": "answered a question",
  guess: "guessed",
  gated: "settled a gated action",
  "auto-stop": "passed a stop",
  issue: "filed an issue",
};

/** "<1m", "12m", "3h", "2d", "5w": how long ago, in the picker's shorthand. */
export function age(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "<1m";
  if (s < 3600) return `${String(Math.floor(s / 60))}m`;
  if (s < 86_400) return `${String(Math.floor(s / 3600))}h`;
  if (s < 604_800) return `${String(Math.floor(s / 86_400))}d`;
  return `${String(Math.floor(s / 604_800))}w`;
}

/** The sheet's subtitle: how many, and how many flagged. */
export function logSummary(decisions: readonly Decision[] | undefined): string | undefined {
  if (decisions === undefined) return undefined;
  if (decisions.length === 0) return "None yet";
  const flagged = flaggedCount(decisions);
  const all = `${String(decisions.length)} ${decisions.length === 1 ? "decision" : "decisions"}`;
  return flagged === 0 ? all : `${all}, ${String(flagged)} flagged`;
}

/** The header button's name, with the flagged count when there is one. */
export function openerLabel(flagged: number): string {
  return flagged === 0 ? "Decisions" : `Decisions, ${String(flagged)} flagged ${flagged === 1 ? "guess" : "guesses"} to look at`;
}

/** A choice cut to one short line, for the footer that names what is being overturned. */
export function shortChoice(choice: string, length = 80): string {
  const line = choice.trim().split("\n")[0]?.trim() ?? "";
  return line.length > length ? `${line.slice(0, length - 1)}…` : line;
}

/**
 * What a decision list shows, as the session's store holds it. The same view drives the session's sheet and the
 * run sheet's list.
 */
export interface DecisionLogView {
  /** Undefined until the first read answers. */
  decisions?: readonly Decision[] | undefined;
  /** Why the last read failed. */
  readError?: string | undefined;
  /** The decision whose overturn is on its way. */
  overturning?: string | undefined;
  /** Why the last overturn failed. */
  error?: string | undefined;
}

/** The log's actions. Absent `onOverturn`: the log is read only, such as for a landed session. */
export interface DecisionLogActions {
  onRetry: () => void;
  /** Resolves true once the server took the correction. */
  onOverturn?: ((id: string, note: string) => Promise<boolean>) | undefined;
  onDismissError: () => void;
}
