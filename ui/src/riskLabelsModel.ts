import { z } from "zod";
import type { RiskLabel } from "@shared/riskLabels";
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

/** A signal counts as raised at this probability or above. The badge names only raised signals. */
export const RISK_SIGNAL_RAISED = 0.5;
const SIGNALS = [["deletes_data", "deletes data"], ["outside_worktree", "outside the working directory"], ["acts_as_user", "acts as you"]] as const;
const LEVEL_WORDS: Record<RiskLabel["risk"], string> = { low: "Low risk", check: "Check first", danger: "High risk" };
/** What a risk badge says. `low` never says safe or approved: an opinion is not permission. */
export interface RiskWords { level: RiskLabel["risk"]; word: string; reasons: string[]; source: string }
export function riskWords(label: RiskLabel): RiskWords {
  return {
    level: label.risk, word: LEVEL_WORDS[label.risk],
    reasons: SIGNALS.filter(([key]) => label[key] >= RISK_SIGNAL_RAISED).map(([, words]) => words),
    source: `Opinion from ${label.model}`,
  };
}
