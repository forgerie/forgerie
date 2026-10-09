import { useState } from "react";
import { Toast } from "./Toast";

export const name = "Toast";
export const note = "A short message with one action and a dismiss button; a detail opens on request, on its own line";

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
    detail="The worktree account-meters-plugin-backport has commits that are not on main. Land or discard it to remove it." />;
}
export function Alert() {
  return <Toast tone="alert" message="“Fix the parser” did not start." action={{ label: "Review", onPress: () => {} }} onDismiss={() => {}} />;
}
export function MessageOnly() {
  return <Toast message="Copied the link." onDismiss={() => {}} />;
}
