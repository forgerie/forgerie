import { z } from "zod";

/** Opaque delivery identity, scoped to one Durable conversation, not to its text. */
export const promptRequestOptionsSchema = z.object({
  requestId: z.string().min(1).max(256).regex(/^[A-Za-z0-9._:-]+$/u).optional(),
});
export type PromptRequestOptions = z.infer<typeof promptRequestOptionsSchema>;
