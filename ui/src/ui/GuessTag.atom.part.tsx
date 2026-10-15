import { ChevronsUpIcon } from "lucide-react";
import { GuessTag } from "./GuessTag";

export const name = "Guess tag";
export const note = "A short inferred word in a row: muted, or raised in full ink for something more pressing, read as a whole statement";

export default function Quiet() {
  return <GuessTag text="Review" label="Likely needs you: review" />;
}
export function Raised() {
  return <GuessTag text="Decision" label="Likely needs you: decision, high urgency" tone="raised" icon={<ChevronsUpIcon aria-hidden />} />;
}
export function NoKind() {
  return <GuessTag text="Likely needs you" label="Likely needs you" />;
}
