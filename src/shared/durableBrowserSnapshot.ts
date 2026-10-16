import { z } from "zod";

/** Allowlisted browser messages. Provider identity and private block fields are not wire state. */
export const durableBrowserMessageSchema = z.object({
  id: z.string().min(1).optional(),
  role: z.string(),
  toolInvocations: z.record(z.string(), z.string()).optional().catch(undefined),
  decisionAnnotations: z.array(z.unknown()).optional().catch(undefined),
  content: z.union([z.string(), z.array(z.discriminatedUnion("type", [
    z.object({ type: z.literal("text"), text: z.string() }),
    z.object({ type: z.literal("thinking"), thinking: z.string() }),
    z.object({ type: z.literal("toolCall"), id: z.string(), name: z.string(), arguments: z.unknown() }),
    // Live socket frames carry `url` instead of `data`; the browser loads the bytes by reference.
    z.object({ type: z.literal("image"), data: z.string().optional(), url: z.string().optional(), mimeType: z.string() }),
  ]))]).optional(),
  timestamp: z.number().optional(), stopReason: z.string().optional(), errorMessage: z.string().optional(),
  toolCallId: z.string().optional(), toolName: z.string().optional(), isError: z.boolean().optional(),
  customType: z.string().optional(), details: z.unknown().optional(), source: z.string().optional(),
  command: z.string().optional(), output: z.string().optional(), exitCode: z.number().nullable().optional(),
  cancelled: z.boolean().optional(), truncated: z.boolean().optional(), excludeFromContext: z.boolean().optional(),
});
export type DurableBrowserMessage = z.infer<typeof durableBrowserMessageSchema>;

const questionSchema = z.object({
  id: z.string().min(1), question: z.string(), detail: z.string().optional(), multiple: z.boolean().optional(),
  options: z.array(z.object({ value: z.string().min(1), label: z.string(), detail: z.string().optional() })),
});
/** The app-state adapter projects document state into this allowlist, not raw documents. */
export const durableBrowserAppStateSchema = z.object({
  sessionName: z.string().optional(),
  pendingAsk: z.object({ askId: z.string().min(1), askedAt: z.string(), questions: z.array(questionSchema).min(1) }).optional(),
  response: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("none") }),
    z.object({ kind: z.literal("needs-response"), reason: z.enum(["reply", "questions", "undeclared"]) }),
  ]),
});
export type DurableBrowserAppState = z.infer<typeof durableBrowserAppStateSchema>;

export const durableBrowserSnapshotSchema = z.object({
  type: z.literal("session.snapshot"),
  epoch: z.string().min(1), revision: z.number().int().nonnegative(),
  history: z.object({ messages: z.array(durableBrowserMessageSchema), start: z.number().int().nonnegative(), total: z.number().int().nonnegative() }),
  partial: durableBrowserMessageSchema.nullable(),
  app: durableBrowserAppStateSchema.optional(),
  tools: z.array(z.object({ toolCallId: z.string(), toolName: z.string(), status: z.enum(["pending", "running", "done"]), output: z.string() })),
  queuedMessages: z.array(z.object({ kind: z.enum(["steer", "followUp"]), text: z.string() })),
  isStreaming: z.boolean(), isCompacting: z.boolean(),
});
export type DurableBrowserSnapshot = z.infer<typeof durableBrowserSnapshotSchema>;
