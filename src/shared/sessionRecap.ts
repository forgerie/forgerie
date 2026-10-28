import { z } from "zod";

export const RECAP_ENTRY_KIND = "forgerie.recap";
export const RECAP_DELAY_MS = 10 * 60 * 1000;
export const recapContentSchema = z.strictObject({
  goal: z.string().trim().min(1).max(160),
  done: z.array(z.string().trim().min(1).max(200)).max(4),
  left: z.array(z.string().trim().min(1).max(200)).max(4),
  next: z.string().trim().min(1).max(200).nullable(),
});
export const recapTriggerSchema = z.enum(["automatic", "open", "manual"]);
export const recapDataSchema = recapContentSchema.extend({
  trigger: recapTriggerSchema,
  model: z.string().min(1),
  messageCount: z.number().int().positive(),
  coversThroughEntryId: z.string().min(1),
  runEndedAt: z.iso.datetime(),
  generatedAt: z.iso.datetime(),
});
export const recapRequestSchema = z.strictObject({ cwd: z.string().min(1), trigger: z.enum(["open", "manual"]) });
export const recapResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("written") }),
  z.object({ kind: z.literal("skipped") }),
  z.object({ kind: z.literal("failed"), message: z.string() }),
]);
export type RecapContent = z.infer<typeof recapContentSchema>;
export type RecapData = z.infer<typeof recapDataSchema>;
export type RecapTrigger = z.infer<typeof recapTriggerSchema>;
export type RecapResult = z.infer<typeof recapResultSchema>;
