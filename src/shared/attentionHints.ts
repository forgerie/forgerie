import { z } from "zod";

export const attentionKindSchema = z.enum(["decision", "review", "blocked", "failed", "done", "fyi"]);
export const attentionUrgencySchema = z.enum(["low", "normal", "high"]);
/** Server-selected display data only. Probabilities and plugin settings stay on the server. */
export const attentionHintSchema = z.object({
  turnId: z.string(), model: z.string(), at: z.string(), likelyNeedsYou: z.boolean(),
  kind: attentionKindSchema.optional(), urgency: attentionUrgencySchema.optional(),
});
export type AttentionHint = z.infer<typeof attentionHintSchema>;
