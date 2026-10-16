import { StateMark, type WorkState } from "./StateMark";

export const name = "State mark";
export const note = "Where a job or a build stands, by shape and tone";

const STATES: readonly WorkState[] = ["failed", "passed", "running", "queued", "waiting", "cancelled", "skipped", "unknown"];
export default function Every() {
  return <ul aria-label="States">{STATES.map((state) => <li key={state}><StateMark state={state} /> {state}</li>)}</ul>;
}
export function Large() {
  return <p><StateMark state="failed" size="large" /> failed</p>;
}
