import { useState } from "react";
import { TaskActivity } from "./TaskActivity";
import { StatusDetail } from "./StatusDetail";
import { StatusChip } from "../ui/StatusChip";
import { NOW, utcClock, VIEWS } from "./fixtures/taskActivity";
import type { TaskActivityState } from "./taskActivityStore";

export const name = "Session tasks";
export const note = "The session's live Durable tasks in the status panel: this turn, the background agents, and what a restart would do";

const fixedNow = () => NOW;
const copied = () => Promise.resolve();

/** Try again reads the working list, as a good read would. */
function Stateful({ initial, running = true, initialOpen }: { initial: TaskActivityState; running?: boolean; initialOpen?: readonly string[] }) {
  const [view, setView] = useState(initial);
  return <TaskActivity view={view} running={running} now={fixedNow} clock={utcClock} onCopy={copied} initialOpen={initialOpen}
    onRetry={() => setView(VIEWS.working)} />;
}

export default function Working() {
  return <Stateful initial={VIEWS.working} />;
}
export function OneRowOpen() {
  return <Stateful initial={VIEWS.working} initialOpen={["task:1842"]} />;
}
export function ManyRowsFolded() {
  return <Stateful initial={VIEWS.busy} />;
}
export function IdleWithBackgroundAgents() {
  return <Stateful initial={VIEWS.idleBackground} running={false} />;
}
export function Blocked() {
  return <Stateful initial={VIEWS.blocked} running={false} initialOpen={["task:2207"]} />;
}
export function Loading() {
  return <Stateful initial={VIEWS.loading} />;
}
export function Empty() {
  return <Stateful initial={VIEWS.empty} />;
}
export function ReadFailed() {
  return <Stateful initial={VIEWS.error} />;
}
export function StaleAfterError() {
  return <Stateful initial={VIEWS.staleError} />;
}
export function StaleAfterReconnect() {
  return <Stateful initial={VIEWS.staleReconnect} />;
}
/** A session that is not Durable: the panel keeps its problems and shows no task section. */
export function Unsupported() {
  return <>
    <StatusDetail problems={[{ id: 1, title: "Command failed", at: NOW, message: "Unknown command: /bad" }]} draftSaved now={fixedNow}
      onTryNow={() => undefined} onReload={() => undefined} onDismiss={() => undefined} />
    <Stateful initial={VIEWS.unsupported} />
  </>;
}
/** In place: the header's chip with its aside. Press it to open the panel. */
export function InPanel() {
  return <StatusChip label="Running" tone="live" aside="2 agents" asideLabel="2 background agents"
    panel={{ title: "Running", children: <Stateful initial={VIEWS.busy} initialOpen={["agent:5"]} /> }} />;
}
