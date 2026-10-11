import { useState } from "react";
import type { StateChecks } from "@simonwjackson/caliper/checks";
import { SearchBox } from "./SearchBox";

export const name = "Search box";
export const note = "The search box at the top of the session list";
export const checks = {
  ShortQuery: {
    "a short query says how to search messages": async ({ canvas, expect }) => {
      expect(canvas.getByText("Type 3 or more characters to search messages")).toBeVisible();
    },
  },
} satisfies StateChecks;
export const composition = {
  default: [{ part: "src/ui/SearchField.atom.part.tsx", state: "default" }],
  ShortQuery: [{ part: "src/ui/SearchField.atom.part.tsx", state: "Hint" }],
  Searching: [{ part: "src/ui/SearchField.atom.part.tsx", state: "Busy" }],
};

function Stateful({ initial, busy = false }: { initial: string; busy?: boolean }) {
  const [query, setQuery] = useState(initial);
  return <SearchBox query={query} busy={busy} onQuery={setQuery} onClear={() => setQuery("")} />;
}
export default function Empty() { return <Stateful initial="" />; }
/** Under 3 characters the list narrows by title, and the hint says how to search messages. */
export function ShortQuery() { return <Stateful initial="de" />; }
export function Searching() { return <Stateful initial="deploy" busy />; }
