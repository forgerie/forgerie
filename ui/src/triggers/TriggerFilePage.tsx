import { useEffect, useRef, useState } from "react";
import { CopyIcon, HistoryIcon, PauseIcon, PlayIcon, SaveIcon, Trash2Icon, XIcon, ZapIcon } from "lucide-react";
import type { Trigger } from "@shared/triggers";
import type { TriggerFileDocument, TriggerFileVersion } from "@shared/triggerFiles";
import { SettingsFrame } from "../ui/settings/SettingsFrame";
import { BackButton } from "../ui/BackButton";
import { DocumentRail } from "../ui/DocumentRail";
import { DocumentTitle } from "../ui/DocumentTitle";
import { HeaderButton } from "../ui/HeaderButton";
import { HeaderIcon } from "../ui/HeaderIcon";
import { LoadingLines } from "../ui/LoadingLines";
import { MenuButton, type MenuCommand } from "../ui/MenuButton";
import { OptionPicker } from "../ui/OptionPicker";
import type { OptionItem } from "../ui/OptionList";
import type { MarkdownView } from "../ui/useMarkdownView";
import type { SessionModel } from "../contracts";
import { TriggerAttention } from "./TriggerAttention";
import { TriggerFileEditor, type LineJump } from "./TriggerFileEditor";
import { TriggerFileNotice } from "./TriggerFileNotice";
import { TriggerFilePanel } from "./TriggerFilePanel";
import type { ProjectsLoad } from "./TriggerForm";
import { TriggerRuns } from "./TriggerRuns";
import { TriggerStatus } from "./TriggerStatus";
import {
  dayTimeWords, descriptionOf, fileName, fileOf, invalidWords, lineOf, missingWords, savingWords, VERSION_SOURCE, type ScheduleDraft,
} from "./triggerFile";
import { triggersPlan, UNMEASURED } from "./triggersModel";
import { storeOffWords, type WordClock } from "./triggerWords";
import type { ProjectName } from "./triggerTargets";

/** The file as the page reads it: on its way, read, gone (404), or unreadable. */
export type TriggerFileLoad = { type: "loading" } | { type: "ready"; document: TriggerFileDocument } | { type: "gone" } | { type: "failed"; message: string };
/** The versions Forgerie kept, newest first. */
export type TriggerVersionsLoad = { type: "loading" } | { type: "ready"; versions: readonly TriggerFileVersion[] } | { type: "failed"; message: string };
/** A save in flight, one that just landed, or a refusal with the server's words. `off`: the trigger store is unavailable (503). */
export type TriggerFileSave = { type: "idle" } | { type: "saving" } | { type: "saved" }
  | { type: "refused"; message: string; line?: number | undefined; off?: boolean | undefined };

export interface TriggerFilePageActions {
  /** The editor's whole text. */
  onText: (text: string) => void;
  onSettings: (settings: ScheduleDraft) => void;
  onSave: () => void;
  onDiscard: () => void;
  /** Load a kept version's text into the editor. Save still writes it. */
  onRestore: (versionId: string) => void;
  onBack: () => void; onClose: () => void;
  /** Read the file again. With a conflict, this drops the edits. */
  onReload: () => void;
  onRunNow: () => void; onPause: () => void; onResume: () => void; onAcknowledge: () => void; onDelete: () => void;
  onCopyId: () => void;
  onOpenSession: (session: { id: string; cwd: string }) => void;
}

/**
 * Shape: a trigger as the workflow file that holds it. The head says what the
 * workflow is for and how it runs: the title and description, the next and
 * last run. The side panel holds the file's front matter as controls, and the
 * file itself is the document, in Rich or Source. One Save writes the text and,
 * when a panel value changed, the schedule block. The title carries a dot
 * until it saves. A narrow container puts the panel between the head and the
 * text; the header moves Run now…, then Save, into ⋯ as it narrows.
 */
