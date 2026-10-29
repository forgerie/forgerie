import { z } from "zod";
import { MODEL_CHAIN_SWITCH_KIND, type ModelChainSwitchNotice } from "@shared/apiTypes";
import type { PiMessage } from "../contracts";

export { MODEL_CHAIN_SWITCH_KIND, type ModelChainSwitchNotice };

const noticeSchema = z.object({ from: z.string().min(1), to: z.string().min(1), error: z.string() }) satisfies z.ZodType<ModelChainSwitchNotice>;

/**
 * The model chain switch a transcript entry records, if it is one: the server's display-only custom entry of kind
 * `forgerie.model-chain-switch`, with the notice at the root of its details. An entry this app cannot read is not
 * one; the transcript shows its text, if it has any, as plain system text.
 */
export function chainSwitchOf(message: PiMessage): ModelChainSwitchNotice | undefined {
  if (message.role !== "custom" || message.customType !== MODEL_CHAIN_SWITCH_KIND) return undefined;
  const details = noticeSchema.safeParse(message.details);
  return details.success ? details.data : undefined;
}
