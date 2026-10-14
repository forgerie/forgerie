import { z } from "zod";
import { RISK_LABEL_ENTRY_KIND } from "@shared/riskLabels";
import type { PiMessage } from "./contracts";

export const riskLabelSchema = z.strictObject({
  model: z.string().min(1), deletes_data: z.number().min(0).max(1), outside_worktree: z.number().min(0).max(1),
  acts_as_user: z.number().min(0).max(1), risk: z.enum(["low", "check", "danger"]), risk_score: z.number().min(0).max(2),
});
const entrySchema = z.object({ target: z.enum(["gate", "tool"]), id: z.string().min(1), label: riskLabelSchema });
/** Host entries contain SDK stamps too. Only the annotation fields enter the transcript. */
export function riskLabelEntryOf(message: PiMessage) {
  if (message.role !== "custom" || message.customType !== RISK_LABEL_ENTRY_KIND) return undefined;
  const parsed = entrySchema.safeParse(message.details);
  return parsed.success ? parsed.data : undefined;
}
