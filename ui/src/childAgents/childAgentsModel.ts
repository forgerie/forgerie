import type { RiskLabel } from "@shared/riskLabels";
import { riskLabelEntryOf, messageRiskLabels } from "../riskLabelsModel";
// Child agents a session runs in its own Durable storage. The server side is
// src/server/sessions/durableChildAgents.ts; the routes are durableChildRoutes.ts.
import { z } from "zod";
import { cleanupSchema } from "../worktrees/worktreeApi";
import { partsOf, piMessageSchema, textOf, type PiMessage } from "../contracts";

export const childQuestionSchema = z.object({ questionId: z.string(), question: z.string(), askedAt: z.number() });
/**
 * Forgerie retries a child's model error itself before the parent hears of it (src/shared/childRetry.ts). `attempt`
 * is the try that waits, 1 to 3, of `max`, always 3; `error` is the provider's own text; `until` is when the try
 * starts, in epoch ms. Like the server's schema, it refuses any other field.
 */
export const childRetrySchema = z.strictObject({ attempt: z.number().int().min(1).max(3), max: z.literal(3), error: z.string(), until: z.number() });
export const childSummarySchema = z.object({
  name: z.string(),
  conversationId: z.number(),
  agent: z.string().nullable(),
  busy: z.boolean(),
  createdAt: z.number(),
  // Optional for an older server; absent accounting remains unknown, never zero.
  costUsd: z.number().finite().nonnegative().nullable().optional(),
  lastTool: z.object({ name: z.string().min(1).max(80).regex(/^[A-Za-z0-9_.:-]+$/u), at: z.number().finite().nonnegative().nullable() }).nullable().optional(),
  questions: z.array(childQuestionSchema),
  retry: childRetrySchema.optional(),
  worktree: z.object({
    repo: z.string().optional(), defaultBranch: z.string().optional(), cleanup: cleanupSchema.optional(), cleanupRetryToken: z.string().optional(), statusError: z.string().optional(),
    path: z.string(), branch: z.string(), state: z.enum(["active", "landed", "discarded"]),
    ahead: z.number().int().nonnegative(), dirty: z.boolean(),
  }).optional(),
});
export const childSummariesSchema = z.array(childSummarySchema);
export const childTranscriptSchema = z.object({
  messages: z.array(piMessageSchema),
  busy: z.boolean(),
  partial: piMessageSchema.optional(),
});
export type ChildSummary = z.infer<typeof childSummarySchema>;
export type ChildRetry = z.infer<typeof childRetrySchema>;
export type ChildTranscript = z.infer<typeof childTranscriptSchema>;

/** The tool a child calls to ask the reader. Its call carries the question; its result, the answer. */
export const QUESTION_TOOL = "ask_human";

/** The server's event when any child starts, ends, asks, or is answered. */
export const CHILDREN_CHANGED_EVENT = "durable_children_changed";

// Transcript entries the server writes into the parent session.
export const CHILD_QUESTION_TYPE = "forgerie.child-question";
export const CHILD_ANSWER_TYPE = "forgerie.child-answer";
export const CHILD_NOTE_TYPE = "forgerie.child-note";

/**
 * Why the parent passed a child's question on to the reader (docs/adr/0001): only an irreversible action or one
 * outside the project in the reader's name reaches the reader. `guess` and `why` are what the parent would choose.
 * The other two kinds never reach the reader as a card; the child goes on with the guess and the log flags it.
 * The server writes the three as top-level fields of the question entry's details (durableChildAgents.ts).
 */
export const escalationSchema = z.object({
  kind: z.enum(["irreversible", "external", "contradicts", "stuck"]),
  guess: z.string(),
  why: z.string(),
});
export type Escalation = z.infer<typeof escalationSchema>;

