import { useState } from "react";
import { Shelf } from "./Shelf";

export const name = "Shelf";
export const note = "A section at the foot of a list that opens and closes, with a status and a message";

const lines = ["First line of the body", "Second line of the body", "Third line of the body"];

export default function Open() {
  const [open, setOpen] = useState(true);
  return <Shelf id="shelf-open" title="Section" label="Section" open={open} onToggle={() => setOpen(!open)} toggleHint={open ? "Close" : "Open"}>
    {lines.map((line) => <p key={line}>{line}</p>)}
  </Shelf>;
}
export function Closed() {
  const [open, setOpen] = useState(false);
  return <Shelf id="shelf-closed" title="Section" label="Section" open={open} onToggle={() => setOpen(!open)} toggleHint={open ? "Close" : "Open"}>
    {lines.map((line) => <p key={line}>{line}</p>)}
  </Shelf>;
}
export function WithStatus() {
  return <Shelf id="shelf-body" title="Section" label="Section" open onToggle={() => {}} toggleHint="Close" status="12m old" statusHint="The reading is 12 minutes old">
    <p>The body, faded by its owner</p>
  </Shelf>;
}
export function Loading() {
  return <Shelf id="shelf-body" title="Section" label="Section" open onToggle={() => {}} toggleHint="Close" message={{ text: "Reading…" }} />;
}
export function Failed() {
  const [tries, setTries] = useState(0);
  return <Shelf id="shelf-body" title="Section" label="Section" open onToggle={() => {}} toggleHint="Close"
    message={{ text: `Cannot reach the service.${tries > 0 ? ` Tried ${String(tries)} more.` : ""}`, alert: true, action: { label: "Retry", onPress: () => setTries(tries + 1) } }} />;
}
