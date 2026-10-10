import { RefreshCwIcon } from "lucide-react";
import { SheetDialog } from "../../ui/SheetDialog";
import { LaneGrid } from "../../ui/LaneGrid";
import { meterGroups } from "./AccountMeters";
import type { MeterProvider } from "./meterModel";

/**
 * Shape: the detail behind the meters. The same lanes the sidebar draws, one
 * step larger, with what the sidebar leaves out: each account's address and
 * every window, including those turned off there. It opens at the account the
 * reader pressed. A banked reset is asked for here as in the sidebar. The
 * reading's age, when it is old, stands beside the title.
 */
export function QuotaSheet({ providers, doubtful, status, focus, onClose, onRefresh, onAskReset }: {
  providers: readonly MeterProvider[];
  doubtful: boolean;
  status?: string | undefined;
  /** The account to open at, as `provider/email`. */
  focus?: string | undefined;
  onClose: () => void;
  onRefresh: () => void;
  onAskReset?: ((key: string) => void) | undefined;
}) {
  return <SheetDialog title="Quota" subtitle={status} onClose={onClose} closeLabel="Close quota"
    actions={[{ label: "Read again", icon: <RefreshCwIcon aria-hidden />, onPress: onRefresh }]}>
    <LaneGrid groups={meterGroups(providers, { onAskReset, chosen: focus })} captions flush size="roomy" faded={doubtful} />
  </SheetDialog>;
}
