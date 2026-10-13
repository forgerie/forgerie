import { useState } from "react";
import { WorkflowRunSheet } from "./WorkflowRunSheet";
import { BUILDING, CHILD_LOOKS, LAND_WAITING, LANDED, RETRY_LOOKS, RUN_NOW, UNSENT } from "./fixtures/runs";
import { LOG_NOW, RUN_DECISIONS } from "../decisions/fixtures/decisions";
import type { DecisionLogView } from "../decisions/decisionsModel";

export const name = "Workflow run sheet";
export const note = "One run as its live route and the decisions made on the way; each started worker opens its child";
export const composition = {
  default: [{ part: "src/decisions/DecisionList.organism.part.tsx", state: "Run" }],
  NoDecisions: [{ part: "src/decisions/DecisionList.organism.part.tsx", state: "Empty" }],
  DecisionsUnread: [{ part: "src/decisions/DecisionList.organism.part.tsx", state: "ReadFailed" }],
  OverturnRefused: [{ part: "src/decisions/DecisionList.organism.part.tsx", state: "Run" }],
} as const;

/** The session's log as its store would hold it. An overturn is taken at once, or refused with `refuse`. */
function WithLog({ initial, refuse }: { initial: DecisionLogView; refuse?: string }) {
  const [log, setLog] = useState(initial);
  return <WorkflowRunSheet run={BUILDING} workers={CHILD_LOOKS} onOpenChild={() => {}} onClose={() => {}} now={() => LOG_NOW} decisions={{ log, actions: {
    onRetry: () => setLog({ decisions: RUN_DECISIONS }),
    onDismissError: () => setLog((current) => ({ ...current, error: undefined })),
    onOverturn: (id, text) => {
      if (refuse !== undefined) { setLog((current) => ({ ...current, error: refuse })); return Promise.resolve(false); }
      setLog((current) => ({ ...current, decisions: current.decisions?.map((decision) => decision.id === id
        ? { ...decision, state: { kind: "overturned", note: text, at: LOG_NOW } } : decision) }));
      return Promise.resolve(true);
    },
  } }} />;
}

export default function Building() {
  return <WithLog initial={{ decisions: RUN_DECISIONS }} />;
}
export function WaitingToLand() {
  return <WorkflowRunSheet run={LAND_WAITING} workers={CHILD_LOOKS} onOpenChild={() => {}} onClose={() => {}} />;
}
export function Finished() {
  return <WorkflowRunSheet run={LANDED} workers={CHILD_LOOKS} onOpenChild={() => {}} onClose={() => {}} />;
}
/** design waits to retry a model error; build's report was a duplicate; review stopped before it reported. */
export function Retrying() {
  return <WorkflowRunSheet run={UNSENT} workers={RETRY_LOOKS} onOpenChild={() => {}} onClose={() => {}} now={() => RUN_NOW} />;
}
export function NoDecisions() {
  return <WithLog initial={{ decisions: [] }} />;
}
export function DecisionsUnread() {
  return <WithLog initial={{ readError: "Durable storage is unavailable." }} />;
}
/** Every overturn is refused: press Overturn, write a note, and send to see the reason in the footer. */
export function OverturnRefused() {
  return <WithLog initial={{ decisions: RUN_DECISIONS }} refuse="The session's storage is unavailable. Try again in a moment." />;
}
