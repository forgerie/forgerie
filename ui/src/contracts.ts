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
export const statusSchema = z.object({
  isStreaming: z.boolean(),
  isCompacting: z.boolean(),
  isBashRunning: z.boolean(),
});
export const snapshotSchema = z.object({ seq: z.number(), partial: piMessageSchema.nullable() });
export const acceptedSchema = z.object({ accepted: z.literal(true) });
export const errorSchema = z.object({ error: z.string() });
const contentPartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("thinking"), thinking: z.string() }),
  z.object({ type: z.literal("toolCall"), id: z.string(), name: z.string(), arguments: z.unknown() }),
  z.object({ type: z.literal("image") }),
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
const eventEnvelope = z.object({ type: z.string() });
const consumedTypes = new Set(["message.append", "message.end", "assistant.delta", "assistant.thinking.delta",
  "tool.start", "tool.update", "tool.end", "agent.start", "agent.end", "session.error"]);
export function parseEvent(value: unknown): SessionEvent | undefined {
  const envelope = eventEnvelope.parse(value);
  return consumedTypes.has(envelope.type) ? eventSchema.parse(value) : undefined;
}
