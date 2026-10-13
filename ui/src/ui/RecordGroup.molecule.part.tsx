import { useState } from "react";
import { RecordGroup } from "./RecordGroup";
import { RecordRow } from "./RecordRow";

export const name = "Record group";
export const note = "A counted group of records that opens and closes from its heading";
export const composition = { default: [{ part: "src/ui/RecordRow.molecule.part.tsx", state: "NoRuns" }] };

export default function Open() {
  const [open, setOpen] = useState(true);
  return <RecordGroup label="Active" count={2} open={open} onToggle={() => setOpen(!open)}>
    <RecordRow label="Weekday triage" title="Weekday triage" time="in 15 h" meta={[{ key: "when", text: "Weekdays at 9:00 AM" }]} outcome="Started Oct 12, 9:00 AM" onOpen={() => undefined} />
    <RecordRow label="Release notes" title="Release notes" time="in 4 d" meta={[{ key: "when", text: "Fridays at 5:00 PM" }]} outcome="No runs yet" onOpen={() => undefined} />
  </RecordGroup>;
}
export function Emphasis() {
  return <RecordGroup label="Needs a look" count={1} open emphasis onToggle={() => undefined}>
    <RecordRow label="Nightly refinement" title="Nightly refinement" time="in 9 h" mark="bad" meta={[{ key: "when", text: "Every night at 3:00 AM" }]}
      outcome="Failed Oct 12: Workflow was not found" onOpen={() => undefined} />
  </RecordGroup>;
}
export function Closed() {
  return <RecordGroup label="Paused" count={4} open={false} onToggle={() => undefined}><li>Hidden</li></RecordGroup>;
}
