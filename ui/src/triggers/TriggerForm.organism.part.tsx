import { useState } from "react";
import type { StateChecks } from "@simonwjackson/caliper/checks";
import { TriggerForm } from "./TriggerForm";
import { draftOf, emptyDraft, type TriggerDraft } from "./triggerDraft";
import { docs, everywhere, FORGERIE, HOST_ZONE, nightly, PI_MONO, spreadNotes } from "./fixtures/triggers";
import { draftScenario, folders, listModels, projectLabel, ZONES } from "./fixtures/scenario";

export const name = "Trigger form";
export const note = "What a trigger does and when: target projects, workflow, days, time, zone, model, run late, and the workflow's inputs";
export const composition = { default: [
  { part: "src/ui/PropertyList.molecule.part.tsx", state: "default" },
  { part: "src/ui/ChoicePicker.molecule.part.tsx", state: "default" },
  { part: "src/ui/ToggleGroup.molecule.part.tsx", state: "SeveralPressed" },
  { part: "src/ui/OptionPicker.molecule.part.tsx", state: "default" },
  { part: "src/workflows/WorkflowInputFields.molecule.part.tsx", state: "default" },
] };

export const checks = {
  SeveralProjects: {
    "the project picker opens with All projects above the projects": async ({ canvas, within, input, expect }) => {
      await input.click(canvas.getByRole("button", { name: "Target projects: Runs in 3 projects" }));
      const panel = within(document.body).getByRole("dialog", { name: "Target projects" });
      expect(within(panel).getByRole("checkbox", { name: /All projects/ })).toBeVisible();
      expect(within(panel).getByRole("checkbox", { name: /pi-mono/ })).toBeChecked();
    },
  },
  WorkflowNotShared: {
    "the workflow list says why refine-backlog is left out": async ({ canvas, within, input, expect }) => {
      await input.click(canvas.getByRole("button", { name: "Workflow: refine-backlog" }));
      expect(within(document.body).getByText("Missing in pi-mono")).toBeVisible();
    },
  },
} satisfies StateChecks;

/** Real handlers on local state: every field changes the draft, and the shared workflows follow the projects. */
function Form({ start, check = false }: { start: TriggerDraft; check?: boolean }) {
  const [draft, setDraft] = useState(start);
  const { workflows, problems } = draftScenario(draft);
  return <TriggerForm draft={draft} onDraft={setDraft} problems={check ? problems : {}} disabled={false} hostZone={HOST_ZONE}
    timezones={ZONES} projectName={projectLabel} projects={folders} workflows={workflows} listModels={listModels} locale="en-US" />;
}
export default function Saved() { return <Form start={draftOf(nightly)} />; }
export function SeveralProjects() { return <Form start={draftOf(spreadNotes)} />; }
export function AllProjects() { return <Form start={draftOf(everywhere)} />; }
/** pi-mono was added to a forgerie trigger: refine-backlog stays chosen and says why it cannot run there. */
export function WorkflowNotShared() { return <Form start={{ ...draftOf(nightly), targets: { kind: "projects", cwds: [FORGERIE, PI_MONO] } }} />; }
export function SomeDaysOtherZone() { return <Form start={draftOf(docs)} />; }
export function NewWithProblems() { return <Form start={{ ...emptyDraft(HOST_ZONE), repeat: "days", days: [] }} check />; }
export function ClockChangeHour() { return <Form start={{ ...draftOf(nightly), at: "02:30", model: "anthropic/claude-sonnet-4-5", thinkingLevel: "high" }} />; }
