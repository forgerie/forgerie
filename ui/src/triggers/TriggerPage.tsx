import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CopyIcon, PauseIcon, PlayIcon, PlusIcon, SaveIcon, Trash2Icon, XIcon, ZapIcon } from "lucide-react";
import type { Trigger } from "@shared/triggers";
import { SettingsFrame } from "../ui/settings/SettingsFrame";
import { HeaderButton } from "../ui/HeaderButton";
import { HeaderIcon } from "../ui/HeaderIcon";
import { BackButton } from "../ui/BackButton";
import { MenuButton, type MenuCommand } from "../ui/MenuButton";
import { TitleField } from "../ui/TitleField";
import { Lede } from "../ui/Lede";
import { LoadingLines } from "../ui/LoadingLines";
import type { Project, Workspace } from "../newSession";
import type { SessionModel } from "../contracts";
import { TriggerAttention } from "./TriggerAttention";
import { TriggerStatus } from "./TriggerStatus";
import { TriggerForm, type WorkflowsLoad } from "./TriggerForm";
import { TriggerRuns } from "./TriggerRuns";
import { triggersPlan, UNMEASURED } from "./triggersModel";
import { problemList, type DraftProblems, type TriggerDraft } from "./triggerDraft";
import { storeOffWords, type WordClock } from "./triggerWords";

/** Where the page is: reading the trigger, unknown, unreadable, or ready to edit. A new trigger is always ready. */
export type TriggerPageLoad =
  | { type: "loading" }
  | { type: "missing" }
  | { type: "failed"; message: string }
  | { type: "ready"; trigger?: Trigger | undefined };

/** Save state: a save in flight, a save that just landed, or a refusal. `off`: the trigger store is unavailable (503). */
export type TriggerSave = { type: "idle" } | { type: "saving" } | { type: "saved" } | { type: "refused"; message: string; off?: boolean | undefined };

export interface TriggerPageActions {
  onDraft: (draft: TriggerDraft) => void;
  /** Save an edit or create a new trigger. The page checks the draft first and shows its problems instead. */
  onSave: () => void;
  onDiscard: () => void;
  onBack: () => void; onClose: () => void;
  onRetry: () => void;
  /** Read the trigger again and drop the draft, after someone else changed it. */
  onReload: () => void;
  onRunNow: () => void; onPause: () => void; onResume: () => void; onAcknowledge: () => void; onDelete: () => void;
  onCopyId: () => void;
  onOpenSession: (session: { id: string; cwd: string }) => void;
}

/**
 * Shape: one trigger as a document, or a new one. The attention card leads
 * when a run failed or was missed; the status lines say when it runs next and
 * how the last run went; the settings and inputs follow; the runs close it.
 * The header's one action is Run now… while the page has no changes, Save
 * while it does, and Create for a new trigger.
 */
