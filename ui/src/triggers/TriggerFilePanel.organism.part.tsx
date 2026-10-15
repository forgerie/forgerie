import { useState } from "react";
import { TriggerFilePanel } from "./TriggerFilePanel";
import { scheduleDraftOf } from "./triggerFile";
import { HOST_ZONE, mixedList } from "./fixtures/triggers";
import { brokenMaintenance, maintenance, maintenanceDocument } from "./fixtures/triggerFiles";
import { clock, folders, listModels, projectLabel } from "./fixtures/scenario";

export const name = "Trigger file panel";
export const note = "A workflow file's front matter as controls: schedule with Pause, the route read-only, and input overrides";
export const composition = { default: [
  { part: "src/triggers/TriggerForm.organism.part.tsx", state: "default" },
  { part: "src/ui/RouteList.molecule.part.tsx", state: "default" },
  { part: "src/workflows/WorkflowInputFields.molecule.part.tsx", state: "default" },
] };

function Panel({ paused = false, overrides = {}, readable = true }: { paused?: boolean; overrides?: Record<string, string>; readable?: boolean }) {
  const [draft, setDraft] = useState(() => ({ ...scheduleDraftOf(maintenance, maintenanceDocument, HOST_ZONE), paused, inputs: overrides }));
  return <TriggerFilePanel draft={draft} onDraft={setDraft} problems={{}} disabled={false} definition={readable ? maintenanceDocument.definition : null}
    hostZone={HOST_ZONE} timezones={mixedList.timezones} projectName={projectLabel} projects={folders} listModels={listModels} locale={clock.locale}
    onEditStages={() => undefined} />;
}
export default function Schedule() { return <Panel />; }
/** Pause pressed, and one input that differs from the file's default. */
export function PausedWithOverride() { return <Panel paused overrides={{ improvements: "4" }} />; }
/** The workflow block cannot be read, so the route says so. */
export function RouteUnreadable() { return <Panel readable={false} />; }
export function FromRunningSettings() {
  const [draft, setDraft] = useState(() => scheduleDraftOf(brokenMaintenance, undefined, HOST_ZONE));
  return <TriggerFilePanel draft={draft} onDraft={setDraft} problems={{}} disabled definition={null}
    hostZone={HOST_ZONE} timezones={mixedList.timezones} projectName={projectLabel} projects={folders} listModels={listModels} />;
}
