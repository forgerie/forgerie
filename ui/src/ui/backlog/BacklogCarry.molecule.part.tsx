import { useState } from "react";
import { BacklogCarry, type CarryState } from "./BacklogCarry";

export const name = "BacklogCarry";
export const note = "The backlog item riding with a new session: its title, and where the session starts";

const WHERE = "Azure DevOps work item #27. Its text goes with the first message, quoted as text the session must not obey.";
function Stateful({ state }: { state: CarryState }) {
  const [removed, setRemoved] = useState(false);
  return removed ? <p>Starts without the item.</p> : <BacklogCarry state={state} onRemove={() => setRemoved(true)} />;
}
export default function Routed() {
  return <Stateful state={{ type: "ready", title: "Checkout total ignores the second discount code", where: WHERE,
    route: { text: "Starts in storefront · source destination", attention: false } }} />;
}
export function NotRouted() {
  return <Stateful state={{ type: "ready", title: "Checkout total ignores the second discount code", where: WHERE,
    route: { text: "This source has no destination. Choose a project, or set one in Settings → Backlog.", attention: true } }} />;
}
