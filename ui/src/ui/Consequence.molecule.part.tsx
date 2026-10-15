import { HourglassIcon, TimerResetIcon } from "lucide-react";
import { Consequence } from "./Consequence";

export const name = "Consequence";
export const note = "One consequence the reader must see before acting, plain or warn";

export default function Plain() {
  return <Consequence icon={<TimerResetIcon />}><p>The 7-day window starts over. Your next reset moves from <strong>Tue, Oct 13</strong> to <strong>Fri, Oct 16</strong>.</p></Consequence>;
}
export function Warn() {
  return <Consequence tone="warn" icon={<HourglassIcon />}><p>The weekly reset does not move. It stays at <strong>Sat, Oct 10, 8:00 AM</strong>, so you have <strong>23h</strong> to use the refill.</p></Consequence>;
}
export function WithActions() {
  return <Consequence tone="warn" icon={<HourglassIcon />} actions={[{ label: "Show line 5", onPress: () => undefined }, { label: "Pause until fixed", onPress: () => undefined }]}>
    <p><strong>Line 5 of the file has an error.</strong> The time must look like "01:00".</p>
  </Consequence>;
}
