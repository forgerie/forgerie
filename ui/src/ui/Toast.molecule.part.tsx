import { useState } from "react";
import { Toast } from "./Toast";

export const name = "Toast";
export const note = "A short message with one action and a dismiss button; actions under it; a long detail shows its first words and opens on a tap";

export default function WithAction() {
  const [said, setSaid] = useState("");
  return <div>
    <Toast message={<>Archived <strong>Account meters plugin backport</strong></>} action={{ label: "Undo", onPress: () => setSaid("Undone") }}
      onDismiss={() => setSaid("Dismissed")} />
    <p aria-live="polite">{said}</p>
  </div>;
}
export function WithDetail() {
  return <Toast message={<>Archived <strong>Account meters plugin backport</strong>. Worktree kept.</>} action={{ label: "Undo", onPress: () => {} }} onDismiss={() => {}}
    detail="It has commits that are not on main. Land or discard account-meters-plugin-backport to remove it." />;
}
export function ShortDetail() {
  return <Toast message={<>Archived <strong>Fix</strong>. Worktree kept.</>} action={{ label: "Undo", onPress: () => {} }} onDismiss={() => {}}
    detail="Another session still works in fix." />;
}
export function Alert() {
  return <Toast tone="alert" message="“Fix the parser” did not start." action={{ label: "Review", onPress: () => {} }} onDismiss={() => {}} />;
}
export function MessageOnly() {
  return <Toast message="Copied the link." onDismiss={() => {}} />;
}
export function LongText() {
  const [dismissed, setDismissed] = useState(false);
  return dismissed ? <p>Dismissed.</p> : <Toast message={`Saved: ${"a-long-name-without-spaces-".repeat(8)}`} onDismiss={() => setDismissed(true)} />;
}
