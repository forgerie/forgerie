import { PaceBar } from "./PaceBar";

export const name = "Pace bar";
export const note = "A budget's share left against an even spend";

export default function Even() {
  return <PaceBar value={52} pace={50} label="52% left, 2 points ahead of an even spend" />;
}
export function Short() {
  return <PaceBar value={20} pace={50} state="short" label="20% left, 30 points behind an even spend" />;
}
export function Surplus() {
  return <PaceBar value={62} pace={50} state="surplus" heat={0.1} label="62% left, 12 points ahead of an even spend" />;
}
export function SurplusHot() {
  return <PaceBar value={95} pace={12} state="surplus" heat={1} label="95% left, 83 points ahead of an even spend" />;
}
export function Empty() {
  return <PaceBar value={0} pace={40} state="empty" label="Nothing left" />;
}
export function Unpaced() {
  return <PaceBar value={70} label="70% left, no pace" />;
}
