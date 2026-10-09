import { Timeline } from "./Timeline";

export const name = "Timeline";
export const note = "Events in order with their times, joined by a rail";

export default function Evening() {
  return <Timeline code={"How the guide reached sessions\n18:22 - sessiond started\n21:20 - round one landed on main\n  The running daemon kept the old prompt.\n23:42 - sessiond restarted\n23:43 - first session with the guide"} />;
}
export function Dates() {
  return <Timeline code={"2026-09-30 - Streamdown replaces the old renderer\n2026-10-08 - rich blocks, rounds one to three\n2026-10-09 - round four"} />;
}
