import { RecapPanel } from "./RecapPanel";

export const name = "Recap panel";
export const note = "Where a piece of work stands: goal, done, left, what needs the reader, and next";

export default function NeedsYou() {
  return <RecapPanel code={"goal: Cut Fuji cold boot to under 20 s\ndone: Kernel update\ndone: initrd trimmed from 41 MB to 18 MB\ndone: Two stable reboots\nleft: Service ordering for network-online\nneeds you: Approve one more reboot\nnext: Measure three cold boots and compare with the 34 s baseline"} />;
}
export function NothingNeeded() {
  return <RecapPanel code={"goal: Cut Fuji cold boot to under 20 s\ndone: Kernel update\ndone: initrd trimmed from 41 MB to 18 MB\ndone: Two stable reboots\ndone: Service ordering for network-online\nleft: Measure three cold boots\nneeds you: nothing\nnext: Compare the three boots with the 34 s baseline"} />;
}
export function GoalOnly() {
  return <RecapPanel code={"goal: Move the backlog sync to the durable store"} />;
}
