import { z } from "zod";

/** Public status is an allowlist. Never project the gateway credential. */
export const decisionHintsStatusSchema = z.object({ keyPresent: z.boolean() });
export type DecisionHintsStatus = z.infer<typeof decisionHintsStatusSchema>;
