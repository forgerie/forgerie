import { z } from "zod";

/** Server-owned intent. The client never classifies assistant prose. */
export const sessionResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("needs-response"), reason: z.enum(["reply", "questions", "undeclared"]) }),
]);
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
