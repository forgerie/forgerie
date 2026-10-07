import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AssistantRuntimeProvider, useExternalStoreRuntime, type AppendMessage, type AssistantRuntime, type CompleteAttachment } from "@assistant-ui/react";
import type { Session, SessionModel } from "./contracts";
import { useThreadMessages } from "./useThreadMessages";
import { ForgerieDictationAdapter } from "./speech/ForgerieDictationAdapter";
import { DictationProvider } from "./DictationProvider";
import { createChatDraft } from "./chatDraft";
import type { DraftStore } from "./draftStore";
import { DestinationPicker } from "./ui/DestinationPicker";
import type { ModelBinding } from "./ui/ModelPicker";
import { ImageViewerProvider } from "./ui/ImageViewer";
import { LaunchTray, NewSessionDialog, type StartPhase } from "./ui/NewSessionDialog";
import { createAttachmentAdapter, promptOf, reusableAttachment } from "./attachments";
import { createMentionSource } from "./mentionSource";
import type { CommandCatalog } from "./commands";
import type { Launch, LaunchStore } from "./launches";
import { destinationLabel, keepChoice, thinkingLevelsFor, type AgentChoice, type DeferredFiles, type NewSessionApi, type Project, type PromptResource } from "./newSession";
import { mergeRecord, type WorktreeApi, type WorktreeOptions, type WorktreeRecord } from "./worktrees/worktreeApi";
import { freshLabel } from "./worktrees/worktreeModel";
import { WorktreeSetupCard } from "./ui/WorktreeSetupCard";
import { WorktreeDialog } from "./ui/WorktreeActions";
import { XIcon } from "lucide-react";

/** The draft store key of the first message, which has no session yet. */
export const NEW_SESSION_DRAFT = "new-session";
/** What comes back to the composer when a start fails. */
export interface LaunchDraft { text: string; attachments: readonly CompleteAttachment[] }
export type LaunchMode = "switch" | "rapidfire";
/** A fresh worktree, or the chosen folder itself. Only a Git project offers the choice. */
export type Placement = "fresh" | "existing";
type Options = { cwd: string; value?: WorktreeOptions | undefined };
type Phase = { type: "composing"; error?: string } | { type: "starting"; id: string };
interface Defaults { cwd: string; models: SessionModel[]; model?: SessionModel | undefined; thinkingLevel?: string | undefined }
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * Binding: the new-session dialog. The composer takes the first message, its
 * files, and a skill or prompt template; the tab above it names where the
 * session starts. Send starts the session and opens it, or, in Rapidfire,
 * starts it in the background and clears the bar for the next one. Nothing is
 * retried: a step that may have worked is reported, never repeated.
 */
