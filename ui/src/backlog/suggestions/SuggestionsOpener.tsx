import { ListPlusIcon } from "lucide-react";
import { BadgeButton } from "../../ui/BadgeButton";

/**
 * Shape: the session header's way into the chat's backlog suggestions. Open ones are a quiet count: nothing waits
 * on them. A background session that needs the reader turns the count live, as a child agent's question does; one
 * that works draws the working dot. The label says all of it, so the chat's own status chip stays the chat's.
 */
export function SuggestionsOpener({ label, count, quiet, active, onOpen }: { label: string; count: number; quiet: boolean; active: boolean; onOpen: () => void }) {
  return <BadgeButton icon={<ListPlusIcon aria-hidden />} label={label} count={count} quiet={quiet} active={active} onPress={onOpen} />;
}
