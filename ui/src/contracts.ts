import { z } from "zod";

// Only the consumed fields are specified. Pi's other parts remain server-owned.
export const piMessageSchema = z.object({
  role: z.string(),
  content: z.union([z.string(), z.array(z.unknown())]).optional(),
  timestamp: z.number().optional(),
  stopReason: z.string().optional(),
  errorMessage: z.string().optional(),
  // toolResult messages only.
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  isError: z.boolean().optional(),
});
export type PiMessage = z.infer<typeof piMessageSchema>;
export const sessionSchema = z.object({
  id: z.string().min(1), cwd: z.string().min(1), name: z.string().optional(),
});
export type Session = z.infer<typeof sessionSchema>;
export const catalogSchema = z.object({ sessions: z.array(sessionSchema) });
export const historySchema = z.object({
  messages: z.array(piMessageSchema), start: z.number(), total: z.number(),
});
export const askQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string(),
  detail: z.string().optional(),
  options: z.array(z.object({ value: z.string().min(1), label: z.string(), detail: z.string().optional() })),
  multiple: z.boolean().optional(),
});
export type AskQuestion = z.infer<typeof askQuestionSchema>;
/** The session's open `ask_user` question set. The daemon owns it. */
export const pendingAskSchema = z.object({
  askId: z.string().min(1), askedAt: z.string(), questions: z.array(askQuestionSchema),
});
export type PendingAsk = z.infer<typeof pendingAskSchema>;
/** One reply. A question without an entry is reported to the model as unanswered. */
export interface AskAnswer { id: string; values: string[]; otherText?: string }
export const statusSchema = z.object({
  isStreaming: z.boolean(),
  isCompacting: z.boolean(),
  isBashRunning: z.boolean(),
  pendingAsk: pendingAskSchema.optional(),
});
/** `stale` is an ordinary race: the ask already closed. The status is current in both cases. */
export const askCloseResponseSchema = z.object({
  result: z.enum(["closed", "stale"]), sessionStatus: statusSchema,
});
export const snapshotSchema = z.object({ seq: z.number(), partial: piMessageSchema.nullable() });
export const acceptedSchema = z.object({ accepted: z.literal(true) });
export const errorSchema = z.object({ error: z.string() });
const contentPartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("thinking"), thinking: z.string() }),
  z.object({ type: z.literal("toolCall"), id: z.string(), name: z.string(), arguments: z.unknown() }),
  z.object({ type: z.literal("image"), data: z.string().optional(), mimeType: z.string().optional() }),
]);
export type ContentPart = z.infer<typeof contentPartSchema>;
/** The consumed content parts, in order. Unknown or malformed parts are skipped. */
export function partsOf(message: PiMessage): ContentPart[] {
  if (typeof message.content === "string") return [{ type: "text", text: message.content }];
  return (message.content ?? []).flatMap((part) => {
    const result = contentPartSchema.safeParse(part);
    return result.success ? [result.data] : [];
  });
}
export function textOf(message: PiMessage): string {
  return partsOf(message).flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
}
/** Tool output as text. Images are named, not embedded. */
export function outputOf(message: PiMessage): string {
  return partsOf(message).flatMap((part) => part.type === "text" ? [part.text]
    : part.type === "image" ? ["[image]"] : []).join("\n");
}

const eventBodySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message.append"), message: piMessageSchema }),
  z.object({ type: z.literal("message.end"), message: piMessageSchema.optional() }),
  z.object({ type: z.literal("assistant.delta"), text: z.string() }),
  z.object({ type: z.literal("assistant.thinking.delta"), text: z.string() }),
  z.object({ type: z.literal("tool.start"), toolCallId: z.string(), toolName: z.string(), args: z.unknown() }),
  z.object({ type: z.literal("tool.update"), toolCallId: z.string(), toolName: z.string(), text: z.string() }),
  z.object({ type: z.literal("tool.end"), toolCallId: z.string(), toolName: z.string(), text: z.string(), isError: z.boolean() }),
  z.object({ type: z.literal("agent.start") }),
  z.object({ type: z.literal("agent.end") }),
  z.object({ type: z.literal("session.error"), message: z.string() }),
]);
export const eventSchema = eventBodySchema.and(z.object({ seq: z.number().optional() }));
export type SessionEvent = z.infer<typeof eventSchema>;
// Ask events change what the input region shows, not the transcript.
const askEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ask.opened"), ask: pendingAskSchema }),
  // The reason is informational. New server reasons must not break the socket.
  z.object({ type: z.literal("ask.closed"), askId: z.string(), reason: z.string() }),
]).and(z.object({ seq: z.number().optional() }));
export type AskEvent = z.infer<typeof askEventSchema>;
const eventEnvelope = z.object({ type: z.string() });
const consumedTypes = new Set(["message.append", "message.end", "assistant.delta", "assistant.thinking.delta",
  "tool.start", "tool.update", "tool.end", "agent.start", "agent.end", "session.error"]);
export function parseEvent(value: unknown): SessionEvent | AskEvent | undefined {
  const envelope = eventEnvelope.parse(value);
  if (envelope.type === "ask.opened" || envelope.type === "ask.closed") return askEventSchema.parse(value);
  return consumedTypes.has(envelope.type) ? eventSchema.parse(value) : undefined;
}
export function isAskEvent(event: SessionEvent | AskEvent): event is AskEvent {
  return event.type === "ask.opened" || event.type === "ask.closed";
}
