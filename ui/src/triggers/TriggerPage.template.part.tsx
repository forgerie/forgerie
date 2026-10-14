import { useState } from "react";
import type { Trigger } from "@shared/triggers";
import { TriggerPage, type TriggerPageLoad, type TriggerSave } from "./TriggerPage";
import { draftOf, emptyDraft, isDirty, type TriggerDraft } from "./triggerDraft";
import { audit, digest, docs, everywhere, FORGERIE, HOST_ZONE, mixedList, nightly, PI_MONO, spreadNotes } from "./fixtures/triggers";
import { clock, draftScenario, folders, listModels, pageActions, projectLabel } from "./fixtures/scenario";

export const name = "Trigger page";
export const note = "One trigger as a document, or a new one: attention, status, settings, inputs, and runs";
export const composition = { default: [
  { part: "src/triggers/TriggerAttention.organism.part.tsx", state: "default" },
  { part: "src/triggers/TriggerStatus.organism.part.tsx", state: "default" },
  { part: "src/triggers/TriggerForm.organism.part.tsx", state: "default" },
  { part: "src/triggers/TriggerRuns.organism.part.tsx", state: "default" },
] };

/** Real handlers on local state: typing changes the draft, and Save keeps it. */
function Page({ trigger, load, start, save = { type: "idle" }, conflict = false, checked = false, failure }: {
  trigger?: Trigger; load?: TriggerPageLoad; start?: TriggerDraft; save?: TriggerSave; conflict?: boolean; checked?: boolean; failure?: string;
}) {
  const base = trigger ? draftOf(trigger) : emptyDraft(HOST_ZONE);
  const [draft, setDraft] = useState(start ?? base);
  const [saved, setSaved] = useState(save);
  const { workflows, problems } = draftScenario(draft);
  return <TriggerPage load={load ?? { type: "ready", trigger }} draft={draft} dirty={isDirty(draft, base)} problems={problems} save={saved}
    conflict={conflict} failure={failure} clock={clock} starting={false} checked={checked} projectName={projectLabel}
    projects={folders} workflows={workflows} listModels={listModels} timezones={mixedList.timezones}
    actions={{ ...pageActions, onDraft: setDraft, onSave: () => setSaved({ type: "saved" }) }} />;
}
export default function Failed() { return <Page trigger={nightly} />; }
export function MissedByAgent() { return <Page trigger={audit} />; }
export function Paused() { return <Page trigger={docs} />; }
export function Starting() { return <Page trigger={digest} />; }
export function Edited() { return <Page trigger={nightly} start={{ ...draftOf(nightly), at: "04:15" }} />; }
export function Create() { return <Page />; }
export function CreateWithProblems() { return <Page checked start={{ ...emptyDraft(HOST_ZONE, [FORGERIE]), repeat: "days", days: [] }} />; }
/** Three fixed projects; every one started on the last run. */
export function SeveralProjects() { return <Page trigger={spreadNotes} />; }
/** All projects: the last run failed in one project and skipped one whose folder was gone. */
export function AllProjectsPartlyFailed() { return <Page trigger={everywhere} />; }
/** pi-mono added to a forgerie trigger: its workflow is not in pi-mono, and the page says so before Save. */
export function WorkflowNotShared() { return <Page trigger={nightly} start={{ ...draftOf(nightly), targets: { kind: "projects", cwds: [FORGERIE, PI_MONO] } }} />; }
export function Refused() {
  return <Page start={{ ...draftOf(nightly), name: "Nightly refinement copy" }} save={{ type: "refused", message: "Unknown time zone \"Mars/Olympus\"." }} />;
}
export function Conflict() { return <Page trigger={nightly} start={{ ...draftOf(nightly), name: "Nightly backlog refinement" }} conflict />; }
export function Unknown() { return <Page load={{ type: "missing" }} />; }
export function ReadFailed() { return <Page load={{ type: "failed", message: "Request failed: HTTP 500" }} />; }
export function Loading() { return <Page load={{ type: "loading" }} />; }
export function PauseFailed() { return <Page trigger={nightly} failure="Could not pause “Nightly refinement”: Another change came first." />; }
