import { z } from "zod";
import { worktreeInfoSchema } from "./worktrees/worktreeApi";

// Only the consumed fields are specified. Pi's other parts remain server-owned.
/** One model Pi offers a session. Only `provider` and `id` are required to pick it. */
export const sessionModelSchema = z.object({
  provider: z.string().optional(),
  id: z.string().optional(),
  name: z.string().optional(),
  contextWindow: z.number().optional(),
  reasoning: z.unknown().optional(),
  /** Set on the models Pi's `enabledModels` setting holds. */
  scoped: z.boolean().optional(),
});
export type SessionModel = z.infer<typeof sessionModelSchema>;
export const modelsResponseSchema = z.object({ models: z.array(sessionModelSchema) });
export const thinkingLevelsResponseSchema = z.object({ levels: z.array(z.string()) });
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
  // Tool-specific result facts, such as the session a handoff created.
  details: z.unknown().optional(),
  // bashExecution messages only: a `!` or `!!` command the user ran.
  command: z.string().optional(),
  output: z.string().optional(),
  exitCode: z.number().nullable().optional(),
  cancelled: z.boolean().optional(),
  truncated: z.boolean().optional(),
  fullOutputPath: z.string().optional(),
  excludeFromContext: z.boolean().optional(),
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
/**
 * One open extension dialog (`ctx.ui.confirm`, `select`, or `input`). The
 * daemon owns it and lists every open one in status, oldest first.
 */
export const pendingDialogSchema = z.object({
  dialogId: z.string().min(1),
  // A kind this client cannot draw still shows, so the user can skip it.
  kind: z.enum(["confirm", "select", "input", "unknown"]).catch("unknown"),
  title: z.string(),
  message: z.string().optional(),
  options: z.array(z.string()).optional(),
  placeholder: z.string().optional(),
  askedAt: z.string(),
  timeoutAt: z.string().optional(),
});
export type PendingDialog = z.infer<typeof pendingDialogSchema>;
/** The longest text an `input` dialog accepts. */
export const DIALOG_INPUT_MAX_LENGTH = 4_000;
export const statusSchema = z.object({
  isStreaming: z.boolean(),
  isCompacting: z.boolean(),
  isBashRunning: z.boolean(),
  pendingAsk: pendingAskSchema.optional(),
  model: sessionModelSchema.optional(),
  thinkingLevel: z.string().optional(),
  // A dialog of a kind this client does not know stays out of the list, not the whole status.
  // A malformed dialog stays out of the list, not the whole status.
  pendingDialogs: z.preprocess((items) => Array.isArray(items) ? items.filter((item) => pendingDialogSchema.safeParse(item).success) : items,
    z.array(pendingDialogSchema)).optional(),
  queuedMessages: z.array(z.object({ kind: z.enum(["steer", "followUp"]), text: z.string() })).default([]),
  // Only the percent is shown. A malformed reading drops out, not the whole status.
  contextUsage: z.object({ percent: z.number().nullable() }).optional().catch(undefined),
  /** A session whose worktree was landed or discarded. Its transcript is saved; Pi does not run. */
  readOnly: z.boolean().optional().catch(undefined),
  worktree: worktreeInfoSchema.optional().catch(undefined),
});
export type SessionStatus = z.infer<typeof statusSchema>;
export const abortResultSchema = z.object({
  aborted: z.literal(true),
  restoredMessages: z.array(z.object({ kind: z.enum(["steer", "followUp"]), text: z.string() })).default([]),
});
/** `stale` is an ordinary race: the ask already closed. The status is current in both cases. */
export const askCloseResponseSchema = z.object({
  result: z.enum(["closed", "stale"]), sessionStatus: statusSchema,
});
/** `stale` is an ordinary race: the dialog already closed. The status is current in both cases. */
export const dialogCloseResponseSchema = z.object({
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
  // `content` is the raw result. It carries images that `text` only names.
  // `details` carries tool-specific facts, such as the session a handoff created.
  z.object({ type: z.literal("tool.end"), toolCallId: z.string(), toolName: z.string(), text: z.string(), isError: z.boolean(),
    content: z.unknown().optional(), details: z.unknown().optional() }),
  z.object({ type: z.literal("agent.start") }),
  z.object({ type: z.literal("agent.end") }),
  z.object({ type: z.literal("session.error"), message: z.string() }),
  // A user's `!` command. No message event announces its saved record.
  z.object({ type: z.literal("shell.start"), command: z.string(), excludeFromContext: z.boolean().optional() }),
  z.object({ type: z.literal("shell.chunk"), chunk: z.string() }),
  // `output` is the whole result. With `isError`, it is the failure message instead.
  z.object({ type: z.literal("shell.end"), output: z.string().optional(), exitCode: z.number().nullable().optional(),
    cancelled: z.boolean().optional(), truncated: z.boolean().optional(), fullOutputPath: z.string().optional(),
    isError: z.boolean().optional() }),
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
  "tool.start", "tool.update", "tool.end", "agent.start", "agent.end", "session.error",
  "shell.start", "shell.chunk", "shell.end"]);
const operationEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("status.update"), status: statusSchema }),
  z.object({ type: z.literal("command.output"), level: z.enum(["info", "success", "error"]), message: z.string() }),
]).and(z.object({ seq: z.number().optional() }));
export type OperationEvent = z.infer<typeof operationEventSchema>;
export type CommandOutput = Extract<OperationEvent, { type: "command.output" }>;
export type UiEvent = SessionEvent | AskEvent | OperationEvent;
export function isOperationEvent(event: UiEvent): event is OperationEvent {
  return event.type === "status.update" || event.type === "command.output";
}
export function parseEvent(value: unknown): UiEvent | undefined {
  const envelope = eventEnvelope.parse(value);
  if (envelope.type === "ask.opened" || envelope.type === "ask.closed") return askEventSchema.parse(value);
  if (envelope.type === "status.update" || envelope.type === "command.output") return operationEventSchema.parse(value);
  return consumedTypes.has(envelope.type) ? eventSchema.parse(value) : undefined;
}
export function isAskEvent(event: UiEvent): event is AskEvent {
  return event.type === "ask.opened" || event.type === "ask.closed";
}
