import { useState } from "react";
import { DecisionList } from "./DecisionList";
import { CONFIRMED, LOG_NOW, RUN_DECISIONS, SESSION_DECISIONS } from "./fixtures/decisions";

export const name = "Decision list";
export const note = "Decisions the agents made without the reader, newest first";

function Choosing({ decisions }: { decisions: typeof SESSION_DECISIONS }) {
  const [target, setTarget] = useState<string>();
  const [records, setRecords] = useState(decisions);
  return <DecisionList title="All decisions" decisions={records} now={LOG_NOW} target={target} onRetry={() => {}}
    onChoose={(id) => setTarget(target === id ? undefined : id)}
    onConfirm={async (id) => {
      setRecords((current) => current.map((decision) => decision.id === id ? { ...decision, state: { kind: "confirmed", at: LOG_NOW } } : decision));
      setTarget((current) => current === id ? undefined : current);
      return true;
    }} />;
}
export default function Session() {
  return <Choosing decisions={SESSION_DECISIONS} />;
}
export function Run() {
  return <Choosing decisions={RUN_DECISIONS} />;
}
export function Confirmed() {
  return <Choosing decisions={[CONFIRMED]} />;
}
export function Empty() {
  return <DecisionList title="Decisions" decisions={[]} now={LOG_NOW} onRetry={() => {}} onChoose={() => {}} />;
}
export function Loading() {
  return <DecisionList title="Decisions" decisions={undefined} now={LOG_NOW} onRetry={() => {}} onChoose={() => {}} />;
}
export function ReadFailed() {
  return <DecisionList title="Decisions" decisions={undefined} readError="Durable storage is unavailable." now={LOG_NOW} onRetry={() => {}} onChoose={() => {}} />;
}
/** A later read failed: what was read before stays, under the reason. */
export function StaleAfterFailure() {
  return <DecisionList title="Decisions" decisions={RUN_DECISIONS} readError="HTTP 502" now={LOG_NOW} onRetry={() => {}} onChoose={() => {}} />;
}
export function ReadOnly() {
  return <DecisionList title="All decisions" decisions={SESSION_DECISIONS} now={LOG_NOW} onRetry={() => {}} />;
}
