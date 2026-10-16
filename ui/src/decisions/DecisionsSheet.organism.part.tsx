import { useState } from "react";
import { DecisionsSheet } from "./DecisionsSheet";
import { CONFIRMED, GUESS, LOG_NOW, SESSION_DECISIONS } from "./fixtures/decisions";
import type { Decision, DecisionLogView } from "./decisionsModel";

export const name = "Decisions sheet";
export const note = "The session's decision log, from its header, with Overturn";
export const composition = {
  Overturning: [{ part: "src/decisions/OverturnFooter.molecule.part.tsx", state: "default" }],
  OverturnFailed: [{ part: "src/decisions/OverturnFooter.molecule.part.tsx", state: "Failed" }],
} as const;

/** The log as the session's store would hold it. An overturn is taken at once, or refused with `refuse`. */
function Stateful({ initial, refuse, target }: { initial: DecisionLogView; refuse?: string; target?: string }) {
  const [log, setLog] = useState(initial);
  return <DecisionsSheet log={log} initialTarget={target} now={() => LOG_NOW} onClose={() => {}} actions={{
    onRetry: () => setLog({ ...log, readError: undefined, decisions: SESSION_DECISIONS }),
    onDismissError: () => setLog((current) => ({ ...current, error: undefined })),
    onConfirm: async (id) => {
      if (refuse !== undefined) { setLog((current) => ({ ...current, error: refuse })); return false; }
      setLog((current) => ({ ...current, decisions: current.decisions?.map((decision) => decision.id === id
        ? { ...decision, state: { kind: "confirmed", at: LOG_NOW } } : decision) }));
      return true;
    },
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
export function Confirmed() {
  return <Stateful initial={{ decisions: SESSION_DECISIONS.map((decision) => decision.id === CONFIRMED.id ? CONFIRMED : decision) }} />;
}
export function Empty() {
  return <Stateful initial={{ decisions: [] }} />;
}
const MIN = 60_000;
const gated = (id: string, minutes: number, question: string): Decision => ({ id, at: LOG_NOW - minutes * MIN, kind: "gated", by: "user", question,
  choice: "approved", reason: "The user approved this tool call", flagged: false, state: { kind: "standing" } });
/** The screenshot of 2026-10-16: six gated actions, three of them the same push, beside a flagged guess. */
const SCREENSHOT: Decision[] = [gated("g1", 1, "Delete an unmerged Git branch"), GUESS, gated("g2", 60, "Discard changes with git checkout"),
  gated("g3", 61, "Merge pull request #59"), gated("g4", 180, "Push Git refs with unknown default branch"),
  gated("g5", 16 * 60, "Push Git refs with unknown default branch"), gated("g6", 17 * 60, "Push Git refs with unknown default branch")];
export function GatedActions() {
  return <Stateful initial={{ decisions: SCREENSHOT }} />;
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