/** Something a child did, as the parent's transcript records it. */
export type ChildEntry =
  | { kind: "question"; questionId: string; child: number; childName: string; question: string; answer?: string; cancelled?: boolean; escalation?: Escalation }
  | { kind: "answer"; questionId: string; answer: string }
  | { kind: "note"; child: number; childName: string; action: "message" | "stop"; text: string }
  | { kind: "report"; childName: string; outcome: "answered" | "failed"; text: string };

const str = (record: Record<string, unknown>, key: string) => typeof record[key] === "string" ? record[key] : "";
const num = (record: Record<string, unknown>, key: string) => typeof record[key] === "number" ? record[key] : 0;
const recordOf = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value)) : {};

/** A custom message the server wrote for a child, or undefined for any other message. */
export function childEntryOf(message: PiMessage): ChildEntry | undefined {
  if (message.role === "user") return reportOf(textOf(message));
  if (message.role !== "custom") return undefined;
  const details = recordOf(message.details);
  switch (message.customType) {
    case CHILD_QUESTION_TYPE: {
      // A malformed escalation drops out, not the question: the reader can still answer it.
      const escalation = escalationSchema.safeParse({ kind: details["kind"], guess: details["guess"], why: details["why"] });
      return { kind: "question", questionId: str(details, "questionId"), child: num(details, "child"),
        childName: str(details, "childName") || "child", question: str(details, "question"), ...(escalation.success ? { escalation: escalation.data } : {}) };
    }
    case CHILD_ANSWER_TYPE: return { kind: "answer", questionId: str(details, "questionId"), answer: str(details, "answer") };
    case CHILD_NOTE_TYPE: return { kind: "note", child: num(details, "child"), childName: str(details, "childName"),
      action: str(details, "action") === "stop" ? "stop" : "message", text: str(details, "text").replace(/^\[[^\]]*\]\s*/u, "") };
    default: return undefined;
  }
}

// A failure carries the provider's own error, which can hold brackets and line breaks, so it runs to the last "]".
const REPORT = /^\[subagent (\S+) (?:answered, no reply needed\]\s?([\s\S]*)|failed: ([\s\S]*)\])$/u;
/** A child's answer or failure, which the server posts to the parent model as a user message. */
export function reportOf(text: string): ChildEntry | undefined {
  const match = REPORT.exec(text);
  if (!match) return undefined;
  const failed = match[3] !== undefined;
  return { kind: "report", childName: match[1]!, outcome: failed ? "failed" : "answered", text: failed ? match[3]! : match[2]!.trim() };
}

/** One line of a child's transcript for the child view. */
export type ChildLine =
  | { kind: "said"; who: "message" | "child"; text: string; key: string; streaming?: boolean }
  | { kind: "tool"; name: string; summary: string; key: string; riskLabel?: RiskLabel }
  | { kind: "result"; name: string; text: string; isError: boolean; key: string };

function summarize(args: unknown): string {
  const record = recordOf(args);
  for (const key of ["command", "path", "question", "message"]) if (typeof record[key] === "string") return record[key];
  const json = JSON.stringify(args ?? {});
  return json.length > 120 ? `${json.slice(0, 119)}…` : json;
}

