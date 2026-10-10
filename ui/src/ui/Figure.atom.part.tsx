import { Figure } from "./Figure";

export const name = "Figure";
export const note = "A short figure in the code face, with a tone";

export default function Muted() {
  return <Figure>62</Figure>;
}
export function Plain() {
  return <Figure tone="plain">$7</Figure>;
}
export function Warn() {
  return <Figure tone="warn" label="Credit expires unspent in 5 days">5d</Figure>;
}
export function Bad() {
  return <Figure tone="bad" label="Runs dry before the reset in 4 days">4d</Figure>;
}
export function Faint() {
  return <Figure tone="faint">—</Figure>;
}
