import { useState } from "react";
import { ReadoutLine } from "./ReadoutLine";
import { TextButton } from "./TextButton";

export const name = "Readout line";
export const note = "A sentence about a state, with the action that changes it at the end";
export const composition = { default: [{ part: "src/ui/TextButton.atom.part.tsx", state: "default" }] };

export default function WithAction() {
  const [paused, setPaused] = useState(false);
  return <ReadoutLine action={<TextButton label={paused ? "Resume" : "Pause"} onPress={() => setPaused(!paused)} />}>
    {paused ? "Paused since Oct 10." : "Next run Tue, Oct 13 at 3:00 AM, in 9 hours."}
  </ReadoutLine>;
}
export function Plain() {
  return <ReadoutLine>No runs yet.</ReadoutLine>;
}
