import { z } from "zod";
import { MODEL_CHAIN_SWITCH_KIND, type ModelChainSwitchNotice } from "@shared/apiTypes";
import { textOf, type PiMessage } from "../contracts";

export { MODEL_CHAIN_SWITCH_KIND, type ModelChainSwitchNotice };

const noticeSchema = z.object({ from: z.string().min(1), to: z.string().min(1), error: z.string() }) satisfies z.ZodType<ModelChainSwitchNotice>;

/**
 * The model chain switch a transcript entry records, if it is one: the server's display-only entry of kind
 * `forgerie.model-chain-switch`. The notice is read from the entry's details, or else from its text as JSON. An entry
 * this app cannot read is not one, so it falls back to plain system text.
 */
export function chainSwitchOf(message: PiMessage): ModelChainSwitchNotice | undefined {
  if (message.role !== "custom" || message.customType !== MODEL_CHAIN_SWITCH_KIND) return undefined;
  const details = noticeSchema.safeParse(message.details);
  if (details.success) return details.data;
  try { return noticeSchema.parse(JSON.parse(textOf(message))); } catch { return undefined; }
}
