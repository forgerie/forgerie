import { z } from "zod";
import { durableBrowserSnapshotSchema } from "./durableBrowserSnapshot.js";

export const FIRST_PAGE_LIMIT = 50;
const safePosition = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const identity = z.string().min(1);

/** Semantic request after transport query decoding; routing still normalizes cwd. */
export const sessionOpenRequestSchema = z.object({
  cwd: identity.refine(value => value.startsWith("/") && !value.includes("\0"), "cwd must be an absolute path without NUL"),
  limit: z.number().int().min(1).max(500).default(FIRST_PAGE_LIMIT),
  around: safePosition.optional(),
});
export type SessionOpenRequest = z.infer<typeof sessionOpenRequestSchema>;

const queryInteger = z.string().regex(/^\d+$/u, "Expected a nonnegative integer").transform(Number);
export const sessionOpenQuerySchema = z.object({ cwd: sessionOpenRequestSchema.shape.cwd,
  limit: queryInteger.pipe(z.number().int().min(1).max(500)).optional(),
  around: queryInteger.pipe(safePosition).optional(),
}).transform(value => sessionOpenRequestSchema.parse(value));
export const sessionEarlierQuerySchema = z.object({ cwd: sessionOpenRequestSchema.shape.cwd,
  limit: queryInteger.pipe(z.number().int().min(1).max(500)).prefault("50"),
  before: queryInteger.pipe(safePosition), historyId: identity,
});

/** A pre-read completion boundary, never permission to acknowledge later work. */
export const sessionOpenReceiptSchema = z.object({
  catalogId: identity,
  throughCompletionOrder: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
export type SessionOpenReceipt = z.infer<typeof sessionOpenReceiptSchema>;

/** Synthesized unsaved host output, not an SDK transcript or a process record. */
export const sessionOpenTransientEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("shell.start"), command: z.string(), excludeFromContext: z.boolean().optional() }),
  z.object({ type: z.literal("shell.chunk"), chunk: z.string() }),
  z.object({ type: z.literal("shell.end"), output: z.string().optional(), exitCode: z.number().nullable().optional(),
    cancelled: z.boolean().optional(), truncated: z.boolean().optional(), fullOutputPath: z.string().optional(), isError: z.boolean().optional() }),
  z.object({ type: z.literal("command.output"), level: z.enum(["info", "success", "error"]), message: z.string() }),
]);
export type SessionOpenTransientEvent = z.infer<typeof sessionOpenTransientEventSchema>;

/** Message and status adapters supply their existing allowlists; this owns the envelope. */
export function createSessionOpenSchema<MessageSchema extends z.ZodType, StatusSchema extends z.ZodType>(message: MessageSchema, status: StatusSchema) {
  return z.object({
    session: z.object({ id: identity, cwd: identity, name: z.string().optional() }),
    readPath: z.enum(["classic", "native"]),
    /** The authority and consistency used for this cut; optional for older transports. */
    cut: z.enum(["native", "classic", "sequential"]).optional(),
    statusSeq: safePosition.optional(),
    /** Latest observed committed native run start, in this epoch's event sequence; zero means unknown. */
    runStartSeq: safePosition.optional(),
    epoch: identity,
    seq: safePosition,
    historyId: identity,
    page: historyPageSchema(message),
    snapshot: z.object({
      seq: safePosition,
      partial: message.nullable(),
      tools: durableBrowserSnapshotSchema.shape.tools,
      transientEvents: z.array(sessionOpenTransientEventSchema),
    }),
    status,
    receipt: sessionOpenReceiptSchema.nullable(),
  }).superRefine((value, context) => {
    if (value.cut === "sequential" && value.statusSeq === undefined) context.addIssue({ code: "custom", path: ["statusSeq"], message: "Sequential facade reads require a status boundary" });
    if (value.runStartSeq !== undefined && value.runStartSeq > value.seq) context.addIssue({ code: "custom", path: ["runStartSeq"], message: "Run boundary must be covered by the open watermark" });
    if (value.seq !== value.snapshot.seq) context.addIssue({ code: "custom", path: ["snapshot", "seq"], message: "Open and snapshot watermarks must match" });
  });
}
export type SessionOpenResponse<Message, Status> = z.output<ReturnType<typeof createSessionOpenSchema<z.ZodType<Message>, z.ZodType<Status>>>>;

/** A cursor is valid only within this append-only presentation history. */
export function createSessionHistoryPageSchema<MessageSchema extends z.ZodType>(message: MessageSchema) {
  return historyPageSchema(message).extend({ historyId: identity, epoch: identity, seq: safePosition });
}
export type SessionHistoryPage<Message> = z.output<ReturnType<typeof createSessionHistoryPageSchema<z.ZodType<Message>>>>;

function historyPageSchema<MessageSchema extends z.ZodType>(message: MessageSchema) {
  return z.object({ messages: z.array(message), start: safePosition, total: safePosition }).superRefine((value, context) => {
    if (value.start > value.total || value.messages.length > value.total - value.start) {
      context.addIssue({ code: "custom", path: ["start"], message: "Page must fit within the presentation history" });
    }
  });
}
