import { useState } from "react";
import { ActionFooter } from "./ActionFooter";
import { ReplyBox } from "./ReplyBox";

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
export function WithInput() {
  const [note, setNote] = useState("Say what should change. The rest stays as it is.");
  return <ActionFooter note={note} actions={[]} input={<ReplyBox label="What should change?" placeholder="Say what to change" sendLabel="Send changes"
    secondary={{ label: "Back", onPress: () => setNote("Back to the choices") }} onSend={async (text) => { setNote(`Sent: ${text}`); }} />} />;
}
