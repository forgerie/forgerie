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
