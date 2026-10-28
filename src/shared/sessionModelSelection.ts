import { z } from "zod";

/** One selection, never a chain plus a concrete model. */
export const sessionModelSelectionSchema = z.union([
  z.object({ cwd: z.string().optional(), modelChain: z.string().regex(/^[a-z0-9][a-z0-9-]*(?::(?:off|minimal|low|medium|high|xhigh|max))?$/) }).strict(),
  z.object({ cwd: z.string().optional(), provider: z.string().min(1), modelId: z.string().min(1) }).strict(),
]);
export type SessionModelSelection = z.infer<typeof sessionModelSelectionSchema>;
