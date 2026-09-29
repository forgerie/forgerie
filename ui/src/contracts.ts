import { z } from "zod";

// Only the consumed fields are specified. Pi's other parts remain server-owned.
export const piMessageSchema = z.object({
  role: z.string(),
  content: z.union([z.string(), z.array(z.unknown())]).optional(),
  timestamp: z.number().optional(),
  stopReason: z.string().optional(),
  errorMessage: z.string().optional(),
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
const textPartSchema = z.object({ type: z.literal("text"), text: z.string() });
export function textOf(message: PiMessage): string {
  if (typeof message.content === "string") return message.content;
  return (message.content ?? []).flatMap((part) => {
    const result = textPartSchema.safeParse(part);
    return result.success ? [result.data.text] : [];
  }).join("\n");
}

const eventBodySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message.append"), message: piMessageSchema }),
  z.object({ type: z.literal("message.end"), message: piMessageSchema.optional() }),
  z.object({ type: z.literal("assistant.delta"), text: z.string() }),
  z.object({ type: z.literal("agent.start") }),
  z.object({ type: z.literal("agent.end") }),
  z.object({ type: z.literal("session.error"), message: z.string() }),
]);
export const eventSchema = eventBodySchema.and(z.object({ seq: z.number().optional() }));
export type SessionEvent = z.infer<typeof eventSchema>;
const eventEnvelope = z.object({ type: z.string() });
const consumedTypes = new Set(["message.append", "message.end", "assistant.delta", "agent.start", "agent.end", "session.error"]);
export function parseEvent(value: unknown): SessionEvent | undefined {
  const envelope = eventEnvelope.parse(value);
  return consumedTypes.has(envelope.type) ? eventSchema.parse(value) : undefined;
}
