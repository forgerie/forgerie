import { FileTile } from "./FileTile";
import { TileStrip } from "./TileStrip";

export const name = "Tile strip";
export const note = "One row of tiles that keeps its height and scrolls sideways";

const names = ["image.png", "fold-1.png", "fold-2.png", "fold-3.png", "notes.txt", "build.log", "trace.json", "report.pdf"];

export default function One() {
  return <TileStrip label="1 attached file"><FileTile name="notes.txt" onRemove={() => undefined} /></TileStrip>;
}
export function Many() {
  return <TileStrip label="8 attached files">
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