export function TriggerPage({ load, draft, dirty, problems, save, conflict, failure, clock, starting, creatorName, focusName, checked = false,
  projectLabel, projects, workflows, listModels, timezones, actions }: {
  load: TriggerPageLoad; draft: TriggerDraft; dirty: boolean;
  /** Problems found in the browser and the field a server refusal names. Shown after the first save attempt. */
  problems: DraftProblems;
  save: TriggerSave;
  /** The trigger changed elsewhere since this draft began. */
  conflict: boolean;
  /** A command that failed, such as "Could not pause …". */
  failure?: string | undefined;
  clock: WordClock; starting: boolean;
  creatorName?: string | undefined;
  /** Put the caret in the name, as Edit asks. */
  focusName?: boolean | undefined;
  /** Show the draft's problems before the reader tries to save, such as for a draft that a save already refused. */
  checked?: boolean | undefined;
  projectLabel: string;
  projects: { list: (signal: AbortSignal) => Promise<Project[]>; workspaces: (projectId: string, signal: AbortSignal) => Promise<Workspace[]> };
  workflows: WorkflowsLoad;
  listModels: (signal: AbortSignal) => Promise<SessionModel[]>;
  timezones: readonly string[];
  actions: TriggerPageActions;
}) {
  const [room, setRoom] = useState(UNMEASURED);
  const plan = triggersPlan(room.column, room.header, room.body);
  const body = useRef<HTMLDivElement>(null);
  const trigger = load.type === "ready" ? load.trigger : undefined;
  const fresh = load.type === "ready" && !trigger;
  const saving = save.type === "saving";
  const listed = problemList(problems);
  // A refused save moves focus to the first field at fault, so the reader lands on what to fix.
  const [asked, setAsked] = useState(0);
  // Problems show once the reader tried to save, or when the server named a field.
  const [tried, setTried] = useState(false);
  const showing = checked || tried || save.type === "refused";
  useLayoutEffect(() => {
    if (asked === 0) return;
    const target = body.current?.querySelector<HTMLElement>("[data-problem] :is(input, button, textarea, [tabindex])");
    target?.focus();
  }, [asked]);
  const submit = () => { setTried(true); if (listed.length > 0) setAsked((count) => count + 1); else actions.onSave(); };
  // Ctrl or Cmd + S saves, as in the agent editor.
  const latest = useRef(submit);
  latest.current = submit;
  const savable = fresh || dirty;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      if (savable) latest.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [savable]);

  const title = load.type === "missing" ? "Trigger" : fresh ? "New trigger" : trigger?.name ?? "Trigger";
  const status = fresh ? (saving ? "Creating…" : undefined) : saving ? "Saving…" : dirty ? "Unsaved changes" : save.type === "saved" ? "Saved" : undefined;
  const primary = fresh ? { label: saving ? "Creating…" : "Create", icon: <PlusIcon aria-hidden size={16} />, run: submit }
    : dirty ? { label: saving ? "Saving…" : "Save", icon: <SaveIcon aria-hidden size={16} />, run: submit }
    : trigger ? { label: "Run now…", icon: <ZapIcon aria-hidden size={16} />, run: actions.onRunNow } : undefined;
  const commands: (MenuCommand | "separator")[] = fresh ? [
    ...plan.primary === "menu" && primary ? [{ label: primary.label, icon: primary.icon, disabled: saving, onSelect: primary.run }] : [],
    { label: "Discard", icon: <XIcon aria-hidden />, disabled: saving, onSelect: actions.onDiscard },
  ] : trigger ? [
    ...plan.primary === "menu" && primary ? [{ label: primary.label, icon: primary.icon, disabled: saving, onSelect: primary.run }] : [],
    ...dirty ? [{ label: "Run now with saved settings…", icon: <ZapIcon aria-hidden />, onSelect: actions.onRunNow }] : [],
    trigger.state.kind === "active" ? { label: "Pause", icon: <PauseIcon aria-hidden />, onSelect: actions.onPause }
      : { label: "Resume", icon: <PlayIcon aria-hidden />, onSelect: actions.onResume },
    ...dirty ? [{ label: "Discard changes", icon: <XIcon aria-hidden />, disabled: saving, onSelect: actions.onDiscard }] : [],
    { label: "Copy trigger ID", icon: <CopyIcon aria-hidden />, onSelect: actions.onCopyId },
    "separator",
    { label: "Delete trigger…", icon: <Trash2Icon aria-hidden />, tone: "danger", onSelect: actions.onDelete },
  ] : [];
  const error = load.type === "missing" ? "No trigger has this ID. It may have been deleted."
    : load.type === "failed" ? `Could not read the trigger: ${load.message}`
    : save.type === "refused" ? save.off ? storeOffWords(save.message) : `Forgerie did not save the trigger: ${save.message}` : failure
    // The summary of what to fix, under the header where the primary action is, in the tone of a refusal.
    ?? (showing && listed.length > 0 ? listed.join(" ") : undefined);
  const recovery = load.type === "missing" ? <button type="button" onClick={actions.onBack}>Show all triggers</button>
    : load.type === "failed" ? <button type="button" onClick={actions.onRetry}>Retry</button> : undefined;
  const notice = conflict ? <>
    <p>This trigger changed while you were editing. Forgerie cannot save over that change. Reload shows the new version and discards your changes.</p>
    <button type="button" onClick={actions.onReload}>Reload</button>
  </> : undefined;
  return <SettingsFrame back={<BackButton label="Triggers" onPress={actions.onBack} />} title={title} status={status} onRoom={setRoom}
    actions={<>
      {primary && plan.primary === "header" ? <HeaderButton label={primary.label} icon={primary.icon} disabled={saving} onPress={primary.run} /> : null}
      {commands.length ? <MenuButton label="Trigger commands" commands={commands} /> : null}
      <HeaderIcon label="Close triggers" icon={<XIcon aria-hidden />} onPress={actions.onClose} />
    </>} error={error} recovery={recovery} notice={notice}>
    {load.type === "loading" ? <LoadingLines label="Reading the trigger…" /> : null}
    {load.type === "ready" ? <div ref={body}>
      {fresh ? <Lede>A trigger starts a saved workflow at a set time, in a new session of the project. You review each run in its session.</Lede> : null}
      {trigger ? <TriggerAttention trigger={trigger} clock={clock} errorLines={plan.errorLines} onAcknowledge={actions.onAcknowledge}
        onRunNow={actions.onRunNow} onOpenSession={actions.onOpenSession} /> : null}
      <TitleField label="Trigger name" placeholder="Name the trigger" value={draft.name} maxLength={120} disabled={saving} autoFocus={focusName}
        problem={showing ? problems.name : undefined} onChange={(name) => actions.onDraft({ ...draft, name })} />
      {trigger ? <TriggerStatus trigger={trigger} clock={clock} starting={starting} creatorName={creatorName}
        onPause={actions.onPause} onResume={actions.onResume} onOpenSession={actions.onOpenSession} /> : null}
      <TriggerForm draft={draft} onDraft={actions.onDraft} problems={showing ? problems : {}} disabled={saving} hostZone={clock.hostZone}
        timezones={timezones} projectLabel={projectLabel} projects={projects} workflows={workflows} listModels={listModels} locale={clock.locale} />
      {trigger ? <TriggerRuns trigger={trigger} clock={clock} starting={starting} onOpenSession={actions.onOpenSession} /> : null}
    </div> : null}
  </SettingsFrame>;
}
