import { DeltaTable } from "./DeltaTable";

export const name = "Delta table";
export const note = "Numbers before and after a change, each read as better or worse";

export default function OneRegression() {
  return <DeltaTable code={"lower: Retained heap (MiB): 357.1 -> 208.3\nlower: Document DOM nodes: 18,420 -> 9,977\nlower: Typecheck errors: 27 -> 0\nhigher: UI tests passed: 2,040 -> 2,591\nlower: Cold boot (s): 34 -> 41"} />;
}
export function EdgeCases() {
  return <DeltaTable code={"Soak run\nlower: Quarantined flaky tests: 0 -> 3\nhigher: Frame budget slack (ms): -3.4 -> 1.2\nlower: Main entry (kB gzip): 412.6 -> 412.6\nWorkers per session: 4 -> 6\nlower: Peak resident set across all hosted sessions after a 24-hour soak (MiB): 1,284,950.2 -> 1,190,004.7"} />;
}
export function Arriving() {
  return <DeltaTable code={"lower: Retained heap (MiB): 357.1 -> 208.3\nlower: Document DOM nodes: 18,420 ->"} />;
}