export function NewSession({ cwd: initialCwd, initialPlacement, initialMode = "switch", api, worktrees, launches, deferred, drafts, onStarted, onDestination, onClose }: {
  cwd: string; initialMode?: LaunchMode; api: NewSessionApi; launches: LaunchStore<LaunchDraft>; drafts?: DraftStore | undefined;
  /** The author's last explicit choice. Absent: a fresh worktree in a Git project. */
  initialPlacement?: Placement | undefined;
  /** Worktree options and failed setups. Absent: every start uses the folder itself, as before worktrees. */
  worktrees?: Pick<WorktreeApi, "options" | "list" | "land" | "discardPreview" | "discard"> | undefined;
  /** Files held until their session exists. App-wide, so "Put back" in a later window still finds them. */
  deferred: DeferredFiles;
  /** The author moved the destination. The URL follows, so a reload comes back here. */
  onDestination?: ((cwd: string, placement?: Placement) => void) | undefined;
  /** Open this session. `unsent` is set when its first message may not have gone out. */
  onStarted: (session: Session, unsent?: { draft: string; error: string }) => void;
  onClose: () => void;
}) {
  const [destination, setDestination] = useState<{ cwd: string; label?: string; placement?: Placement | undefined }>({ cwd: initialCwd, placement: initialPlacement });
  const [options, setOptions] = useState<Options>();
  // Failed setups in this repository, newest first. A reload finds them through the server's inventory.
  const [failedSetups, setFailedSetups] = useState<{ repo: string; records: WorktreeRecord[] }>();
  const [inspected, setInspected] = useState<string>();
  const [discarding, setDiscarding] = useState<WorktreeRecord>();
  const retry = useRef<WorktreeRecord | undefined>(undefined);
  const [projects, setProjects] = useState<Project[]>([]);
  const [choice, setChoice] = useState<AgentChoice>({});
  const [defaults, setDefaults] = useState<Defaults>();
  const [resources, setResources] = useState<{ cwd: string; catalog: CommandCatalog; commands: PromptResource[] }>();
  const [resourceAttempt, setResourceAttempt] = useState(0);
  const [phase, setPhase] = useState<Phase>({ type: "composing" });
  const [mode, setMode] = useState<LaunchMode>(initialMode);
  const [dictation] = useState(() => new ForgerieDictationAdapter());
  const [attachments] = useState(() => createAttachmentAdapter(deferred.save));
  const runtimeRef = useRef<AssistantRuntime | null>(null);
  const [saved] = useState(() => drafts?.session(NEW_SESSION_DRAFT));
  const [chatDraft] = useState(() => createChatDraft(() => runtimeRef.current?.thread.composer, saved));
  const started = useSyncExternalStore(launches.subscribe, launches.getSnapshot);
  // Is the folder in a Git project? Until the server says, the start leaves the choice to it, which is the same default.
  useEffect(() => {
    if (!worktrees) return;
    const controller = new AbortController();
    worktrees.options(destination.cwd, controller.signal).then((value) => { if (!controller.signal.aborted) setOptions({ cwd: destination.cwd, value }); },
      () => { if (!controller.signal.aborted) setOptions({ cwd: destination.cwd }); });
    return () => controller.abort();
  }, [worktrees, destination.cwd]);
  const where = options?.cwd === destination.cwd ? options.value : undefined;
  const git = where?.kind === "git" ? where : undefined;
  const fresh = git !== undefined && destination.placement !== "existing";
  // A fresh worktree starts from the default branch, so the main checkout stands in for it: models, skills, and files.
  const cwd = fresh ? git.repo : destination.cwd;
  const repo = git?.repo;
  useEffect(() => {
    if (!worktrees || !repo) return;
    const controller = new AbortController();
    worktrees.list(repo, controller.signal).then((records) => {
      if (controller.signal.aborted) return;
      setFailedSetups({ repo, records: records.filter((record) => record.setup.phase === "failed" && !record.sessionId && record.state.kind === "active")
        .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")) });
    }, () => { /* The inventory is a convenience; a start still works without it. */ });
    return () => controller.abort();
  }, [worktrees, repo]);
  // A switch-mode start can outlive this dialog (Back, a reload). Its result must not pull the reader away.
  const alive = useRef(true);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => () => attachments.dispose(), [attachments]);

  useEffect(() => {
    const controller = new AbortController();
    api.projects(controller.signal).then(setProjects, () => { /* The label falls back to the folder name. */ });
    return () => controller.abort();
  }, [api]);
  // Pi's models and defaults depend on the folder. A choice survives a move only where it still exists.
  useEffect(() => {
    const controller = new AbortController();
    api.models(cwd, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setDefaults({ cwd, models: result.models, model: result.model, thinkingLevel: result.thinkingLevel });
      setChoice((current) => keepChoice(current, result.models));
    }, () => { if (!controller.signal.aborted) setDefaults({ cwd, models: [] }); });
    return () => controller.abort();
  }, [api, cwd]);
  // The skills and prompt templates this folder offers as a first message.
  useEffect(() => {
    const controller = new AbortController();
    setResources({ cwd, catalog: { type: "loading" }, commands: [] });
    api.promptResources(cwd, controller.signal).then((commands) => {
      if (!controller.signal.aborted) setResources({ cwd, commands, catalog: { type: "ready",
        commands: commands.map((item) => ({ name: item.name, source: item.source, ...(item.description ? { description: item.description } : {}) })) } });
    }, (error: unknown) => { if (!controller.signal.aborted) setResources({ cwd, commands: [], catalog: { type: "failed", message: messageOf(error) } }); });
    return () => controller.abort();
  }, [api, cwd, resourceAttempt]);

  const known = defaults?.cwd === cwd ? defaults : undefined;
  const model = choice.model ?? known?.model;
  const thinkingLevel = choice.thinkingLevel ?? known?.thinkingLevel;
  const putBack = useCallback(async (draft: LaunchDraft) => {
    const composer = runtimeRef.current?.thread.composer;
    if (!composer) { saved?.saveChat([draft.text, saved.chat()].filter(Boolean).join("\n")); return; }
    composer.setText([draft.text, composer.getState().text].filter(Boolean).join("\n"));
    for (const attachment of draft.attachments) await composer.addAttachment(reusableAttachment(attachment));
  }, [saved]);
  const onNew = useCallback(async (message: AppendMessage) => {
    const typed = message.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n").trim();
    const draft: LaunchDraft = { text: typed, attachments: message.attachments ?? [] };
    const refuse = (error: string) => { setPhase({ type: "composing", error }); void putBack(draft); };
    let prompt: ReturnType<typeof promptOf>;
    try { prompt = promptOf(message); } catch (error) { refuse(messageOf(error)); return; }
    const { text, files } = deferred.split(prompt.text);
    if (text === "" && !prompt.attachments?.length && files.length === 0) return;
    if (text.startsWith("!")) { refuse("Shell commands need a running session. Send a first message, then run the command."); return; }
    let command: PromptResource["identity"] | undefined;
    if (text.startsWith("/")) {
      const name = /^\/(\S+)/u.exec(text)?.[1];
      const listed = resources?.cwd === cwd ? resources : undefined;
      if (!listed || listed.catalog.type === "loading") { refuse("This folder's skills and prompt templates are still loading. Start again in a moment."); return; }
      if (listed.catalog.type === "failed") { refuse(`Skills and prompt templates could not be checked: ${listed.catalog.message} Retry from the / list.`); return; }
      const match = listed.commands.filter((item) => item.name === name);
      if (match.length !== 1) {
        refuse(match.length === 0 ? `/${name ?? ""} is not a skill or prompt template in this folder. Built-in commands need a running session.`
          : `/${name ?? ""} is ambiguous in this folder. Choose it again from the / list.`);
        return;
      }
      command = match[0]!.identity;
    }
    setPhase((current) => current.type === "composing" ? { type: "composing" } : current);
    // Start with exactly what the bar shows. Pi's own default for a create can
    // differ from the default its model list reports for the same folder.
    // A retry sends this message into the worktree whose setup failed, instead of making another.
    const retrying = retry.current;
    retry.current = undefined;
    const placement = retrying ? { destination: { kind: "fresh-worktree" as const }, setupId: retrying.id, worktree: retrying }
      : where ? { destination: { kind: fresh ? "fresh-worktree" as const : "existing-workspace" as const } } : {};
    if (retrying) { setInspected(undefined); setFailedSetups((current) => current && { ...current, records: current.records.filter((item) => item.id !== retrying.id) }); }
    const launch = launches.launch(retrying?.repo ?? cwd, { text, images: prompt.attachments, files, command }, { model, thinkingLevel }, draft, placement);
    if (mode === "rapidfire") return;
    setPhase({ type: "starting", id: launch.id });
    const outcome = await launch.done;
    const failedSetup = launch.worktree();
    // The window closed while it started (Back, the row, a reload): the start stays in the list,
    // so the app's notice says how it went and "Put back" still has its files. A success needs nothing.
    if (!alive.current) { if (outcome.type === "started") launches.take(launch.id); return; }
    launches.take(launch.id);
    if (outcome.type === "started") { onStarted(outcome.session); return; }
    if (outcome.type === "unsent") { onStarted(outcome.session, { draft: typed, error: outcome.error }); return; }
    // A failed setup keeps its card, with its log and what to do next, instead of a line of text.
    if (failedSetup?.setup.phase === "failed") {
      setFailedSetups((current) => ({ repo: failedSetup.repo, records: [failedSetup, ...(current?.repo === failedSetup.repo ? current.records.filter((item) => item.id !== failedSetup.id) : [])] }));
      setInspected(failedSetup.id);
      setPhase({ type: "composing" });
      void putBack(draft);
      return;
    }
    refuse(outcome.error);
  }, [deferred, resources, cwd, launches, model, thinkingLevel, mode, onStarted, putBack, saved, where, fresh]);

  const starting = phase.type === "starting";
  const runtime = useExternalStoreRuntime({
    messages: useThreadMessages([], false), onNew, adapters: { dictation, attachments },
    isRunning: false, isDisabled: starting, isSendDisabled: defaults?.cwd !== cwd,
  });
  useEffect(() => { runtimeRef.current = runtime; return () => { runtimeRef.current = null; }; }, [runtime]);
  useEffect(() => {
    if (!saved) return;
    chatDraft.hydrate(saved.chat());
    return runtime.thread.composer.subscribe(chatDraft.sync);
  }, [runtime, chatDraft, saved]);

  const modelBinding: ModelBinding = useMemo(() => ({
    model, thinkingLevel, disabled: starting,
    listModels: async () => known?.models ?? (await api.models(cwd)).models,
    listThinkingLevels: async () => thinkingLevelsFor(model),
    onModel: async (provider, id) => {
      const picked = known?.models.find((item) => item.provider === provider && item.id === id) ?? { provider, id };
      setChoice((current) => ({ ...current, model: picked, ...(picked.reasoning === false ? { thinkingLevel: "off" } : {}) }));
    },
    onThinkingLevel: async (level) => { setChoice((current) => ({ ...current, thinkingLevel: level })); },
  }), [model, thinkingLevel, starting, known, api, cwd]);
  const mentions = useMemo(() => createMentionSource({ id: NEW_SESSION_DRAFT, cwd }, (path, init) => fetch(path, init),
    `/api/models?${new URLSearchParams({ cwd })}`), [cwd]);
  const label = fresh ? freshLabel(destinationLabel(git.repo, projects), git) : destination.label ?? destinationLabel(cwd, projects);
  const current = phase.type === "starting" ? started.find((item) => item.id === phase.id) : undefined;
  const progress = current?.state;
  const view: StartPhase = phase.type === "starting"
    ? { type: "starting", progress: (progress?.type === "starting" ? progress.progress : undefined) ?? "Starting session…" }
    : phase.error ? { type: "failed", message: phase.error } : { type: "ready" };
  // What the card shows: the setup of the start in progress, or a failed setup the reader is looking at.
  const failedList = failedSetups && failedSetups.repo === repo ? failedSetups.records : [];
  const shown = phase.type === "starting" ? current?.worktree && { record: current.worktree, hookSeen: current.hookSeen === true }
    : inspected ? (() => { const record = failedList.find((item) => item.id === inspected); return record && { record, hookSeen: record.setup.log !== "" }; })() : undefined;
  const setupCard = shown ? <WorktreeSetupCard setup={shown.record.setup} hookSeen={shown.hookSeen} branch={shown.record.branch}
    actions={shown.record.setup.phase === "failed" && phase.type !== "starting" ? <>
      <button type="button" className="wt-secondary" onClick={() => setDiscarding(shown.record)}>Discard worktree…</button>
      <button type="button" className="primary wt-primary" onClick={() => { retry.current = shown.record; void runtimeRef.current?.thread.composer.send(); }}
        title="Run the setup again in the same worktree, then start the session with the message above">Retry setup</button>
      <button type="button" className="icon-button quiet-button wt-dismiss" aria-label="Hide this setup" onClick={() => setInspected(undefined)}>
        <XIcon aria-hidden size={16} /></button>
    </> : undefined} /> : undefined;
  const open = (launch: Launch<LaunchDraft>) => {
    const { state } = launch;
    if (state.type !== "started" && state.type !== "unsent") return;
    launches.take(launch.id);
    onStarted(state.session, state.type === "unsent" ? { draft: launch.draft.text, error: state.error } : undefined);
  };
  // Clears the bar and its files. The saved draft follows the bar, so it clears too.
  const discard = () => { setPhase({ type: "composing" }); void runtimeRef.current?.thread.composer.reset(); };

  return <AssistantRuntimeProvider runtime={runtime}>
    <DictationProvider adapter={dictation}>
      <ImageViewerProvider>
        <NewSessionDialog phase={view} rapidfire={mode === "rapidfire"} onRapidfire={() => setMode(mode === "rapidfire" ? "switch" : "rapidfire")}
          onDiscard={discard} onClose={onClose} model={modelBinding} mentions={mentions}
          commands={{ catalog: resources?.cwd === cwd ? resources.catalog : { type: "loading" }, onRetry: () => setResourceAttempt((n) => n + 1) }}
          setup={setupCard}
          destination={<DestinationPicker binding={{
            cwd: destination.cwd, label, disabled: starting, placement: worktrees ? (fresh ? "fresh" : "existing") : undefined,
            listProjects: (signal) => api.projects(signal),
            listWorkspaces: (projectId, signal) => api.workspaces(projectId, signal),
            ...(worktrees ? { worktreeOptions: (path: string, signal: AbortSignal) => worktrees.options(path, signal) } : {}),
            onChoose: (next, nextLabel, placement) => {
              setDestination({ cwd: next, ...(placement === "fresh" ? {} : { label: nextLabel }), placement });
              setInspected(undefined);
              if (placement) onDestination?.(next, placement); else onDestination?.(next);
            },
          }} />}
          tray={<LaunchTray launches={started.filter((launch) => phase.type !== "starting" || launch.id !== phase.id)} onOpen={open}
            onRestore={(launch) => { const taken = launches.take(launch.id); if (taken) void putBack(taken.draft); }}
            onInspect={(launch) => {
              const record = launch.worktree;
              if (!record) return;
              const taken = launches.take(launch.id);
              setFailedSetups((list) => ({ repo: record.repo, records: [record, ...(list?.repo === record.repo ? list.records.filter((item) => item.id !== record.id) : [])] }));
              setInspected(record.id);
              if (taken) void putBack(taken.draft);
            }}
            failedSetups={failedList.filter((record) => record.id !== inspected && !started.some((launch) => launch.worktree?.id === record.id))}
            onInspectSetup={(record) => setInspected(record.id)}
            onDismiss={(launch) => launches.dismiss(launch.id)} />} />
        {discarding && worktrees && <WorktreeDialog command="discard" info={mergeRecord(undefined, discarding)} api={worktrees}
          onDone={(result) => {
            if (result.kind !== "discarded") return;
            setFailedSetups((list) => list && { ...list, records: list.records.filter((item) => item.id !== discarding.id) });
            setInspected(undefined);
          }}
          onClose={() => setDiscarding(undefined)} />}
      </ImageViewerProvider>
    </DictationProvider>
  </AssistantRuntimeProvider>;
}
