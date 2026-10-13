import { DecisionsOpener } from "./DecisionsOpener";

export const name = "Decisions opener";
export const note = "The session header's way into its decision log, with a quiet count of flagged guesses";

export default function Flagged() {
  return <DecisionsOpener flagged={3} onOpen={() => {}} />;
}
export function NoneFlagged() {
  return <DecisionsOpener flagged={0} onOpen={() => {}} />;
}
