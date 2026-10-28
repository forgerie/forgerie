import type { SessionModel } from "../contracts";
import { chainEntryLabel } from "../modelChoice";
import { EventLine } from "../ui/EventLine";
import type { ModelChainSwitchNotice } from "./chainSwitch";

/**
 * Shape: the session's model chain moved past a model that was unavailable, as one quiet line in the thread. The model
 * that took over is the subject, so it stays readable when the line is cut; the model it replaced follows. The exact
 * references and what the provider answered open on request.
 */
export function ChainSwitchLine({ notice, models = [] }: { notice: ModelChainSwitchNotice; models?: readonly SessionModel[] | undefined }) {
  const error = notice.error.trim();
  return <EventLine tone="neutral" subject={chainEntryLabel(notice.to, models)} phrase={`took over from ${chainEntryLabel(notice.from, models)}`}
    facts={[{ label: "from", value: notice.from }, { label: "to", value: notice.to }]}
    code={error === "" ? undefined : error} codeLabel="Why the chain moved on" />;
}
