import { useState } from "react";
import type { TriggerFileDocument } from "@shared/triggerFiles";
import { TriggerFilePage, type TriggerFileLoad, type TriggerFileSave, type TriggerVersionsLoad } from "./TriggerFilePage";
import { scheduleDraftOf, settingsChanged, type ScheduleDraft } from "./triggerFile";
import type { FileTrigger } from "./triggersApi";
import { HOST_ZONE, mixedList } from "./fixtures/triggers";
import {
  brokenDocument, brokenMaintenance, maintenance, maintenanceDocument, maintenanceVersions, MAINTENANCE_TEXT, unscheduledDocument, unscheduledMaintenance, versionList,
} from "./fixtures/triggerFiles";
import { clock, fileActions, folders, listModels, projectLabel } from "./fixtures/scenario";

export const name = "Trigger file page";
export const note = "A trigger as the workflow file that holds it: status, the file's front matter as a side panel, and its prose as the document";
export const composition = { default: [
  { part: "src/triggers/TriggerFilePanel.organism.part.tsx", state: "default" },
  { part: "src/triggers/TriggerFileEditor.organism.part.tsx", state: "default" },
  { part: "src/triggers/TriggerStatus.organism.part.tsx", state: "AsHead" },
  { part: "src/triggers/TriggerRuns.organism.part.tsx", state: "default" },
], Edited: [{ part: "src/triggers/TriggerFileNotice.molecule.part.tsx", state: "default" }],
Invalid: [{ part: "src/triggers/TriggerFileNotice.molecule.part.tsx", state: "Invalid" }],
NoSchedule: [{ part: "src/triggers/TriggerFileNotice.molecule.part.tsx", state: "NoSchedule" }] };

const EDITED_TEXT = MAINTENANCE_TEXT.replace("Measure the project's health at bedtime.", "Measure the project's health at bedtime, before any change.");
const ready = (document: TriggerFileDocument): TriggerFileLoad => ({ type: "ready", document });
const kept: TriggerVersionsLoad = { type: "ready", versions: versionList };

/** Real handlers on local state: typing and the side panel change the draft, Save keeps it, Restore loads a version. */
function Page({ trigger = maintenance, file = ready(maintenanceDocument), text: startText, settings: startSettings, save: startSave = { type: "idle" },
  conflict = false, view, versionsOpen, versions = kept }: {
  trigger?: FileTrigger; file?: TriggerFileLoad; text?: string; settings?: (start: ScheduleDraft) => ScheduleDraft; save?: TriggerFileSave;
  conflict?: boolean; view?: "rich" | "source"; versionsOpen?: boolean; versions?: TriggerVersionsLoad;
}) {
  const document = file.type === "ready" ? file.document : undefined;
  const [start, setStart] = useState(() => scheduleDraftOf(trigger, document, HOST_ZONE));
  const [base, setBase] = useState(document?.text ?? "");
  const [text, setText] = useState(startText ?? base);
  const [settings, setSettings] = useState(() => startSettings ? startSettings(start) : start);
  const [save, setSave] = useState(startSave);
  const [restored, setRestored] = useState(0);
  const [shown, setShown] = useState<"rich" | "source">(view ?? "rich");
  return <TriggerFilePage trigger={trigger} file={file} text={text} editorKey={String(restored)} settings={settings} settingsStart={start}
    textDirty={document !== undefined && text !== base} settingsDirty={settingsChanged(settings, start)} versions={versions} save={save} conflict={conflict}
    clock={clock} starting={false} projectName={projectLabel} projects={folders} listModels={listModels} timezones={mixedList.timezones}
    view={shown} onView={setShown} versionsOpen={versionsOpen}
    actions={{ ...fileActions, onText: (next) => { setText(next); setSave({ type: "idle" }); }, onSettings: (next) => { setSettings(next); setSave({ type: "idle" }); },
      onSave: () => { setBase(text); setStart(settings); setSave({ type: "saved" }); },
      onDiscard: () => { setText(base); setSettings(start); setRestored(restored + 1); },
      onRestore: (id) => { const found = maintenanceVersions.find((version) => version.id === id); if (found) { setText(found.text); setRestored(restored + 1); } } }} />;
}

export default function Clean() { return <Page />; }
/** The time moved to 2:00 AM and a sentence changed: the dot on the title, Save, and what saving does. */
export function Edited() { return <Page text={EDITED_TEXT} settings={(start) => ({ ...start, at: "02:00" })} />; }
/** Side-panel values the source does not show yet, said above the text. */
export function EditedInSource() { return <Page view="source" settings={(start) => ({ ...start, at: "02:00" })} />; }
export function VersionsOpen() { return <Page text={EDITED_TEXT} settings={(start) => ({ ...start, at: "02:00" })} versionsOpen />; }
/** An edit outside Forgerie broke line 5. The last good settings run tonight. */
export function Invalid() { return <Page trigger={brokenMaintenance} file={ready(brokenDocument)} view="source" />; }
/** The schedule block is gone: the trigger is paused and keeps its history. */
export function NoSchedule() { return <Page trigger={unscheduledMaintenance} file={ready(unscheduledDocument)} />; }
/** The file itself is gone. */
export function FileGone() { return <Page trigger={unscheduledMaintenance} file={{ type: "gone" }} versions={{ type: "ready", versions: [] }} />; }
/** Save refused a file that would not run, with the line. */
export function Refused() {
  return <Page text={MAINTENANCE_TEXT.replace('"01:00"', "2am")} view="source"
    save={{ type: "refused", line: 5, message: "`at` must be a time such as \"01:00\". The file says \"2am\"." }} />;
}
/** The file changed on disk while these edits waited. */
export function Conflict() { return <Page text={EDITED_TEXT} conflict />; }
export function Loading() { return <Page file={{ type: "loading" }} versions={{ type: "loading" }} />; }
export function ReadFailed() { return <Page file={{ type: "failed", message: "Request failed: HTTP 500" }} versions={{ type: "failed", message: "Request failed: HTTP 500" }} />; }
