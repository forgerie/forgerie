import { ScaleIcon } from "lucide-react";
import { BadgeButton } from "../ui/BadgeButton";
import { openerLabel } from "./decisionsModel";

/**
 * Shape: the session header's way into its decision log. Its count is the flagged guesses still standing, drawn
 * quietly: nothing waits on them, so they never take the live colour that says the reader is needed.
 */
export function DecisionsOpener({ flagged, onOpen }: { flagged: number; onOpen: () => void }) {
  return <BadgeButton icon={<ScaleIcon aria-hidden />} label={openerLabel(flagged)} count={flagged} quiet onPress={onOpen} />;
}
