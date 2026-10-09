import { useState } from "react";
import { FileTile } from "./FileTile";

export const name = "File tile";
export const note = "One file as a square: a picture fills it, any other file shows its type";

const picture = "data:image/svg+xml;utf8," + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 90'><rect width='120' height='90' fill='black'/>"
  + "<rect x='8' y='8' width='12' height='12' fill='gainsboro'/><rect x='8' y='30' width='70' height='14' fill='dimgray'/></svg>");

export default function Picture() {
  const [shown, setShown] = useState(true);
  return shown ? <FileTile name="image.png" preview={picture} onOpen={() => undefined} onRemove={() => setShown(false)} /> : <p>Removed.</p>;
}
export function TextFile() {
  return <FileTile name="deployment-notes-with-a-long-filename.txt" onRemove={() => undefined} />;
}
export function Uploading() {
  return <FileTile name="image.png" preview={picture} note="Uploading…" busy onRemove={() => undefined} removeDisabled />;
}
export function Failed() {
  return <FileTile name="recording.mov" note="Not added" failed onRemove={() => undefined} />;
}
export function Sent() {
  return <FileTile name="image.png" preview={picture} onOpen={() => undefined} />;
}
