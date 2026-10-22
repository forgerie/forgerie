import { useState } from "react";
import { PendingRow } from "./PendingRow";
import { ActionFooter } from "./ActionFooter";
import { TextButton } from "./TextButton";

export const name = "Pending row";
export const note = "One item that waits for a choice: its commands trail the words, and drop under them when the row is narrow";

export default function Waiting() {
  const [said, setSaid] = useState("Goes to the team's list");
  return <ul>
    <PendingRow title="Retry once when the stream drops before the end" onShow={() => setSaid("Shown where it lives")} showLabel="Show"
      detail={said} actions={<ActionFooter actions={[{ label: "Keep", tone: "primary", onPress: () => setSaid("Kept") }, { label: "Keep and start", onPress: () => setSaid("Kept and started") }]} />} />
    <PendingRow title="Count early closes in the usage report" tone="quiet" detail="Kept 12m ago" />
    <PendingRow title="Rename the relay module" tone="quiet" detail="Left out" actions={<TextButton label="Bring back" onPress={() => setSaid("Brought back")} />} />
  </ul>;
}
export function Failed() {
  return <ul><PendingRow title="Show the close reason under a cut-off reply" detail="The server did not answer. Nothing was kept." detailTone="bad"
    actions={<ActionFooter actions={[{ label: "Retry", tone: "primary", onPress: () => {} }]} />} /></ul>;
}
export function LongWords() {
  return <ul><PendingRow title="Stop the list from showing a removed folder's items, and make an empty page offer a way back without a reload of the whole app"
    detail={<code>ui/src/very/deep/folder/structure/AComponentWithAVeryLongNameThatNeverBreaksAnywhere.tsx</code>}
    actions={<ActionFooter actions={[{ label: "Keep", tone: "primary", onPress: () => {} }, { label: "Keep and start", onPress: () => {} }]} />} /></ul>;
}
