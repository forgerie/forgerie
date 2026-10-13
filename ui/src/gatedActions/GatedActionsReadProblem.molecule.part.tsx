import { GatedActionsReadProblem } from "./GatedActionsReadProblem";
import { GatedActionCard } from "./GatedActionCard";
import { PinnedDock } from "../ui/PinnedDock";
import { PUSH_ENTRY } from "./fixtures/gatedActions";

export const name = "Gated actions read problem";
export const note = "The gated actions could not be read: the dock says so above the cards from the transcript, with Retry";

export default function Failed() {
  return <GatedActionsReadProblem error="Durable storage is unavailable." onRetry={() => {}} />;
}
/** As the session pins it: the card the transcript still shows as waiting, then the problem. */
export function Pinned() {
  return <PinnedDock label="1 waiting for you">
    <GatedActionCard entry={PUSH_ENTRY} read={false} onApprove={() => {}} onRefuse={() => {}} />
    <GatedActionsReadProblem error="Durable storage is unavailable." onRetry={() => {}} />
  </PinnedDock>;
}
