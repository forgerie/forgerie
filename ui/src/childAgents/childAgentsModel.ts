// Child agents a session runs in its own Durable storage. The server side is
// src/server/sessions/durableChildAgents.ts; the routes are durableChildRoutes.ts.
import { z } from "zod";
import { partsOf, piMessageSchema, textOf, type PiMessage } from "../contracts";

export const childQuestionSchema = z.object({ questionId: z.string(), question: z.string(), askedAt: z.number() });
export const childSummarySchema = z.object({
  name: z.string(),
  conversationId: z.number(),
  agent: z.string().nullable(),
  busy: z.boolean(),
  createdAt: z.number(),
  questions: z.array(childQuestionSchema),
});
export const childSummariesSchema = z.array(childSummarySchema);
export const childTranscriptSchema = z.object({
  messages: z.array(piMessageSchema),
  busy: z.boolean(),
  partial: piMessageSchema.optional(),
});
export type ChildQuestion = z.infer<typeof childQuestionSchema>;
export type ChildSummary = z.infer<typeof childSummarySchema>;
export type ChildTranscript = z.infer<typeof childTranscriptSchema>;

/** The server's event when any child starts, ends, asks, or is answered. */
export const CHILDREN_CHANGED_EVENT = "durable_children_changed";

// Transcript entries the server writes into the parent session.
export const CHILD_QUESTION_TYPE = "forgerie.child-question";
export const CHILD_ANSWER_TYPE = "forgerie.child-answer";
export const CHILD_NOTE_TYPE = "forgerie.child-note";

/** Something a child did, as the parent's transcript records it. */
export type ChildEntry =
  | { kind: "question"; questionId: string; child: number; childName: string; question: string; answer?: string }
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
    case CHILD_QUESTION_TYPE: return { kind: "question", questionId: str(details, "questionId"), child: num(details, "child"),
      childName: str(details, "childName") || "child", question: str(details, "question") };
    case CHILD_ANSWER_TYPE: return { kind: "answer", questionId: str(details, "questionId"), answer: str(details, "answer") };
    case CHILD_NOTE_TYPE: return { kind: "note", child: num(details, "child"), childName: str(details, "childName"),
      action: str(details, "action") === "stop" ? "stop" : "message", text: str(details, "text").replace(/^\[[^\]]*\]\s*/u, "") };
    default: return undefined;
  }
}

const REPORT = /^\[subagent (\S+) (answered, no reply needed|failed: [^\]]*)\]\s?([\s\S]*)$/u;
/** A child's answer or failure, which the server posts to the parent model as a user message. */
export function reportOf(text: string): ChildEntry | undefined {
  const match = REPORT.exec(text);
  if (!match) return undefined;
  const failed = match[2]!.startsWith("failed");
  return { kind: "report", childName: match[1]!, outcome: failed ? "failed" : "answered", text: failed ? match[2]!.slice("failed: ".length) : match[3]!.trim() };
}

/** One line of a child's transcript for the child view. */
export type ChildLine =
  | { kind: "said"; who: "message" | "child"; text: string; key: string; streaming?: boolean }
  | { kind: "tool"; name: string; summary: string; key: string }
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
      if (part.type === "toolCall") lines.push({ kind: "tool", name: part.name, summary: summarize(part.arguments), key: `${key}.${String(partIndex)}` });
    });
  };
  transcript.messages.forEach((message, index) => add(message, index));
  if (transcript.partial) add(transcript.partial, transcript.messages.length, true);
  return lines;
}

/** Children with an open question come first, then working ones, then the rest, each oldest first. */
export function orderChildren(children: readonly ChildSummary[]): ChildSummary[] {
  const rank = (child: ChildSummary) => child.questions.length > 0 ? 0 : child.busy ? 1 : 2;
  return [...children].sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt);
}

export function childStatus(child: ChildSummary): string {
  if (child.questions.length > 0) return child.questions.length === 1 ? "Waiting for your answer" : `${String(child.questions.length)} questions for you`;
  return child.busy ? "Working" : "Idle";
}

/**
 * An answer belongs on its question's card, so the answer's own row leaves
 * the thread and its text moves onto the question.
 */
export function foldChildEntries<T extends { childEntry?: ChildEntry | undefined }>(messages: readonly T[]): readonly T[] {
  const answers = new Map<string, string>();
  for (const message of messages) if (message.childEntry?.kind === "answer") answers.set(message.childEntry.questionId, message.childEntry.answer);
  if (answers.size === 0) return messages;
  return messages.flatMap((message) => {
    const entry = message.childEntry;
    if (entry?.kind === "answer") return [];
    const answer = entry?.kind === "question" ? answers.get(entry.questionId) : undefined;
    return entry?.kind === "question" && answer !== undefined ? [{ ...message, childEntry: { ...entry, answer } }] : [message];
  });
}
