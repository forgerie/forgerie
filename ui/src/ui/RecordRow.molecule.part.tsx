import { useState } from "react";
import { MarkStrip } from "./MarkStrip";
import { MenuButton } from "./MenuButton";
import { RecordRow } from "./RecordRow";

export const name = "Record row";
export const note = "One record as one press target: mark, title, time slot, meta parts, outcome strip, inline action and ⋯";
export const composition = { default: [
  { part: "src/ui/MarkStrip.atom.part.tsx", state: "default" },
  { part: "src/ui/MenuButton.molecule.part.tsx", state: "default" },
] };

const META = [{ key: "when", text: "Every night at 3:00 AM" }, { key: "where", text: "forgerie" }, { key: "what", text: "refine-backlog" }];

export default function Trouble() {
  const [seen, setSeen] = useState(false);
  const [opened, setOpened] = useState("Not opened");
  return <><ul>
    <RecordRow label="Nightly refinement. Every night at 3:00 AM. Next run in 9 hours. Last 7 runs: 5 started, 2 failed."
      title="Nightly refinement" time="in 9 h" meta={META} mark={seen ? undefined : "bad"}
      strip={<MarkStrip marks={["plain", "plain", "plain", "plain", "plain", "bad", "bad"]} />}
      outcome={'Failed Oct 12: Workflow "refine-backlog" was not found in /home/reader/forgerie'}
      action={seen ? undefined : { label: "Mark as seen", onPress: () => setSeen(true) }}
      menu={<MenuButton label="Commands for Nightly refinement" commands={[{ label: "Run now…", onSelect: () => undefined }]} />}
      onOpen={() => setOpened("Opened Nightly refinement")} />
  </ul><p>{opened}</p></>;
}
export function Resting() {
  return <ul><RecordRow label="Docs sweep. Paused." title="Docs sweep" time="Paused" dimmed
    meta={[{ key: "when", text: "Sundays at 4:00 AM New York time" }, { key: "where", text: "forgerie" }, { key: "what", text: "docs-sweep" }]}
    strip={<MarkStrip quiet marks={["plain", "warn"]} />} outcome="Missed Oct 5, 4:00 AM" action={{ label: "Resume", onPress: () => undefined }}
    onOpen={() => undefined} /></ul>;
}
export function Narrow() {
  return <ul><RecordRow layout="narrow" label="Weekday triage. Weekdays at 9:00 AM." title="Weekday triage with a long name that wraps to a second line"
    time="in 15 h" meta={[{ key: "when", text: "Weekdays at 9:00 AM" }, { key: "where", text: "pi-mono" }, { key: "what", text: "triage-issues" }]}
    strip={<MarkStrip limit={5} marks={["plain", "plain", "plain", "plain", "plain", "plain", "plain"]} />} outcome="Started Oct 12, 9:00 AM"
    menu={<MenuButton label="Commands for Weekday triage" commands={[{ label: "Pause", onSelect: () => undefined }]} />} onOpen={() => undefined} /></ul>;
}
export function NoRuns() {
  return <ul><RecordRow label="Release notes. Fridays at 5:00 PM. No runs yet." title="Release notes" time="in 4 d"
    meta={[{ key: "when", text: "Fridays at 5:00 PM" }, { key: "where", text: "forgerie" }, { key: "what", text: "release-notes" }]}
    outcome="No runs yet" onOpen={() => undefined} /></ul>;
}
