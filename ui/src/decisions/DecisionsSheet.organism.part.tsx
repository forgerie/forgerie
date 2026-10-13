import { useState } from "react";
import { DecisionsSheet } from "./DecisionsSheet";
import { GUESS, LOG_NOW, SESSION_DECISIONS } from "./fixtures/decisions";
import type { DecisionLogView } from "./decisionsModel";

export const name = "Decisions sheet";
export const note = "The session's decision log, from its header, with Overturn";
export const composition = {
  default: [{ part: "src/decisions/DecisionList.organism.part.tsx", state: "default" }],
  Empty: [{ part: "src/decisions/DecisionList.organism.part.tsx", state: "Empty" }],
  Loading: [{ part: "src/decisions/DecisionList.organism.part.tsx", state: "Loading" }],
  ReadFailed: [{ part: "src/decisions/DecisionList.organism.part.tsx", state: "ReadFailed" }],
  Overturning: [{ part: "src/decisions/DecisionList.organism.part.tsx", state: "default" }, { part: "src/decisions/OverturnFooter.molecule.part.tsx", state: "default" }],
  OverturnFailed: [{ part: "src/decisions/DecisionList.organism.part.tsx", state: "default" }, { part: "src/decisions/OverturnFooter.molecule.part.tsx", state: "Failed" }],
} as const;

/** The log as the session's store would hold it. An overturn is taken at once, or refused with `refuse`. */
function Stateful({ initial, refuse, target }: { initial: DecisionLogView; refuse?: string; target?: string }) {
  const [log, setLog] = useState(initial);
  return <DecisionsSheet log={log} initialTarget={target} now={() => LOG_NOW} onClose={() => {}} actions={{
    onRetry: () => setLog({ ...log, readError: undefined, decisions: SESSION_DECISIONS }),
    onDismissError: () => setLog((current) => ({ ...current, error: undefined })),
    onOverturn: (id, note) => {
      if (refuse !== undefined) { setLog((current) => ({ ...current, error: refuse })); return Promise.resolve(false); }
      setLog((current) => ({ ...current, decisions: current.decisions?.map((decision) => decision.id === id
        ? { ...decision, state: { kind: "overturned", note, at: LOG_NOW } } : decision) }));
      return Promise.resolve(true);
    },
  }} />;
}
export default function Ready() {
  return <Stateful initial={{ decisions: SESSION_DECISIONS }} />;
}
export function Empty() {
  return <Stateful initial={{ decisions: [] }} />;
}
export function Loading() {
  return <Stateful initial={{}} />;
}
export function ReadFailed() {
  return <Stateful initial={{ readError: "Durable storage is unavailable." }} />;
}
/** The flagged guess's note field is open in the footer. */
export function Overturning() {
  return <Stateful initial={{ decisions: SESSION_DECISIONS }} target={GUESS.id} />;
}
/** The server refused the last try: the reason is in the footer, and the field stays for another. */
export function OverturnFailed() {
  return <Stateful initial={{ decisions: SESSION_DECISIONS, error: "The session's storage is unavailable. Try again in a moment." }} target={GUESS.id}
    refuse="The session's storage is unavailable. Try again in a moment." />;
}
