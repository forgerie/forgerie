import { useState } from "react";
import { StatusDetail } from "./StatusDetail";
import type { Problem } from "../sessionStore";

export const name = "Session status detail";
export const note = "What the header's status chip opens: connection trouble, then each problem";

const at = Date.UTC(2026, 9, 9, 20, 6);
const fixedNow = () => at;
const overloaded: Problem = { id: 2, title: "Pi reported an error", at,
  message: "529 overloaded_error: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"},\"request_id\":\"req_011CTx9fQ2k7vZbE4m1nHqA8\"}" };
const command: Problem = { id: 1, title: "Command failed", at: at - 60_000, message: "Unknown command: /bad" };

function Problems({ initial }: { initial: readonly Problem[] }) {
  const [problems, setProblems] = useState(initial);
  return <StatusDetail problems={problems} draftSaved now={fixedNow} onTryNow={() => undefined} onReload={() => undefined}
    onCopy={() => undefined} onDismiss={(id) => setProblems((list) => list.filter((problem) => problem.id !== id))} />;
}

export default function TwoProblems() {
  return <Problems initial={[overloaded, command]} />;
}
export function Reconnecting() {
  return <StatusDetail connection={{ type: "reconnecting", reason: "Live connection timed out.", attempt: 4, retryAt: at + 3000, lastReadyAt: at - 240_000 }}
    problems={[]} draftSaved now={fixedNow} onTryNow={() => undefined} onReload={() => undefined} onDismiss={() => undefined} />;
}
export function TryingNow() {
  return <StatusDetail connection={{ type: "reconnecting", reason: "Trying again now.", attempt: 5, retryAt: at }}
    problems={[command]} draftSaved now={fixedNow} onTryNow={() => undefined} onReload={() => undefined} onDismiss={() => undefined} />;
}
export function Disconnected() {
  return <StatusDetail connection={{ type: "failed", reason: "Session 01a1224a-5613-7499-95a3-98bb532b972e was not found. Check the session ID in the URL." }}
    problems={[]} draftSaved now={fixedNow} onTryNow={() => undefined} onReload={() => undefined} onDismiss={() => undefined} />;
}