/** Model messages, oldest first, as lines a person can read. */
export function childLines(transcript: ChildTranscript): ChildLine[] {
  const lines: ChildLine[] = [];
  const labels = new Map(transcript.messages.flatMap(message => {
    const entry = riskLabelEntryOf(message);
    return entry?.target === "tool" ? [[entry.invocationId, entry.label] as const] : [];
  }));
  const add = (message: PiMessage, index: number, streaming = false) => {
    const key = `${String(index)}`;
    if (message.role === "user") { lines.push({ kind: "said", who: "message", text: textOf(message), key }); return; }
    if (message.role === "toolResult") {
      lines.push({ kind: "result", name: message.toolName ?? "tool", text: textOf(message), isError: message.isError === true, key });
      return;
    }
    if (message.role !== "assistant") return;
    partsOf(message).forEach((part, partIndex) => {
      if (part.type === "text" && part.text.trim() !== "") lines.push({ kind: "said", who: "child", text: part.text, key: `${key}.${String(partIndex)}`, ...(streaming ? { streaming } : {}) });
      if (part.type === "toolCall") {
        const invocationId = message.toolInvocations?.[part.id];
        const riskLabel = invocationId === undefined ? undefined
          : messageRiskLabels(message).find(entry => entry.invocationId === invocationId)?.label ?? labels.get(invocationId);
        lines.push({ kind: "tool", name: part.name, summary: summarize(part.arguments), key: `${key}.${String(partIndex)}`,
          ...(riskLabel === undefined ? {} : {riskLabel}) });
      }
    });
  };
  transcript.messages.forEach((message, index) => add(message, index));
  if (transcript.partial) add(transcript.partial, transcript.messages.length, true);
  return lines;
}

/** Children with an open question come first, then working ones and ones that wait to retry, then the rest, each oldest first. */
export function orderChildren(children: readonly ChildSummary[]): ChildSummary[] {
  const rank = (child: ChildSummary) => child.questions.length > 0 ? 0 : child.busy || child.retry ? 1 : 2;
  return [...children].sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt);
}

/**
 * The children whose open worktree Forgerie could not read. When more than one shares the failure, the list says it
 * once above the rows, and each row no longer repeats it (`childStatus` with `worktreeNotice`).
 */
export function unreadableWorktrees(children: readonly ChildSummary[]): ChildSummary[] {
  return children.filter((child) => child.worktree?.state === "active" && child.worktree.statusError !== undefined);
}

/** `worktreeNotice`: the list already says the worktree cannot be read, so the row says what else it knows. */
export function childStatus(child: ChildSummary, { worktreeNotice = false }: { worktreeNotice?: boolean } = {}): string {
  if (child.questions.length > 0) return child.questions.length === 1 ? "Waiting for your answer" : `${String(child.questions.length)} questions for you`;
  if (child.retry) return retryCount(child.retry);
  if (child.busy) return "Working";
  if (child.worktree?.state === "landed") return "Landed";
  if (child.worktree?.state === "discarded") return "Discarded";
  if (child.worktree?.statusError) return worktreeNotice ? "Idle" : "Cannot read worktree";
  if (child.worktree?.dirty) return "Uncommitted changes";
  return child.worktree && child.worktree.ahead > 0 ? "Ready to land" : "Idle";
}

/** The tone of a child's mark in a list. */
export function childTone(child: ChildSummary): "waiting" | "working" | "retrying" | "quiet" | "stopped" {
  if (child.questions.length > 0) return "waiting";
  if (child.retry) return "retrying";
  if (child.busy) return "working";
  return child.worktree?.state === "discarded" ? "stopped" : "quiet";
}

/**
 * A long name cut in its middle, so both the start and the end that tell names apart stay: "c-5676552a…1135941a0b".
 * The caller keeps the whole name reachable, such as in a title.
 */
