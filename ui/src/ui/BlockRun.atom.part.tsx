import { BlockRun } from "./BlockRun";

export const name = "Block run";
export const note = "Units of work as blocks on one line, in the tally's tones";

export default function Mixed() {
  return <p>Three runs <BlockRun tones={["plain", "bad", "live"]} label="3 runs: done, failed, working" /></p>;
}
export function NotStarted() {
  return <p>Planned <BlockRun tones={["faint"]} label="Not started" /></p>;
}
export function WaitsOnYou() {
  return <p>Your turn <BlockRun tones={["needs"]} label="Waits for you" /></p>;
}
export function Retried() {
  return <p>Retried, then passed <BlockRun tones={["plain", "warn", "plain"]} label="3 runs, 1 retried" /></p>;
}
