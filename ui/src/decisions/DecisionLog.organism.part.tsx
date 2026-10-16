import { useState } from "react";
import { DecisionLog } from "./DecisionLog";
import { GUESS, LOG_NOW, SESSION_DECISIONS } from "./fixtures/decisions";

export const name = "Decision log";
export const note = "The session's decisions: flagged guesses in full, the rest one line each by day, with repeats folded";

function Log({ readOnly = false, initial }: { readOnly?: boolean; initial?: string }) {
  const [target, setTarget] = useState(initial);
  return <DecisionLog decisions={SESSION_DECISIONS} now={LOG_NOW} target={target} onRetry={() => {}}
    onChoose={readOnly ? undefined : (id) => setTarget((current) => current === id ? undefined : id)} />;
}
export default function Ready() { return <Log />; }
export function ReadOnly() { return <Log readOnly />; }
/** The flagged guess's Overturn is pressed. */
export function Choosing() { return <Log initial={GUESS.id} />; }
export function Loading() { return <DecisionLog decisions={undefined} now={LOG_NOW} onRetry={() => {}} />; }
export function Empty() { return <DecisionLog decisions={[]} now={LOG_NOW} onRetry={() => {}} />; }
export function ReadFailed() { return <DecisionLog decisions={undefined} readError="Durable storage is unavailable." now={LOG_NOW} onRetry={() => {}} />; }
