import { NestedRows } from "./NestedRows";
import { ActionRow } from "./ActionRow";
import { TextButton } from "./TextButton";

export const name = "Nested rows";
export const note = "A short list of rows under the line or row they belong to";
export const composition = { default: [{ part: "src/ui/ActionRow.molecule.part.tsx", state: "default" }] };

export default function Parts() {
  return <NestedRows label="Folders in this backup">
    <ActionRow name="letters" status="Failed" tone="danger" detail="The folder is still in use by another program." />
    <ActionRow name="photos" status="Done" actions={<TextButton label="Open" onPress={() => undefined} />} />
    <ActionRow name="old-archive" status="Skipped" tone="quiet" detail="The folder is gone." />
  </NestedRows>;
}
export function Stacked() {
  return <NestedRows label="Folders in this backup">
    <ActionRow layout="stacked" name="a-folder-with-a-very-long-name-that-has-to-wrap" status="Failed" tone="danger" detail="The folder is still in use." />
    <ActionRow layout="stacked" name="photos" status="Done" actions={<TextButton label="Open" onPress={() => undefined} />} />
  </NestedRows>;
}
