import { z } from "zod";
import { SESSION_UNREAD_CWD_MAX_LENGTH } from "./apiTypes.js";

export const RECAP_ENTRY_KIND = "forgerie.recap";
export const RECAP_AWAY_MS = 30 * 60 * 1000;
export const RECAP_UNSEEN_TURNS = 2;
export const RECAP_LONG_REPLY_CHARS = 2_000;
export const SESSION_SEEN_MARKER_MAX_LENGTH = 1024;
const seenFields = { cwd: z.string().min(1).max(SESSION_UNREAD_CWD_MAX_LENGTH), seenThrough: z.string().min(1).max(SESSION_SEEN_MARKER_MAX_LENGTH).optional() };
export const sessionSeenRequestSchema = z.union([
  z.strictObject(seenFields),
  z.strictObject({ ...seenFields, arrival: z.literal(true), active: z.boolean() }),
]);
export const sessionSeenResultSchema = z.object({ arrivalId: z.uuid().optional() });
export type SessionSeenRequest = z.infer<typeof sessionSeenRequestSchema>;
export type SessionSeenResult = z.infer<typeof sessionSeenResultSchema>;
export interface SessionSeenState { lastSeenAt: number; seenThrough?: string }
export const RECAP_SUMMARY_MAX = 360;
/** What the recap model returns: two or three short sentences, nothing more. */
export const recapContentSchema = z.strictObject({
  summary: z.string().trim().min(1).max(RECAP_SUMMARY_MAX),
});
/** Recaps saved before the brief summary. They stay readable; nothing writes them now. */
export const legacyRecapContentSchema = z.strictObject({
  goal: z.string().trim().min(1).max(160),
  done: z.array(z.string().trim().min(1).max(200)).max(4),
  left: z.array(z.string().trim().min(1).max(200)).max(4),
  next: z.string().trim().min(1).max(200).nullable(),
});
export const recapTriggerSchema = z.enum(["automatic", "open", "manual"]);
const recapMetadata = {
  trigger: recapTriggerSchema,
  model: z.string().min(1),
  messageCount: z.number().int().positive(),
  coversThroughEntryId: z.string().min(1),
  runEndedAt: z.iso.datetime(),
  generatedAt: z.iso.datetime(),
};
/** Unknown keys, such as the SDK projection's identity stamps, are stripped, not rejected. */
export const recapDataSchema = z.union([
  z.object({ ...recapContentSchema.shape, ...recapMetadata }),
  z.object({ ...legacyRecapContentSchema.shape, ...recapMetadata }),
]);
export const recapRequestSchema = z.strictObject({ cwd: z.string().min(1), trigger: z.enum(["open", "manual"]), arrivalId: z.uuid().optional() });
export const recapResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("written") }),
  z.object({ kind: z.literal("skipped") }),
  z.object({ kind: z.literal("failed"), message: z.string() }),
]);
export type RecapContent = z.infer<typeof recapContentSchema>;
export type RecapData = z.infer<typeof recapDataSchema>;
export type RecapTrigger = z.infer<typeof recapTriggerSchema>;
export type RecapResult = z.infer<typeof recapResultSchema>;

