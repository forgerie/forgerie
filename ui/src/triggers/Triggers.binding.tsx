import { useCallback, useEffect, useRef, useState } from "react";
import type { Trigger, TriggerTargets, TriggerWorkflow } from "@shared/triggers";
import { writeClipboardText } from "../clipboard";
import { destinationLabel, type Project } from "../newSession";
import type { SessionModel } from "../contracts";
import { runRefusedBeforeAdmission, TriggerRefusal, type TriggersApi } from "./triggersApi";
import { listOf, type TriggerPlace, type TriggersScreenArgs } from "./triggersModel";
import type { TriggerList as TriggerListState } from "./useTriggerList";
import { createOf, draftOf, draftProblems, emptyDraft, fieldOf, isDirty, updateOf, type DraftProblems, type TriggerDraft } from "./triggerDraft";
import { runRecorded, whenLong, type WordClock } from "./triggerWords";
import { draftKey, type TriggerMemory } from "./triggerMemory";
import { TriggersView, type TriggerNote, type TriggerScreen } from "./TriggersView";
import type { RunScope, TriggerQuestion } from "./TriggerDialog";
import type { TriggerPageLoad, TriggerSave } from "./TriggerPage";
import type { ProjectsLoad, WorkflowsLoad } from "./TriggerForm";
import { fixedCwds, hasTargets, isSpread, targetsKey, workflowGap } from "./triggerTargets";
import { dayTimeWords, fileOf, saveRequestOf, scheduleDraftOf, settingsChanged, type ScheduleDraft } from "./triggerFile";
import type { TriggerFileSave } from "./TriggerFilePage";
import { useTriggerFile } from "./useTriggerFile";
import { markdownView } from "../ui/markdownView";
import type { MarkdownView } from "../ui/useMarkdownView";

/** Registered projects and models, as the new-session dialog reads them. */
export interface TriggerDirectory {
  projects: (signal?: AbortSignal) => Promise<Project[]>;
  models: (cwd: string, signal?: AbortSignal) => Promise<{ models: SessionModel[] }>;
}

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
const browserZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "UTC"; } };
/** One request ID per Run now dialog, sent again unchanged if the answer is lost. */
const newRequestId = () => [...crypto.getRandomValues(new Uint8Array(12))].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * Binding: the triggers screen. The list comes from the app's binding, which
 * holds it so the session list's entry stays true. This reads one trigger in
 * full, the registered projects, the workflows the target projects share, and
 * the models; it keeps drafts and the one question the screen asks, and it
 * sends every write.
 */
