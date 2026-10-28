import { useState } from "react";
import type { StateChecks } from "@simonwjackson/caliper/checks";
import { ReorderList, type ReorderRow } from "./ReorderList";
import { TextButton } from "./TextButton";

export const name = "Reorder list";
export const note = "A short list whose order means something: drag a row by its handle, or move it with its buttons or the arrow keys";
export const checks = {
  default: {
    "Move down moves the row and keeps focus on it": async ({ canvas, input, expect }) => {
      await input.click(canvas.getByRole("button", { name: "Move Morning walk down" }));
      expect(canvas.getAllByRole("listitem")[1]).toHaveTextContent("Morning walk");
      expect(canvas.getByRole("button", { name: "Move Morning walk down" })).toHaveFocus();
    },
    "the first row cannot move up and the last cannot move down": async ({ canvas, expect }) => {
      expect(canvas.getByRole("button", { name: "Move Morning walk up" })).toBeDisabled();
      expect(canvas.getByRole("button", { name: "Move Evening stretch down" })).toBeDisabled();
    },
  },
  One: {
    "the last row cannot be removed": async ({ canvas, expect }) => {
      expect(canvas.getByRole("button", { name: "Remove Morning walk" })).toBeDisabled();
    },
  },
} satisfies StateChecks;

const START = ["Morning walk", "Lunch with the team at the noodle bar on the corner", "Evening stretch"];
function Stateful({ start, disabled, limit = 6 }: { start: readonly string[]; disabled?: boolean; limit?: number }) {
  const [items, setItems] = useState([...start]);
  const rows: ReorderRow[] = items.map((item) => ({ key: item, label: item, content: <span>{item}</span>,
    note: item.startsWith("Unbroken") ? { text: "This one has no break in it, so it wraps anywhere.", tone: "warn" } : undefined }));
  return <ReorderList label="Today, first thing first" rows={rows} disabled={disabled} empty="Nothing planned. Add the first thing to do."
    removeBlocked={items.length === 1 ? "A day keeps one plan." : undefined}
    foot={<TextButton label="Add a plan" disabled={disabled || items.length >= limit} onPress={() => setItems([...items, `Plan ${String(items.length + 1)}`])} />}
    note={items.length >= limit ? `A day holds at most ${String(limit)} plans.` : undefined}
    onMove={(from, to) => { const next = [...items]; const [item] = next.splice(from, 1); if (item) next.splice(to, 0, item); setItems(next); }}
    onRemove={(index) => setItems(items.filter((_, at) => at !== index))} />;
}
export default function Several() { return <Stateful start={START} />; }
export function Empty() { return <Stateful start={[]} />; }
export function One() { return <Stateful start={["Morning walk"]} />; }
/** At its limit, with a long word that has no break and a note under it. */
export function Full() {
  return <Stateful limit={6} start={["Morning walk", "Unbroken-planning-session-for-the-whole-quarter-with-every-team-lead", "Lunch", "Review", "Tea", "Evening stretch"]} />;
}
/** While a save is in flight, every control is off. */
export function Disabled() { return <Stateful start={START} disabled />; }
