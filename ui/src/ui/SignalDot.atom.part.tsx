import { SignalDot } from "./SignalDot";

export const name = "Signal dot";
export const note = "A yes-or-no signal with no level";

export default function On() {
  return <SignalDot label="Answering" />;
}
export function Off() {
  return <SignalDot off label="Refusing work" />;
}
