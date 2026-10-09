import { ActionRow } from "./ActionRow";
import { ListSection } from "./ListSection";

export const name = "List section";
export const note = "A titled list; empty, it says how to add a row";
export const composition = { default: [{ part: "src/ui/ActionRow.molecule.part.tsx", state: "default" }] };

export default function Rows() {
  return <ListSection title="Folders" empty="No folders yet." note={<>Saved in <code>~/.config/folders.json</code></>}>
    <ActionRow name="letters" status="Open" detail="Drafts and sent letters" />
    <ActionRow name="photos" status="Open" detail="Every photo from 2026" />
  </ListSection>;
}
export function Empty() {
  return <ListSection title="Folders" empty="No folders yet. Use New folder to add one." />;
}
