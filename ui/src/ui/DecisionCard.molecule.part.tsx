import { FileTextIcon } from "lucide-react";
import { DecisionCard } from "./DecisionCard";
import { ActionFooter } from "./ActionFooter";

export const name = "Decision card";
export const note = "Something in the thread that waits on the reader's decision, and says what was decided once closed";

export default function Open() {
  return <DecisionCard icon={<FileTextIcon />} title="Contract" meta="Design, build, review" open
    footer={<ActionFooter note="Later stages start when you approve." actions={[
      { label: "Ask for changes", onPress: () => {} }, { label: "Approve", onPress: () => {}, tone: "primary" }]} />}>
    <p>The endpoint is GET /sessions/:id/child-runs.csv. Columns follow the run history sheet. The button has four states.</p>
  </DecisionCard>;
}
export function Closed() {
  return <DecisionCard icon={<FileTextIcon />} title="Contract" meta="Design, build, review" open={false} closed="Approved by you.">
    <p>The endpoint is GET /sessions/:id/child-runs.csv. Columns follow the run history sheet.</p>
  </DecisionCard>;
}
