import { useState } from "react";
import { TextButton } from "./TextButton";

export const name = "Text button";
export const note = "A quiet action in a line of text, with a control-sized target";

export default function Plain() {
  const [paused, setPaused] = useState(false);
  return <TextButton label={paused ? "Resume" : "Pause"} onPress={() => setPaused(!paused)} />;
}
export function Danger() {
  return <TextButton label="Delete" tone="danger" onPress={() => undefined} />;
}
export function Disabled() {
  return <TextButton label="Open session" disabled onPress={() => undefined} />;
}