export function middleCut(text: string, length: number): string {
  if (text.length <= length) return text;
  const keep = length - 1;
  const head = Math.ceil(keep / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`;
}

/**
 * Where a child's branch stands, after its name in a row: "3 commits ahead, uncommitted files", "no new commits", or the
 * worktree's closed state. `unread`: the list already says the worktree cannot be read, so the row says it is unknown.
 */
export function branchState(worktree: NonNullable<ChildSummary["worktree"]>, unread = false): string {
  if (unread) return "status unknown";
  if (worktree.state !== "active") return worktree.state;
  const ahead = worktree.ahead === 0 ? "no new commits" : `${String(worktree.ahead)} ${worktree.ahead === 1 ? "commit" : "commits"} ahead`;
  return worktree.dirty ? `${ahead}, uncommitted files` : ahead;
}

/** "Retrying 2 of 3". */
export function retryCount(retry: ChildRetry): string {
  return `Retrying ${String(retry.attempt)} of ${String(retry.max)}`;
}

/**
 * "Retrying 2 of 3: <the provider's error>", on one line, the error cut to `length` characters. It is for a row or
 * a card that opens the child, whose own view shows the whole error.
 */
export function retryLine(retry: ChildRetry, length: number): string {
  const error = retry.error.replace(/\s+/gu, " ").trim();
  return `${retryCount(retry)}: ${error.length > length ? `${error.slice(0, length - 1)}…` : error}`;
}

/** "Next try in 1 min 40 s", or "Trying again now" once the wait is over. Whole seconds, rounded up. */
export function retryWait(retry: ChildRetry, now: number): string {
  const seconds = Math.ceil((retry.until - now) / 1000);
  if (seconds <= 0) return "Trying again now";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  const time = minutes === 0 ? `${String(rest)} s` : rest === 0 ? `${String(minutes)} min` : `${String(minutes)} min ${String(rest)} s`;
  return `Next try in ${time}`;
}

/** Minutes without a tool call before a working child reads as possibly stuck. A guess: tune it from real runs. */
export const QUIET_MINUTES = 10;

/**
 * What a child did last, and how long ago. A working child with no tool call for QUIET_MINUTES says it may be stuck,
 * so the reader does not have to ask. Model output between tool calls does not count as activity here.
 */
export function lastToolLine(child: Pick<ChildSummary, "busy" | "lastTool">, now: number): { text: string; quiet: boolean } {
  const tool = child.lastTool;
  if (tool == null) return { text: "Last tool: Unavailable", quiet: false };
  if (tool.at === null) return { text: `Last tool: ${tool.name}`, quiet: false };
  const minutes = Math.max(0, Math.floor((now - tool.at) / 60_000));
  if (child.busy && minutes >= QUIET_MINUTES) return { text: `No tool call for ${String(minutes)} min (last: ${tool.name}). It may be stuck.`, quiet: true };
  return { text: `Last tool: ${tool.name}, ${minutes === 0 ? "under a minute ago" : `${String(minutes)} min ago`}`, quiet: false };
}

/** The soonest try any child waits for, so a clock ticks only while there is a wait to count. */
export function nextRetry(children: readonly { retry?: ChildRetry | undefined }[]): number | undefined {
  const times = children.flatMap((child) => child.retry ? [child.retry.until] : []);
  return times.length === 0 ? undefined : Math.min(...times);
}

/**
 * An answer belongs on its question's card, so the answer's own row leaves
 * the thread and its text moves onto the question.
 */
export function foldChildEntries<T extends { childEntry?: ChildEntry | undefined }>(messages: readonly T[]): readonly T[] {
  const answers = new Map<string, string>();
  const unanswered = new Map<string, number>();
  const cancelled = new Set<string>();
  for (const message of messages) {
    const entry = message.childEntry;
    if (entry?.kind === "question") unanswered.set(entry.questionId, entry.child);
    if (entry?.kind === "answer") { answers.set(entry.questionId, entry.answer); unanswered.delete(entry.questionId); }
    if (entry?.kind === "note" && entry.action === "stop") {
      for (const [id, child] of unanswered) if (child === entry.child) { cancelled.add(id); unanswered.delete(id); }
    }
  }
  if (answers.size === 0 && cancelled.size === 0) return messages;
  return messages.flatMap((message) => {
    const entry = message.childEntry;
    if (entry?.kind === "answer") return [];
    const answer = entry?.kind === "question" ? answers.get(entry.questionId) : undefined;
    if (entry?.kind === "question" && cancelled.has(entry.questionId) && answer === undefined) return [{ ...message, childEntry: { ...entry, cancelled: true } }];
    return entry?.kind === "question" && answer !== undefined ? [{ ...message, childEntry: { ...entry, answer } }] : [message];
  });
}
