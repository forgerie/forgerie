import { useState } from "react";
import type { StateChecks } from "@simonwjackson/caliper/checks";
import { SearchField } from "./SearchField";

export const name = "Search field";
export const note = "One search box over a list";
export const checks = {
  default: {
    "typing narrows the list it names": async ({ canvas, input, expect }) => {
      await input.type(canvas.getByRole("searchbox", { name: "Search fruit" }), "pe");
      expect(canvas.getByText("pear")).toBeVisible();
      expect(canvas.queryByText("apple")).toBeNull();
    },
  },
  Clearable: {
    "the ✕ empties the box": async ({ canvas, input, expect }) => {
      await input.click(canvas.getByRole("button", { name: "Clear search" }));
      expect(canvas.getByRole("searchbox", { name: "Search fruit" })).toHaveValue("");
    },
  },
} satisfies StateChecks;

const FRUIT = ["apple", "pear", "peach"];
export default function Empty() {
  const [query, setQuery] = useState("");
  return <div>
    <SearchField label="Search fruit" value={query} onChange={setQuery} />
    <ul>{FRUIT.filter((item) => item.includes(query)).map((item) => <li key={item}>{item}</li>)}</ul>
  </div>;
}
export function Typed() {
  const [query, setQuery] = useState("pea");
  return <SearchField label="Search fruit" value={query} onChange={setQuery} />;
}
/** Typed text with its ✕; Escape clears it too. */
export function Clearable() {
  const [query, setQuery] = useState("peach");
  return <SearchField label="Search fruit" value={query} onChange={setQuery} clear={{ label: "Clear search", onClear: () => setQuery("") }} />;
}
/** An answer is on its way: the magnifier spins. */
export function Busy() {
  const [query, setQuery] = useState("pear tart");
  return <SearchField label="Search fruit" value={query} onChange={setQuery} busy busyLabel="Searching"
    clear={{ label: "Clear search", onClear: () => setQuery("") }} />;
}
/** A hint under the box says what the typed text does. */
export function Hint() {
  const [query, setQuery] = useState("pe");
  return <SearchField label="Search fruit" value={query} onChange={setQuery} hint="Type 3 or more letters to search the recipes too"
    clear={{ label: "Clear search", onClear: () => setQuery("") }} />;
}