export function TriggerFilePage({ trigger, file, text, editorKey, settings, settingsStart, textDirty, settingsDirty, versions, save, conflict, failure, clock,
  starting, creatorName, projectName, projects, listModels, timezones, view, onView, versionsOpen = false, actions }: {
  trigger: Trigger;
  file: TriggerFileLoad;
  /** The editor's text, edits included. */
  text: string;
  /** Changes when the editor must start again from `text`: another editing base, a discard, or a restored version. */
  editorKey: string;
  settings: ScheduleDraft; settingsStart: ScheduleDraft;
  textDirty: boolean; settingsDirty: boolean;
  versions: TriggerVersionsLoad;
  save: TriggerFileSave;
  /** The file changed elsewhere since these edits began. */
  conflict: boolean;
  failure?: string | undefined;
  clock: WordClock; starting: boolean;
  creatorName?: string | undefined;
  projectName: ProjectName; projects: ProjectsLoad;
  listModels: (signal: AbortSignal) => Promise<SessionModel[]>;
  timezones: readonly string[];
  /** Rich or Source, as the reader last chose for Markdown files. */
  view: MarkdownView;
  onView: (view: MarkdownView) => void;
  /** Opens with the versions shown, such as for a preview. */
  versionsOpen?: boolean | undefined;
  actions: TriggerFilePageActions;
}) {
  const [room, setRoom] = useState(UNMEASURED);
  const plan = triggersPlan(room.column, room.header, room.body);
  const [jump, setJump] = useState<LineJump>();
  const showLine = (line: number) => setJump((last) => ({ line, at: (last?.at ?? 0) + 1 }));
  const state = fileOf(trigger);
  const document = file.type === "ready" ? file.document : undefined;
  const saving = save.type === "saving";
  const dirty = textDirty || settingsDirty;
  const savable = document !== undefined && dirty && !saving;
  // Ctrl or Cmd + S saves from anywhere on the page. The editors save on their own and mark the key as handled.
  const latest = useRef(actions.onSave);
  latest.current = actions.onSave;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s" || event.defaultPrevented) return;
      event.preventDefault();
      if (savable) latest.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [savable]);

  const name = state ? fileName(state.path) : `${trigger.id}.md`;
  const saveAction = { label: saving ? "Saving…" : dirty ? "Save" : "Saved", icon: <SaveIcon aria-hidden size={16} />, disabled: !savable, run: actions.onSave };
  const runNow = { label: "Run now…", icon: <ZapIcon aria-hidden size={16} />, run: actions.onRunNow };
  const commands: (MenuCommand | "separator")[] = [
    ...plan.primary === "menu" ? [{ label: saveAction.label, icon: saveAction.icon, disabled: saveAction.disabled, onSelect: saveAction.run }] : [],
    ...plan.secondary === "menu" ? [{ label: dirty ? "Run now with the saved file…" : runNow.label, icon: runNow.icon, onSelect: runNow.run }] : [],
    // Pausing writes the file, so while the page holds edits the panel's Pause is the one that applies.
    ...dirty ? [] : [trigger.state.kind === "active" ? { label: "Pause", icon: <PauseIcon aria-hidden />, onSelect: actions.onPause }
      : { label: "Resume", icon: <PlayIcon aria-hidden />, onSelect: actions.onResume }],
    ...dirty ? [{ label: "Discard changes", icon: <XIcon aria-hidden />, disabled: saving, onSelect: actions.onDiscard }] : [],
    { label: "Copy trigger ID", icon: <CopyIcon aria-hidden />, onSelect: actions.onCopyId },
    "separator",
    { label: "Delete trigger…", icon: <Trash2Icon aria-hidden />, tone: "danger", onSelect: actions.onDelete },
  ];
  const changedWhat = textDirty && settingsDirty ? "Text and side panel" : settingsDirty ? "Side panel" : "Text";
  const versionOptions: OptionItem[] = [
    ...dirty ? [{ id: "", name: "Now, not saved", details: [changedWhat], blocked: true }] : [],
    ...versions.type === "ready" ? versions.versions.map((version) => ({ id: version.id, name: dayTimeWords(version.savedAt, clock),
      details: [version.sha256 === document?.sha256 ? `${VERSION_SOURCE[version.source]}. On disk now` : VERSION_SOURCE[version.source]],
      current: version.sha256 === document?.sha256 && !dirty })) : [],
  ];
  const versionStatus = versions.type === "loading" ? { tone: "status" as const, text: "Reading versions…" }
    : versions.type === "failed" ? { tone: "alert" as const, text: `Could not read the versions: ${versions.message}` }
    : versions.versions.length === 0 ? { tone: "status" as const, text: "Forgerie has kept no version of this file yet." }
    : { tone: "status" as const, text: "Restore puts that text in the editor. Save writes it." };

  const error = file.type === "failed" ? `Could not read ${name}: ${file.message}`
    : save.type === "refused" && save.off ? storeOffWords(save.message) : failure;
  const notice = conflict ? <>
    <p>{name} changed on disk while you were editing. Forgerie cannot save over that change. Reload shows the file as it is now and drops your changes.</p>
    <button type="button" onClick={actions.onReload}>Reload</button>
  </> : undefined;

  const invalid = state?.status === "invalid" ? invalidWords(trigger, state, clock, projectName) : undefined;
  const refused = save.type === "refused" && !save.off ? save : undefined;
  const effect = savingWords(settings, settingsStart, clock, projectName);
  // What is wrong with the file leads, under the status, so a narrow column reads it before the panel.
  const fileNotices = [
    refused ? <TriggerFileNotice key="refused" notice={{ kind: "refused", message: refused.message, line: refused.line,
      onShowLine: refused.line === undefined ? undefined : () => showLine(refused.line ?? 1) }} /> : null,
    invalid ? <TriggerFileNotice key="invalid" notice={{ kind: "invalid", ...invalid, onShowLine: invalid.line === undefined ? undefined : () => showLine(invalid.line ?? 1),
      onPause: trigger.state.kind === "active" ? actions.onPause : undefined }} /> : null,
    state?.status === "missing" ? <TriggerFileNotice key="missing" notice={{ kind: "missing", ...missingWords(trigger, state, document !== undefined) }} /> : null,
  ];
  // What Save does sits with the text it writes.
  const editorNotices = [dirty ? <TriggerFileNotice key="saving" notice={{ kind: "saving", ...effect }} /> : null];
  const stagesLine = document ? lineOf(text, "stages") : undefined;

  const head = <>
    <TriggerAttention trigger={trigger} clock={clock} errorLines={plan.errorLines} projectName={projectName} onAcknowledge={actions.onAcknowledge}
      onRunNow={actions.onRunNow} onOpenSession={actions.onOpenSession} />
    <DocumentTitle title={trigger.name} standfirst={descriptionOf(text)} />
    <TriggerStatus trigger={trigger} clock={clock} starting={starting} creatorName={creatorName} projectName={projectName} narrow={plan.row.tier === "narrow"}
      variant="head" onPause={actions.onPause} onResume={actions.onResume} onOpenSession={actions.onOpenSession} />
  </>;
  const rail = file.type === "loading" ? <LoadingLines label="Reading the file…" />
    : <TriggerFilePanel draft={settings} onDraft={actions.onSettings} problems={{}} disabled={saving || document === undefined}
      definition={document ? document.definition : null} unreadable={document ? undefined : `Forgerie shows the route once it can read ${name} again.`} hostZone={clock.hostZone} timezones={timezones} projectName={projectName} projects={projects}
      listModels={listModels} locale={clock.locale} onEditStages={document && stagesLine !== undefined ? () => showLine(stagesLine) : undefined} />;
  return <SettingsFrame wide back={<BackButton label="Triggers" onPress={actions.onBack} />} title={trigger.name} mark={dirty ? "Unsaved changes" : undefined}
    status={saving ? "Saving…" : undefined} onRoom={setRoom} density={plan.density}
    actions={<>
      <OptionPicker look="icon" label="Versions" icon={<HistoryIcon aria-hidden />} placeholder="Versions" heading={`Versions of ${name}`}
        initiallyOpen={versionsOpen} disabled={document === undefined || saving} options={versionOptions} status={versionStatus}
        onChoose={(id) => { if (id) actions.onRestore(id); }} />
      {plan.secondary === "header" ? <HeaderButton tone="plain" label={runNow.label} icon={runNow.icon} onPress={runNow.run} /> : null}
      {plan.primary === "header" ? <HeaderButton label={saveAction.label} icon={saveAction.icon} disabled={saveAction.disabled} onPress={saveAction.run} /> : null}
      <MenuButton label="Trigger commands" commands={commands} />
      <HeaderIcon label="Close triggers" icon={<XIcon aria-hidden />} onPress={actions.onClose} />
    </>}
    error={error} recovery={file.type === "failed" ? <button type="button" onClick={actions.onReload}>Retry</button> : undefined} notice={notice}>
    <DocumentRail head={head} notices={fileNotices} rail={rail} railLabel={`Settings in ${name}`}>
      {file.type === "loading" ? <LoadingLines label={`Reading ${name}…`} widths={[92, 100, 64, 38]} />
        : document ? <TriggerFileEditor key={editorKey} path={document.path} text={text} document={editorKey} view={view} onView={onView}
          notices={editorNotices} sourceNotice={settingsDirty ? <TriggerFileNotice notice={{ kind: "panel" }} /> : null}
          markLine={refused?.line ?? invalid?.line} jump={jump} readOnly={saving} onChange={actions.onText} onSave={actions.onSave} />
        : null}
      <TriggerRuns trigger={trigger} clock={clock} starting={starting} projectName={projectName} narrow={plan.row.tier === "narrow"} onOpenSession={actions.onOpenSession} />
    </DocumentRail>
  </SettingsFrame>;
}
