import { useCallback, useEffect, useRef, useState } from "react";
import type { Trigger, TriggerWorkflow } from "@shared/triggers";
import { writeClipboardText } from "../clipboard";
import { destinationLabel, type Project, type Workspace } from "../newSession";
import type { SessionModel } from "../contracts";
import { TriggerRefusal, type TriggersApi } from "./triggersApi";
import { listOf, type TriggerPlace, type TriggersScreenArgs } from "./triggersModel";
import type { TriggerList as TriggerListState } from "./useTriggerList";
import { createOf, draftOf, draftProblems, emptyDraft, fieldOf, isDirty, updateOf, type DraftProblems, type TriggerDraft } from "./triggerDraft";
import { runRecorded, whenLong, type WordClock } from "./triggerWords";
import { draftKey, type TriggerMemory } from "./triggerMemory";
import { TriggersView, type TriggerNote, type TriggerScreen } from "./TriggersView";
import type { TriggerQuestion } from "./TriggerDialog";
import type { TriggerPageLoad, TriggerSave } from "./TriggerPage";
import type { WorkflowsLoad } from "./TriggerForm";

/** Folders, workspaces, and models, as the new-session dialog reads them. */
export interface TriggerDirectory {
  projects: (signal?: AbortSignal) => Promise<Project[]>;
  workspaces: (projectId: string, signal?: AbortSignal) => Promise<Workspace[]>;
  models: (cwd: string, signal?: AbortSignal) => Promise<{ models: SessionModel[] }>;
}

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
const browserZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "UTC"; } };
/** One request ID per Run now dialog, sent again unchanged if the answer is lost. */
const newRequestId = () => [...crypto.getRandomValues(new Uint8Array(12))].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * Binding: the triggers screen. The list comes from the app's binding, which
 * holds it so the session list's entry stays true. This reads one trigger in
 * full, the project's workflows, and the models; it keeps drafts and the one
 * question the screen asks, and it sends every write.
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

  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    directory.projects(controller.signal).then(setProjects, () => undefined);
    return () => controller.abort();
  }, [directory]);
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
  const dirty = place.view === "create" ? isDirty(draft, emptyDraft(draft.timezone)) : trigger ? isDirty(draft, start) : false;
  // A change elsewhere to what this form edits is a conflict. A pause, a mark as seen, or a recorded run also raises
  // the revision, but it leaves the form's fields alone, so the draft moves onto the newer revision without a word.
  // A refused save stays a conflict until the newer trigger has been read.
  const conflict = Boolean(trigger && stored && (isDirty(stored.start, start) || (stored.refused && trigger.revision <= stored.revision)));
  const setDraft = (next: TriggerDraft) => {
    const base = stored?.start ?? start;
    if (trigger ? isDirty(next, base) : isDirty(next, emptyDraft(next.timezone))) {
      drafts.set(key, { draft: next, start: base, revision: stored?.revision ?? trigger?.revision ?? 0, refused: stored?.refused ?? false });
    }
    else drafts.delete(key);
    touch();
  };
  const dropDraft = (id = key) => { drafts.delete(id); touch(); };

  // The chosen project's workflows.
  const [workflowLoads, setWorkflowLoads] = useState<Record<string, WorkflowsLoad>>({});
  const cwd = place.view === "list" ? "" : draft.cwd;
  useEffect(() => {
    if (!cwd) return;
    const controller = new AbortController();
    setWorkflowLoads((current) => current[cwd]?.type === "ready" ? current : { ...current, [cwd]: { type: "loading" } });
    api.workflows(cwd, controller.signal).then((result) => setWorkflowLoads((current) => ({ ...current, [cwd]: { type: "ready", workflows: result.workflows } })),
      (error: unknown) => { if (!controller.signal.aborted) setWorkflowLoads((current) => ({ ...current, [cwd]: { type: "failed", message: messageOf(error) } })); });
    return () => controller.abort();
  }, [api, cwd]);
  const workflows: WorkflowsLoad = cwd ? workflowLoads[cwd] ?? { type: "loading" } : { type: "ready", workflows: [] };
  const workflow: TriggerWorkflow | undefined = workflows.type === "ready" ? workflows.workflows.find((item) => item.name === draft.workflow) : undefined;

  const [save, setSave] = useState<{ key: string; state: TriggerSave; field?: string | undefined }>({ key, state: { type: "idle" } });
  const saveState = save.key === key ? save.state : { type: "idle" as const };
  const problems: DraftProblems = { ...draftProblems(draft, workflow) };
  const refusedField = save.key === key && save.state.type === "refused" ? fieldOf(save.field) : undefined;
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
    onRunNow: (target: Trigger) => { runRequest.current = requestId(); setQuestion({ kind: "run", trigger: target, busy: false }); },
    onDelete: (target: Trigger) => setQuestion({ kind: "delete", trigger: target, busy: false }),
  };

  async function confirm() {
    if (!question) return;
    if (question.kind === "leave") { const action = leave.current; leave.current = undefined; dropDraft(); setQuestion(undefined); action?.(); return; }
    const target = question.trigger;
    setQuestion({ ...question, busy: true, error: undefined });
    if (question.kind === "run") {
      const id = runRequest.current ?? requestId();
      runRequest.current = id;
      try {
        await api.run(target.id, id);
        pendingRuns.set(target.id, { triggerId: target.id, requestId: id });
        runRequest.current = undefined;
        setQuestion(undefined);
        setNote({ text: `“${target.name}” is starting. Its session shows under Runs once it opens.` });
        refresh();
        if (target.id === triggerId) readDetail(target.id);
      } catch (error) {
        // The same request ID goes with the next press, so a lost answer never starts a second run.
        setQuestion({ ...question, busy: false, error: error instanceof TriggerRefusal ? error.message
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

  // A second Save (a double press, a held Ctrl+S) while one is in flight sends nothing: a create carries no ID, so
  // two requests would make two triggers. The ref answers at once; the save state reaches the page a render later.
  const inFlight = useRef(false);
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
      setSave({ key, state: { type: "refused", message: messageOf(error), off: refusal?.status === 503 }, field: refusal?.field });
    } finally { inFlight.current = false; }
  }

  const sharedRow = {
    onOpen: (target: Trigger) => go({ view: "trigger", id: target.id }),
    onEdit: (target: Trigger) => { onPlace({ view: "trigger", id: target.id }); setFocusName(true); },
    onOpenSession, ...actions,
  };
  const screen: TriggerScreen = place.view === "list"
    ? { view: "list", list: { load: list.load, clock, projectLabel, starting, failure, onDismissFailure: () => setFailure(undefined),
      onRefresh: refresh, onNew: () => go({ view: "create" }), onClose: () => go(undefined), actions: sharedRow } }
    : { view: "page", page: {
      load: pageLoad, draft, dirty, problems, save: saveState, conflict, failure, clock, focusName,
      starting: trigger ? starting.has(trigger.id) : false,
      creatorName: trigger?.createdBy.kind === "agent" ? sessionName(trigger.createdBy.sessionId) : undefined,
      projectLabel: draft.cwd ? projectLabel(draft.cwd) : "Choose a project",
      projects: { list: (signal) => directory.projects(signal), workspaces: (id, signal) => directory.workspaces(id, signal) },
      workflows, timezones: value?.timezones ?? [clock.hostZone],
      listModels: async (signal) => draft.cwd ? (await directory.models(draft.cwd, signal)).models : [],
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
    onDismissNote={() => setNote(undefined)} />;
}
