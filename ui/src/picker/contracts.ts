import { attentionHintSchema } from "@shared/attentionHints";
import { sessionResponseSchema } from "../sessionResponse";
import { z } from "zod";
import { worktreeInfoSchema } from "../worktrees/worktreeApi";

// Only the fields the picker consumes. Everything else stays server-owned.
export const pickerSessionSchema = z.object({
  id: z.string().min(1),
  cwd: z.string().min(1),
  name: z.string().optional(),
  modified: z.string(),
  archived: z.boolean().optional(),
  pinned: z.boolean().optional(),
  agentSpawned: z.boolean().optional(),
  response: sessionResponseSchema.optional(),
  // A malformed worktree drops out, not the whole listing.
  worktree: worktreeInfoSchema.optional().catch(undefined),
});
const blockers = {
  pendingAsk: z.object({ askId: z.string() }).optional(),
  pendingDialogs: z.array(z.object({ dialogId: z.string() })).optional(),
};
export const wireStatusSchema = z.object({
  attentionHint: attentionHintSchema.optional().catch(undefined),
  sessionId: z.string(),
  isStreaming: z.boolean(),
  isCompacting: z.boolean(),
  isBashRunning: z.boolean(),
  workingAgents: z.number().optional(),
  runningProcesses: z.number().optional(),
  waitingOnYou: z.number().optional(),
  /** Flagged guesses in the session's decision log that still stand. Nothing waits on them. */
  flaggedDecisions: z.number().optional().catch(undefined),
  watchingPullRequest: z.boolean().optional(),
  watchingActionRun: z.boolean().optional(),
  ...blockers,
  response: sessionResponseSchema.optional(),
});
export type WireStatus = z.infer<typeof wireStatusSchema>;
export const wireActivitySchema = z.object({
  sessionId: z.string(),
  phase: z.enum(["active", "idle", "error"]),
  activeSince: z.string().optional(),
});
export const listingSchema = z.object({
  sessions: z.array(pickerSessionSchema),
  statuses: z.array(wireStatusSchema),
  activities: z.array(wireActivitySchema),
});
export const asksSchema = z.object({ sessions: z.array(z.object({ id: z.string(), ...blockers })) });
const receiptFields = { catalogId: z.string().min(1).optional(), cwd: z.string().startsWith("/").optional(),
  completionOrder: z.number().int().nonnegative().safe().optional() };
export const unreadSchema = z.object({ catalogId: receiptFields.catalogId,
  sessions: z.array(z.object({ sessionId: z.string(), cwd: receiptFields.cwd, completionOrder: receiptFields.completionOrder })) });
export const deleteArchivedSchema = z.object({
  deletedSessionIds: z.array(z.string()),
  failures: z.array(z.object({ sessionId: z.string(), error: z.string() })),
});
export const projectsSchema = z.array(z.object({ id: z.string(), name: z.string(), path: z.string() }));

const catalogEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("status.update"), status: wireStatusSchema }),
  z.object({ type: z.literal("activity.update"), activity: wireActivitySchema }),
  z.object({ type: z.literal("session.created"), session: pickerSessionSchema }),
  z.object({ type: z.literal("session.name"), sessionId: z.string(), name: z.string().optional() }),
  z.object({ type: z.literal("session.pinned"), sessionId: z.string(), pinned: z.boolean() }),
  z.object({ type: z.literal("sessions.unread"), sessionId: z.string(), catalogId: receiptFields.catalogId, cwd: receiptFields.cwd, unread: z.object({ completionOrder: receiptFields.completionOrder }).passthrough().nullable() }),
]);
export type CatalogEvent = z.infer<typeof catalogEventSchema>;
/**
 * What a session start is waiting on, labelled with the create request's
 * `startupToken`. Phase "idle" ends the startup window.
 */
export const startupEventSchema = z.object({
  type: z.literal("session.startup"), startupToken: z.string().optional(),
  activity: z.object({ sessionId: z.string(), phase: z.enum(["active", "idle", "error"]), label: z.string(), detail: z.string().optional() }),
});
export type StartupEvent = z.infer<typeof startupEventSchema>;
const consumed = new Set(["status.update", "activity.update", "session.created", "session.name", "session.pinned", "sessions.unread"]);
/** Parse one machine event. Types the picker does not consume return undefined. */
export function parseCatalogEvent(value: unknown): CatalogEvent | undefined {
  const type = z.object({ type: z.string() }).parse(value).type;
  return consumed.has(type) ? catalogEventSchema.parse(value) : undefined;
}
