import { SignalDot } from "./SignalDot";

export const name = "Signal dot";
export const note = "A yes-or-no signal with no level, as a dot or as a run across a lane";

export default function On() {
  return <SignalDot label="Answering" />;
}
export function Off() {
  return <SignalDot off label="Refusing work" />;
}
export function Run() {
  return <SignalDot run label="Answering" />;
}
export function RunOff() {
  return <SignalDot run off label="Refusing work" />;
}
