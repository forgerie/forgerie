import { useState } from "react";
import { TriggerForm } from "./TriggerForm";
import { draftOf, draftProblems, emptyDraft, type TriggerDraft } from "./triggerDraft";
import { docs, HOST_ZONE, nightly, workflows } from "./fixtures/triggers";
import { folders, listModels, projectLabel, ready, ZONES } from "./fixtures/scenario";

export const name = "Trigger form";
export const note = "What a trigger does and when: project, workflow, days, time, zone, model, run late, and the workflow's inputs";
export const composition = { default: [
  { part: "src/ui/PropertyList.molecule.part.tsx", state: "default" },
  { part: "src/ui/ToggleGroup.molecule.part.tsx", state: "SeveralPressed" },
  { part: "src/ui/OptionPicker.molecule.part.tsx", state: "default" },
  { part: "src/workflows/WorkflowInputFields.molecule.part.tsx", state: "default" },
] };

/** Real handlers on local state: every field changes the draft. */
function Form({ start, check = false }: { start: TriggerDraft; check?: boolean }) {
  const [draft, setDraft] = useState(start);
  const workflow = workflows.find((item) => item.name === draft.workflow);
  return <TriggerForm draft={draft} onDraft={setDraft} problems={check ? draftProblems(draft, workflow) : {}} disabled={false} hostZone={HOST_ZONE}
    timezones={ZONES} projectLabel={draft.cwd ? projectLabel(draft.cwd) : "Choose a project"} projects={folders} workflows={ready} listModels={listModels} locale="en-US" />;
}
export default function Saved() { return <Form start={draftOf(nightly)} />; }
export function SomeDaysOtherZone() { return <Form start={draftOf(docs)} />; }
export function NewWithProblems() { return <Form start={{ ...emptyDraft(HOST_ZONE), repeat: "days", days: [] }} check />; }
export function ClockChangeHour() { return <Form start={{ ...draftOf(nightly), at: "02:30", model: "anthropic/claude-sonnet-4-5", thinkingLevel: "high" }} />; }
