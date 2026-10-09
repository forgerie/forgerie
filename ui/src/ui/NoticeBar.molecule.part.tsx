import { useState } from "react";
import { NoticeBar } from "./NoticeBar";

export const name = "Notice bar";
export const note = "A bar that stops the reader until they choose";

export default function Conflict() {
  const [answer, setAnswer] = useState("");
  return <div>
    <NoticeBar tone="alert" message="This file changed on disk after you opened it, perhaps by the agent. Reload it to see that change, which drops your edits, or overwrite it with yours."
      actions={[{ label: "Reload", onPress: () => setAnswer("Reloaded") }, { label: "Overwrite", onPress: () => setAnswer("Overwritten"), primary: true }]} />
    <p aria-live="polite">{answer}</p>
  </div>;
}
export function Question() {
  return <NoticeBar message="README.md has unsaved edits. Closing drops them."
    actions={[{ label: "Keep editing", onPress: () => {} }, { label: "Discard and close", onPress: () => {}, primary: true }]} />;
}
export function Failed() {
  return <NoticeBar tone="alert" message="Not saved. The disk is full." actions={[{ label: "Try again", onPress: () => {}, primary: true }]} />;
}