export function TriggersScreen({ args, list, api, directory, memory, now: clockNow = Date.now, zone = browserZone(), locale, requestId = newRequestId }: {
  args: TriggersScreenArgs;
  list: TriggerListState;
  api: TriggersApi;
  directory: TriggerDirectory;
  /** Drafts and pending runs, kept by the caller so they outlive the screen. */
  memory: TriggerMemory;
  /** The clock; fixed by a preview. */
  now?: () => number;
  /** The browser's zone; fixed by a preview. */
  zone?: string;
  locale?: string | undefined;
  requestId?: () => string;
}) {
  const { place, onPlace, onOpenSession, sessionName } = args;
  const { drafts, pendingRuns } = memory;
  const [, redraw] = useState(0);
  const touch = useCallback(() => redraw((count) => count + 1), []);
  const [now, setNow] = useState(clockNow);
  useEffect(() => {
    const timer = setInterval(() => setNow(clockNow()), 60_000);
    return () => clearInterval(timer);
  }, [clockNow]);
  const value = listOf(list.load);
  const clock: WordClock = { now, locale, browserZone: zone, hostZone: value?.timezone ?? zone };
  const refresh = list.refresh;

  const [projectsLoad, setProjectsLoad] = useState<ProjectsLoad>({ type: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    directory.projects(controller.signal).then((projects) => { if (!controller.signal.aborted) setProjectsLoad({ type: "ready", projects }); },
      (error: unknown) => { if (!controller.signal.aborted) setProjectsLoad({ type: "failed", message: messageOf(error) }); });
    return () => controller.abort();
  }, [directory]);
  const projects: readonly Project[] = projectsLoad.type === "ready" ? projectsLoad.projects : [];
  const projectLabel = useCallback((cwd: string) => destinationLabel(cwd, projects), [projects]);

  // One trigger in full: up to 50 runs. The list's copy shows at once and the full read replaces it.
  const triggerId = place.view === "trigger" ? place.id : undefined;
  const [detail, setDetail] = useState<{ id: string; load: TriggerPageLoad }>();
  const readDetail = useCallback((id: string, signal?: AbortSignal) => {
    api.get(id, signal).then((trigger) => { if (!signal?.aborted) setDetail({ id, load: { type: "ready", trigger } }); },
      (error: unknown) => {
        if (signal?.aborted) return;
        setDetail((previous) => {
          // A reread that fails keeps the trigger on the page; only a first read shows the failure.
          if (previous?.id === id && previous.load.type === "ready" && !(error instanceof TriggerRefusal && error.status === 404)) return previous;
          return { id, load: error instanceof TriggerRefusal && error.status === 404 ? { type: "missing" } : { type: "failed", message: messageOf(error) } };
        });
      });
  }, [api]);
  useEffect(() => {
    if (!triggerId) return;
    const controller = new AbortController();
    readDetail(triggerId, controller.signal);
    return () => controller.abort();
    // The list changes on every `triggers.changed`; the page reads its trigger again then.
  }, [triggerId, readDetail, list.load]);
  const listed = triggerId ? value?.triggers.find((trigger) => trigger.id === triggerId) : undefined;
  const fromDetail = detail && detail.id === triggerId ? detail.load : undefined;
  const pageLoad: TriggerPageLoad = place.view === "create" ? { type: "ready" }
    : fromDetail?.type === "ready" || fromDetail?.type === "missing" ? fromDetail
    : listed ? { type: "ready", trigger: listed } : fromDetail ?? { type: "loading" };
  const trigger = pageLoad.type === "ready" ? pageLoad.trigger : undefined;

  // A trigger whose settings live in a workflow file is that file's page. One the server reports without a file keeps the form.
  const fileState = place.view === "trigger" && trigger ? fileOf(trigger) : undefined;
  const fileId = fileState && trigger ? trigger.id : undefined;
  const files = useTriggerFile(api, fileId, list.load);
  const fileDocument = files.file.type === "ready" ? files.file.document : undefined;
  const storedFile = fileId ? memory.files.get(fileId) : undefined;
  const fileStart: ScheduleDraft | undefined = trigger && fileId ? storedFile?.start ?? scheduleDraftOf(trigger, fileDocument, value?.timezone ?? zone) : undefined;
  const fileSettings = storedFile?.settings ?? fileStart;
  const fileText = storedFile?.text ?? fileDocument?.text ?? "";
  const textDirty = fileDocument !== undefined && storedFile !== undefined && storedFile.text !== fileDocument.text;
  const settingsDirty = fileSettings !== undefined && fileStart !== undefined && settingsChanged(fileSettings, fileStart);
  const fileDirty = textDirty || settingsDirty;
  // Edits made against an older read: the file changed on disk since they began.
  const fileConflict = Boolean(storedFile && fileDocument && storedFile.baseSha256 !== fileDocument.sha256);
  const [restores, setRestores] = useState(0);
  // Rich or Source: the device's choice for every Markdown file, as in Skills and prompts.
  const [fileView, setFileView] = useState<MarkdownView>(() => markdownView.read());
  const [fileSave, setFileSave] = useState<{ id: string; state: TriggerFileSave }>();

  // Run now: starting until the history carries the request.
  for (const [id, pending] of pendingRuns) {
    const known = (trigger?.id === id ? trigger : undefined) ?? value?.triggers.find((item) => item.id === id);
    if (known && runRecorded(known, pending)) pendingRuns.delete(id);
  }
  const starting = new Set(pendingRuns.keys());

  // The draft: stored while it differs from its start, else the trigger as saved.
  const key = place.view === "list" ? "" : draftKey(place);
  const stored = drafts.get(key);
  const host = value?.timezone;
  const start = trigger ? draftOf(trigger) : emptyDraft(host ?? zone);
  const raw = stored?.draft ?? start;
  // Until the reader picks a zone, a new trigger follows the host's zone once the list says what it is.
  const draft = !trigger && !raw.zoneChosen && host && raw.timezone !== host ? { ...raw, timezone: host } : raw;
  const dirty = fileId ? fileDirty : place.view === "create" ? isDirty(draft, emptyDraft(draft.timezone)) : trigger ? isDirty(draft, start) : false;
  // A change elsewhere to what this form edits is a conflict. A pause, a mark as seen, or a recorded run also raises
  // the revision, but it leaves the form's fields alone, so the draft moves onto the newer revision without a word.
  // A refused save stays a conflict until the newer trigger has been read.
  const conflict = Boolean(trigger && stored && (isDirty(stored.start, start) || (stored.refused && trigger.revision <= stored.revision)));
  // A second Save (a double press, a held Ctrl+S) while one is in flight sends nothing: a create carries no ID, so
  // two requests would make two triggers. The ref answers at once; the save state reaches the page a render later.
  const inFlight = useRef(false);
  const setDraft = (next: TriggerDraft) => {
    // While a save is in flight the draft is what is being saved, and success drops it, so a change now would be lost.
    // The form locks its controls and its pickers close; this refuses whatever still reaches here.
    if (inFlight.current) return;
    const base = stored?.start ?? start;
    if (trigger ? isDirty(next, base) : isDirty(next, emptyDraft(next.timezone))) {
      drafts.set(key, { draft: next, start: base, revision: stored?.revision ?? trigger?.revision ?? 0, refused: stored?.refused ?? false });
    }
    else drafts.delete(key);
    touch();
  };
  const dropDraft = (id = key) => { drafts.delete(id); touch(); };

  // The workflows every target project shares, read again for each new selection. One read per selection, kept, so
  // checking a project and unchecking it again does not wait. All projects reads the projects registered now.
  const [workflowLoads, setWorkflowLoads] = useState<Record<string, WorkflowsLoad>>({});
  const targeted = place.view !== "list" && hasTargets(draft.targets);
  const selection = targeted ? targetsKey(draft.targets) : "";
  useEffect(() => {
    if (!selection) return;
    const targets: TriggerTargets = selection === "all" ? { kind: "all" } : { kind: "projects", cwds: selection.split("\n") };
    const controller = new AbortController();
    setWorkflowLoads((current) => current[selection]?.type === "ready" ? current : { ...current, [selection]: { type: "loading" } });
    api.commonWorkflows(targets, controller.signal).then((result) => setWorkflowLoads((current) => ({ ...current, [selection]: { type: "ready", ...result } })),
      (error: unknown) => { if (!controller.signal.aborted) setWorkflowLoads((current) => ({ ...current, [selection]: { type: "failed", message: messageOf(error) } })); });
    return () => controller.abort();
  }, [api, selection]);
  const workflows: WorkflowsLoad = selection ? workflowLoads[selection] ?? { type: "loading" } : { type: "ready", workflows: [], diagnostics: [] };
  const workflow: TriggerWorkflow | undefined = workflows.type === "ready" ? workflows.workflows.find((item) => item.name === draft.workflow) : undefined;
  const gap = workflows.type === "ready" && targeted ? workflowGap(draft.workflow, workflows, projectLabel) : undefined;

  const [save, setSave] = useState<{ key: string; state: TriggerSave }>({ key, state: { type: "idle" } });
  const saveState = save.key === key ? save.state : { type: "idle" as const };
  const problems: DraftProblems = { ...draftProblems(draft, workflow, gap) };
  const refusedField = save.key === key && save.state.type === "refused" ? save.state.field : undefined;
  if (refusedField && save.state.type === "refused") problems[refusedField] ??= save.state.message;

  const [failure, setFailure] = useState<string>();
  const [question, setQuestion] = useState<TriggerQuestion>();
  const runRequest = useRef<string | undefined>(undefined);
  const leave = useRef<(() => void) | undefined>(undefined);
  const [note, setNote] = useState<TriggerNote>();
  const [focusName, setFocusName] = useState(false);
  useEffect(() => { setFailure(undefined); }, [place.view, triggerId]);

  // A reload with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const go = (next: TriggerPlace | undefined, options?: { replace?: boolean }) => { setFocusName(false); onPlace(next, options); };
  const guarded = (action: () => void) => {
    if (place.view !== "list" && dirty) { leave.current = action; setQuestion({ kind: "leave", name: draft.name.trim() || trigger?.name || "the new trigger" }); return; }
    action();
  };
  const command = async (target: Trigger, verb: string, run: (id: string) => Promise<Trigger>) => {
    setFailure(undefined);
    try {
      const next = await run(target.id);
      if (next.id === triggerId) setDetail({ id: next.id, load: { type: "ready", trigger: next } });
      refresh();
    } catch (error) { setFailure(`Could not ${verb} “${target.name}”: ${messageOf(error)}`); }
  };
  const actions = {
    onAcknowledge: (target: Trigger) => void command(target, "mark as seen", api.acknowledge),
    onPause: (target: Trigger) => void command(target, "pause", api.pause),
    onResume: (target: Trigger) => void command(target, "resume", api.resume),
    onRunNow: (target: Trigger) => {
      runRequest.current = requestId();
      // One run can be limited to a fixed target, or under All projects to any registered project.
      const choices = target.action.targets.kind === "all" ? projects.map((project) => project.path) : fixedCwds(target.action.targets);
      setQuestion({ kind: "run", trigger: target, busy: false, scope: { kind: "all" }, choices });
    },
    onDelete: (target: Trigger) => setQuestion({ kind: "delete", trigger: target, busy: false }),
  };

  async function confirm() {
    if (!question) return;
    if (question.kind === "leave") {
      const action = leave.current; leave.current = undefined;
      if (fileId) memory.files.delete(fileId);
      dropDraft(); setQuestion(undefined); action?.(); return;
    }
    const target = question.trigger;
    setQuestion({ ...question, busy: true, error: undefined });
    if (question.kind === "run") {
      const id = runRequest.current ?? requestId();
      runRequest.current = id;
      // `cwd` goes only when the reader limited this run to one project of several.
      const only = isSpread(target.action.targets) && question.scope.kind === "one" ? question.scope.cwd : undefined;
      setQuestion({ ...question, busy: true, error: undefined, sent: true });
      try {
        // The history entry carries the ID the answer returns, not one built from `id`.
        const answer = await api.run(target.id, id, only);
        pendingRuns.set(target.id, { triggerId: target.id, recordedId: answer.requestId });
        runRequest.current = undefined;
        setQuestion(undefined);
        setNote({ text: only ? `“${target.name}” is starting in ${projectLabel(only)}. Its session shows under Runs once it opens.`
          : isSpread(target.action.targets) ? `“${target.name}” is starting in each target project. Its sessions show under Runs once they open.`
          : `“${target.name}” is starting. Its session shows under Runs once it opens.` });
        refresh();
        if (target.id === triggerId) readDetail(target.id);
      } catch (error) {
        // The same request ID goes with the next press, so a lost answer never starts a second run. The server keeps the
        // first accepted request's projects, so once a request may have reached it the choice is locked to match, and
        // stays locked: a later refusal for the same ID proves nothing about the earlier one. Only a known
        // pre-admission refusal, with no earlier ambiguous attempt, leaves the choice open.
        const reachedBefore = question.sent === true;
        setQuestion({ ...question, busy: false, sent: reachedBefore || !runRefusedBeforeAdmission(error), error: error instanceof TriggerRefusal ? error.message
          : `${messageOf(error)}. Press Run now to send the same request again; it starts at most one run.` });
      }
      return;
    }
    try {
      await api.remove(target.id);
      drafts.delete(draftKey({ view: "trigger", id: target.id }));
      pendingRuns.delete(target.id);
      setQuestion(undefined);
      setNote({ text: `Deleted “${target.name}”.` });
      refresh();
      if (target.id === triggerId) go({ view: "list" }, { replace: true });
    } catch (error) { setQuestion({ ...question, busy: false, error: messageOf(error) }); }
  }

  async function submit() {
    // Create only from the create page, and update only a trigger read in full. A trigger that went missing or
    // cannot be read has nothing to save onto, so its leftover draft never becomes a new trigger.
    const updating = place.view === "trigger" && pageLoad.type === "ready" ? trigger : undefined;
    if (inFlight.current || (place.view !== "create" && !updating)) return;
    inFlight.current = true;
    setSave({ key, state: { type: "saving" } });
    try {
      if (!updating) {
        const created = await api.create(createOf(draft, workflow));
        drafts.delete(draftKey({ view: "create" }));
        setSave({ key: draftKey({ view: "trigger", id: created.id }), state: { type: "idle" } });
        setDetail({ id: created.id, load: { type: "ready", trigger: created } });
        const next = created.state.kind === "active" ? ` Next run ${whenLong(created.state.nextFireAt, created.schedule.timezone, clock)}.` : "";
        setNote({ text: `Created “${created.name}”.${next}` });
        refresh();
        go({ view: "trigger", id: created.id }, { replace: true });
        return;
      }
      // Against the revision the draft started from while another change to its fields is unseen, so the server says so.
      const base = conflict && stored ? stored.revision : updating.revision;
      const updated = await api.update(updating.id, updateOf(updating, draft, workflow, base));
      drafts.delete(key);
      setDetail({ id: updated.id, load: { type: "ready", trigger: updated } });
      setSave({ key, state: { type: "saved" } });
      refresh();
    } catch (error) {
      if (error instanceof TriggerRefusal && error.status === 409 && updating) {
        // Someone else changed it first. The draft stays until the reader reloads.
        drafts.set(key, { draft, start: stored?.start ?? start, revision: updating.revision, refused: true });
        setSave({ key, state: { type: "idle" } });
        readDetail(updating.id);
        return;
      }
      const refusal = error instanceof TriggerRefusal ? error : undefined;
      setSave({ key, state: { type: "refused", message: messageOf(error), off: refusal?.status === 503, field: fieldOf(refusal?.field) } });
    } finally { inFlight.current = false; }
  }

  // The file's edits: kept while they differ from the file as read, against the hash they began from.
  const setFile = (change: { text?: string; settings?: ScheduleDraft }) => {
    if (!fileId || !fileDocument || !fileStart || !fileSettings || inFlight.current) return;
    const next = { text: change.text ?? fileText, settings: change.settings ?? fileSettings };
    if (next.text === fileDocument.text && !settingsChanged(next.settings, fileStart)) memory.files.delete(fileId);
    else memory.files.set(fileId, { ...next, start: fileStart, baseSha256: storedFile?.baseSha256 ?? fileDocument.sha256 });
    setFileSave(undefined);
    touch();
  };
  const dropFile = () => { if (fileId) memory.files.delete(fileId); setFileSave(undefined); touch(); };
  async function saveFile() {
    if (!fileId || !trigger || !fileDocument || !fileStart || !fileSettings || inFlight.current || !fileDirty) return;
    inFlight.current = true;
    const id = fileId;
    const text = fileText;
    setFileSave({ id, state: { type: "saving" } });
    try {
      const answer = await api.saveFile(id, saveRequestOf({ trigger, document: fileDocument, start: fileStart, draft: fileSettings, projects, text,
        baseSha256: storedFile?.baseSha256 ?? fileDocument.sha256 }));
      memory.files.delete(id);
      files.saved(id, answer.document);
      setDetail({ id, load: { type: "ready", trigger: answer.trigger } });
      setFileSave({ id, state: { type: "saved" } });
      refresh();
    } catch (error) {
      const refusal = error instanceof TriggerRefusal ? error : undefined;
      if (refusal?.status === 409) {
        // The file changed on disk first. The edits stay; reading the file again shows the conflict and Reload.
        setFileSave(undefined);
        files.reread();
        return;
      }
      setFileSave({ id, state: { type: "refused", message: messageOf(error), line: refusal?.line, off: refusal?.status === 503 } });
    } finally { inFlight.current = false; touch(); }
  }
  async function restore(versionId: string) {
    if (!fileId || !fileDocument) return;
    const id = fileId;
    try {
      const version = await api.version(id, versionId);
      setFile({ text: version.text });
      setRestores((count) => count + 1);
      setNote({ text: `The version from ${dayTimeWords(version.savedAt, clock)} is in the editor. Save writes it.` });
    } catch (error) { setFailure(`Could not read that version: ${messageOf(error)}`); }
  }

  const sharedRow = {
    onOpen: (target: Trigger) => go({ view: "trigger", id: target.id }),
    onEdit: (target: Trigger) => { onPlace({ view: "trigger", id: target.id }); setFocusName(true); },
    onOpenSession, ...actions,
  };
  const pageCommands = {
    onBack: () => guarded(() => go({ view: "list" })), onClose: () => guarded(() => go(undefined)),
    onRunNow: () => { if (trigger) actions.onRunNow(trigger); },
    onPause: () => { if (trigger) actions.onPause(trigger); },
    onResume: () => { if (trigger) actions.onResume(trigger); },
    onAcknowledge: () => { if (trigger) actions.onAcknowledge(trigger); },
    onDelete: () => { if (trigger) actions.onDelete(trigger); },
    onCopyId: () => {
      if (!trigger) return;
      void writeClipboardText(trigger.id).then((copied) => setNote(copied ? { text: "Trigger ID copied" } : { text: `Could not copy the trigger ID. It is ${trigger.id}.`, tone: "alert" }));
    },
    onOpenSession,
  };
  const creatorName = trigger?.createdBy.kind === "agent" ? sessionName(trigger.createdBy.sessionId) : undefined;
  const fileSaveState = fileSave && fileSave.id === fileId ? fileSave.state : { type: "idle" as const };
  const screen: TriggerScreen = place.view === "list"
    ? { view: "list", list: { load: list.load, clock, projectLabel, starting, failure, onDismissFailure: () => setFailure(undefined),
      onRefresh: refresh, onNew: () => go({ view: "create" }), onClose: () => go(undefined), actions: sharedRow } }
    : trigger && fileId && fileSettings && fileStart ? { view: "file", page: {
      trigger, file: files.file, text: fileText, editorKey: `${fileId}:${fileDocument?.sha256 ?? ""}:${String(restores)}`,
      settings: fileSettings, settingsStart: fileStart, textDirty, settingsDirty, versions: files.versions, save: fileSaveState,
      conflict: fileConflict, failure, clock, starting: starting.has(trigger.id), creatorName, projectName: projectLabel, projects: projectsLoad,
      timezones: value?.timezones ?? [clock.hostZone],
      view: fileView, onView: (next) => { markdownView.write(next); setFileView(next); },
      listModels: async (signal) => {
        const cwd = fixedCwds(fileSettings.targets)[0] ?? projects[0]?.path;
        return cwd ? (await directory.models(cwd, signal)).models : [];
      },
      actions: {
        ...pageCommands,
        onText: (text) => setFile({ text }), onSettings: (settings) => setFile({ settings }),
        onSave: () => void saveFile(), onDiscard: () => { dropFile(); setRestores((count) => count + 1); },
        onRestore: (versionId) => void restore(versionId),
        onReload: () => { dropFile(); setRestores((count) => count + 1); files.reread(); },
      },
    } }
    : { view: "page", page: {
      load: pageLoad, draft, dirty, problems, save: saveState, conflict, failure, clock, focusName,
      starting: trigger ? starting.has(trigger.id) : false,
      creatorName: trigger?.createdBy.kind === "agent" ? sessionName(trigger.createdBy.sessionId) : undefined,
      projectName: projectLabel, projects: projectsLoad,
      workflows, timezones: value?.timezones ?? [clock.hostZone],
      // The model list is read from one project: the first fixed target, or the first registered project under All projects.
      listModels: async (signal) => {
        const cwd = fixedCwds(draft.targets)[0] ?? (draft.targets.kind === "all" ? projects[0]?.path : undefined);
        return cwd ? (await directory.models(cwd, signal)).models : [];
      },
      actions: {
        onDraft: setDraft, onSave: () => void submit(),
        onDiscard: () => { dropDraft(); if (!trigger) go({ view: "list" }); },
        onBack: () => guarded(() => go({ view: "list" })), onClose: () => guarded(() => go(undefined)),
        onRetry: () => { if (triggerId) readDetail(triggerId); },
        onReload: () => { dropDraft(); if (triggerId) readDetail(triggerId); },
        onRunNow: () => { if (trigger) actions.onRunNow(trigger); },
        onPause: () => { if (trigger) actions.onPause(trigger); },
        onResume: () => { if (trigger) actions.onResume(trigger); },
        onAcknowledge: () => { if (trigger) actions.onAcknowledge(trigger); },
        onDelete: () => { if (trigger) actions.onDelete(trigger); },
        onCopyId: () => {
          if (!trigger) return;
          void writeClipboardText(trigger.id).then((copied) => setNote(copied ? { text: "Trigger ID copied" } : { text: `Could not copy the trigger ID. It is ${trigger.id}.`, tone: "alert" }));
        },
        onOpenSession,
      },
    } };
  return <TriggersView screen={screen} question={question} note={note} clock={clock} projectLabel={projectLabel}
    onConfirm={() => void confirm()} onCancel={() => { leave.current = undefined; runRequest.current = undefined; setQuestion(undefined); }}
    onScope={(scope: RunScope) => setQuestion((current) => current?.kind === "run" && !current.sent && !current.busy ? { ...current, scope } : current)}
    onDismissNote={() => setNote(undefined)} />;
}
