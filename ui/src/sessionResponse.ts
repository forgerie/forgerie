import { z } from "zod";

/** Server-owned intent. The client never classifies assistant prose. */
export const sessionResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("needs-response"), reason: z.enum(["reply", "questions", "undeclared"]) }),
]);
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

/** A missing end_turn declaration is not an explicit request for the reader. */
export function requestsResponse(response: SessionResponse | undefined): boolean {
  return response?.kind === "needs-response" && response.reason !== "undeclared";
}
