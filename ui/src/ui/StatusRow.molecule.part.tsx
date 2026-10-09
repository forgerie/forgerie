import { StatusRow } from "./StatusRow";

export const name = "Status row";
export const note = "One running thing in a list: a tone dot, its name, a detail, and its status";

export default function Waiting() {
  return <StatusRow tone="waiting" name="ui" detail="design-engineer" status="Waiting for your answer" label="Open ui"
    onPress={() => {}} below={<p>Should the empty state show the last run, or stay blank?</p>} />;
}
export function Working() {
  return <StatusRow tone="working" name="api" detail="worker" status="Working" label="Open api" onPress={() => {}} />;
}
export function Idle() {
  return <StatusRow tone="quiet" name="a-much-longer-child-name-for-the-review-pass" detail="reviewer" status="Idle" label="Open reviewer" onPress={() => {}} />;
}
