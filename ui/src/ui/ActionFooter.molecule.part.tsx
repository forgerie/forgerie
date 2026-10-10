import { useState } from "react";
import { ActionFooter } from "./ActionFooter";

export const name = "Action footer";
export default function Decision() {
  const [note, setNote] = useState("The draft is ready. Choose what happens next.");
  return <ActionFooter note={note} actions={[{ label: "Review changes", onPress: () => setNote("Changes opened") },
    { label: "Apply", tone: "primary", onPress: () => setNote("Applied") }, { label: "Discard", tone: "danger", onPress: () => setNote("Discard confirmation opened") }]} />;
}
export function Blocked() {
  const [note, setNote] = useState("Resolve the changed files before applying.");
  return <ActionFooter note={note} actions={[{ label: "Apply", disabled: true, onPress: () => {} }, { label: "Continue working", onPress: () => setNote("Editor opened") }]} />;
}
