import { PipRun } from "./PipRun";

export const name = "Pip run";
export const note = "A count with no maximum, one pip per whole unit";

export default function Some() {
  return <PipRun count={7.1} label="7 left" />;
}
export function Low() {
  return <PipRun count={1.4} tone="warn" label="1 left, running low" />;
}
export function PartOfOne() {
  return <PipRun count={0.4} tone="warn" label="Less than 1 left" />;
}
export function MoreThanTheLaneHolds() {
  return <PipRun count={148} label="148 left" />;
}
