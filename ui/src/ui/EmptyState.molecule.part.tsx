import { CalendarClockIcon } from "lucide-react";
import { EmptyState } from "./EmptyState";
import { HeaderButton } from "./HeaderButton";

export const name = "Empty state";
export const note = "An empty list as an invitation: icon, title, what goes here, and the first action";
export const composition = { default: [{ part: "src/ui/HeaderButton.atom.part.tsx", state: "default" }] };

export default function WithAction() {
  return <EmptyState icon={<CalendarClockIcon />} title="No triggers yet" action={<HeaderButton label="New trigger" onPress={() => undefined} />}>
    A trigger starts a saved workflow at a set time, in a new session of a project. In the morning, you review the work in that session.
  </EmptyState>;
}
export function TextOnly() {
  return <EmptyState title="Nothing here">Items appear here once something adds one.</EmptyState>;
}
