import { useState } from "react";
import { ListTools } from "./ListTools";
import { SearchField } from "./SearchField";
import { ToggleGroup } from "./ToggleGroup";

export const name = "List tools";
export const note = "A switch and a search box that choose what the list below shows";
export const composition = { default: [
  { part: "src/ui/SearchField.atom.part.tsx", state: "default" },
  { part: "src/ui/ToggleGroup.molecule.part.tsx", state: "default" },
] };

export default function SwitchAndSearch() {
  const [kind, setKind] = useState<"fruit" | "vegetables">("fruit");
  const [query, setQuery] = useState("");
  return <ListTools label="Choose produce">
    <ToggleGroup label="Kind" value={kind} onChange={setKind} options={[{ value: "fruit", label: "Fruit", count: 12 }, { value: "vegetables", label: "Vegetables", count: 7 }]} />
    <SearchField label={kind === "fruit" ? "Search fruit" : "Search vegetables"} value={query} onChange={setQuery} />
  </ListTools>;
}
export function SearchWithTotal() {
  const [query, setQuery] = useState("");
  return <ListTools label="Find produce" readout="23 kinds, 4 out of season">
    <SearchField label="Filter by name or kind" value={query} onChange={setQuery} />
  </ListTools>;
}
