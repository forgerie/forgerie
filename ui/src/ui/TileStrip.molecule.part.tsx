import { useState } from "react";
import { FileTile } from "./FileTile";
import { TileStrip } from "./TileStrip";
import { ToggleGroup } from "./ToggleGroup";

export const name = "Tile strip";
export const note = "One row of tiles that keeps its height, with one control at its end";

const names = ["image.png", "fold-1.png", "fold-2.png", "fold-3.png", "notes.txt", "build.log"];

function Switch() {
  const [value, setValue] = useState<"inline" | "folder">("inline");
  return <ToggleGroup label="Send images" lead="Send images" value={value} onChange={setValue}
    options={[{ value: "inline", label: "Inline" }, { value: "folder", label: "As files" }]} />;
}
export default function One() {
  return <TileStrip label="1 attached file" end={<Switch />}><FileTile name="notes.txt" onRemove={() => undefined} /></TileStrip>;
}
export function Many() {
  return <TileStrip label="6 attached files" end={<Switch />}>
    {names.map((file) => <FileTile key={file} name={file} onRemove={() => undefined} />)}
  </TileStrip>;
}
export function WithAlert() {
  return <TileStrip label="2 attached files" alerts={["recording.mov: Files must be 16 MiB or smaller. Remove this file and choose a smaller one."]}>
    <FileTile name="notes.txt" onRemove={() => undefined} />
    <FileTile name="recording.mov" note="Not added" failed onRemove={() => undefined} />
  </TileStrip>;
}
export function AtTheEnd() {
  return <TileStrip label="Attached files" align="end">
    <FileTile name="before.png" /><FileTile name="after.png" />
  </TileStrip>;
}
