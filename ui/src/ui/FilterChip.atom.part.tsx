import { useState } from "react";
import { FolderIcon } from "lucide-react";
import { FilterChip } from "./FilterChip";

export const name = "Filter chip";
export const note = "A filter that is on, above the list it narrows";

export default function On() {
  const [on, setOn] = useState(true);
  return on ? <FilterChip icon={<FolderIcon aria-hidden />} label="Garden" detail="3 folders" clear="Show every folder" onClear={() => setOn(false)} />
    : <p>Every folder is shown.</p>;
}
export function LongName() {
  return <FilterChip icon={<FolderIcon aria-hidden />} label="A list with a name long enough that it has to be cut short" detail="12 folders"
    clear="Show every folder" onClear={() => undefined} />;
}
/** Three choices: the first is named and cut short, the other two are counted, and the title lists all three. */
export function Several() {
  return <FilterChip icon={<FolderIcon aria-hidden />} label="A list with a name long enough that it has to be cut short" more={2}
    title="A list with a name long enough that it has to be cut short, Garden, Kitchen" detail="17 folders" clear="Show every folder" onClear={() => undefined} />;
}
