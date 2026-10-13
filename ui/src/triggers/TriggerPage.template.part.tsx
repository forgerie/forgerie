import { useState } from "react";
import type { Trigger } from "@shared/triggers";
import { TriggerPage, type TriggerPageLoad, type TriggerSave } from "./TriggerPage";
import { draftOf, draftProblems, emptyDraft, isDirty, type TriggerDraft } from "./triggerDraft";
import { audit, digest, docs, HOST_ZONE, mixedList, nightly, workflows } from "./fixtures/triggers";
import { clock, folders, listModels, pageActions, projectLabel, ready } from "./fixtures/scenario";

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
  const workflow = workflows.find((item) => item.name === draft.workflow);
  return <TriggerPage load={load ?? { type: "ready", trigger }} draft={draft} dirty={isDirty(draft, base)} problems={draftProblems(draft, workflow)} save={saved}
    conflict={conflict} failure={failure} clock={clock} starting={false} checked={checked} projectLabel={draft.cwd ? projectLabel(draft.cwd) : "Choose a project"}
    projects={folders} workflows={ready} listModels={listModels} timezones={mixedList.timezones}
    actions={{ ...pageActions, onDraft: setDraft, onSave: () => setSaved({ type: "saved" }) }} />;
}
export default function Failed() { return <Page trigger={nightly} />; }
export function MissedByAgent() { return <Page trigger={audit} />; }
export function Paused() { return <Page trigger={docs} />; }
export function Starting() { return <Page trigger={digest} />; }
export function Edited() { return <Page trigger={nightly} start={{ ...draftOf(nightly), at: "04:15" }} />; }
export function Create() { return <Page />; }
export function CreateWithProblems() { return <Page checked start={{ ...emptyDraft(HOST_ZONE), cwd: nightly.action.cwd, repeat: "days", days: [] }} />; }
export function Refused() {
  return <Page start={{ ...draftOf(nightly), name: "Nightly refinement copy" }} save={{ type: "refused", message: "Unknown time zone \"Mars/Olympus\"." }} />;
}
export function Conflict() { return <Page trigger={nightly} start={{ ...draftOf(nightly), name: "Nightly backlog refinement" }} conflict />; }
export function Unknown() { return <Page load={{ type: "missing" }} />; }
export function ReadFailed() { return <Page load={{ type: "failed", message: "Triggers are off: database is locked" }} />; }
export function Loading() { return <Page load={{ type: "loading" }} />; }
export function PauseFailed() { return <Page trigger={nightly} failure="Could not pause “Nightly refinement”: Another change came first." />; }
