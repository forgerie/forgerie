import { MarkStrip } from "./MarkStrip";

export const name = "Mark strip";
export const note = "Past outcomes, oldest first: dot, square for a failure, ring for one that never happened, pulsing ring under way";

export default function Mixed() {
  return <MarkStrip label="Last 7 runs: 5 started, 2 failed." marks={["plain", "plain", "plain", "plain", "plain", "bad", "bad"]} />;
}
export function Missed() {
  return <MarkStrip label="Last 2 runs: 1 started, 1 missed." marks={["plain", "warn"]} />;
}
/** Past the limit, the oldest marks fold into a count in the worst tone they hide. */
export function Folded() {
  return <MarkStrip limit={5} label="Last 7 runs: 5 started, 1 failed, 1 missed." marks={["bad", "warn", "plain", "plain", "plain", "plain", "plain"]} />;
}
export function Starting() {
  return <MarkStrip label="Last 3 runs: 2 started, 1 starting." marks={["plain", "plain", "live"]} />;
}
export function Quiet() {
  return <MarkStrip quiet label="Last 3 runs: 2 started, 1 missed." marks={["plain", "warn", "plain"]} />;
}
