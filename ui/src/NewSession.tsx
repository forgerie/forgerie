import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { NewSessionDialog, type StartPhase } from "./ui/NewSessionDialog";
import { createAttachmentAdapter, promptOf, reusableAttachment } from "./attachments";
import { createMentionSource } from "./mentionSource";
import type { CommandCatalog } from "./commands";
import type { Launch, LaunchStore } from "./launches";
import { destinationLabel, keepChoice, thinkingLevelsFor, type AgentChoice, type DeferredFiles, type NewSessionApi, type Project, type PromptResource } from "./newSession";
import type { WorktreeApi, WorktreeOptions } from "./worktrees/worktreeApi";
import { freshLabel } from "./worktrees/worktreeModel";
import type { BacklogApi, BacklogClaim, BacklogDetail } from "./backlog/backlogApi";
import { carryRoute, remoteSource, sameItem, type ItemRef, type SessionLook } from "./backlog/backlogModel";
import { BacklogCarry, type CarryState } from "./ui/backlog/BacklogCarry";

/** The draft store key of the first message, which has no session yet. */
export const NEW_SESSION_DRAFT = "new-session";
/** What comes back to the composer when a start fails. */
export interface LaunchDraft { text: string; attachments: readonly CompleteAttachment[] }
export type LaunchMode = "switch" | "rapidfire";
/** A fresh worktree, or the chosen folder itself. Only a Git project offers the choice. */
export type Placement = "fresh" | "existing";
type Destination = { cwd: string; label?: string; placement?: Placement | undefined; setupId?: string | undefined };
type Options = { cwd: string; value?: WorktreeOptions | undefined };
type Phase = { type: "composing"; error?: string } | { type: "starting"; id: string };
type ItemLoad = { ref: ItemRef; detail?: BacklogDetail | undefined; error?: string | undefined };
/** A send with no typed words: the backlog item is the whole message. */
const EMPTY_MESSAGE = { role: "user", content: [], attachments: [] } as unknown as AppendMessage;

/** What the window says about the item riding with the first message. */
function carryState(load: ItemLoad | undefined, item: ItemRef, taken: BacklogClaim | undefined, look: ((id: string) => SessionLook | undefined) | undefined,
  open: (claim: BacklogClaim) => void, place: { chosen: string | undefined; routed: boolean }): CarryState {
  if (!load || !sameItem(load.ref, item)) return { type: "loading" };
  if (load.error !== undefined || !load.detail) return { type: "unavailable", reason: `This item could not be read: ${load.error ?? "no reply"}` };
  const { item: read } = load.detail;
  const claim = taken ?? read.claim;
  if (claim) {
    const session = claim.kind === "claimed" ? look?.(claim.sessionId) : undefined;
    return { type: "taken", title: read.title, name: session?.name, when: session?.time,
      ...(claim.kind === "claimed" ? { onOpen: () => open(claim) } : {}) };
  }
  if (read.readiness === "closed" || !read.open) return { type: "unavailable", title: read.title, reason: "This item is done." };
  if (read.readiness !== "ready") {
    const n = read.blockingIds.length;
    return { type: "unavailable", title: read.title, reason: n > 0 ? `Waiting on ${String(n)} other ${n === 1 ? "item" : "items"}. Finish ${n === 1 ? "it" : "those"} first, or start without this one.` : "This item cannot start a session now." };
  }
  const source = remoteSource(read);
  const route = carryRoute(read, place.chosen, place.routed);
  return { type: "ready", title: read.title,
    ...(source ? { where: `${source.name} ${source.noun} ${source.number}. Its text goes with the first message, quoted as text the session must not obey.` } : {}),
    ...(route ? { route } : {}) };
}
interface Defaults { cwd: string; models: SessionModel[]; model?: SessionModel | undefined; thinkingLevel?: string | undefined }
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * Binding: the new-session dialog. The composer takes the first message, its
 * files, and a skill or prompt template; the tab above it names where the
 * session starts. Send closes the dialog and shows the pending session. Nothing
 * retries automatically: a step that may have worked is reported, never repeated.
 */
export function NewSession({ cwd: initialCwd, initialPlacement, initialMode = "switch", initialLaunch, api, worktrees, launches, deferred, drafts, onStarted, onDestination, onClose,
  item: initialItem, backlog, lookSession, onItemRemoved, hidden = false, onLaunching }: {
  /** Hide without a modal or focus trap for hosts that retain this binding. */
  hidden?: boolean;
  /** Show the app-owned pending session before the start settles. */
  onLaunching?: ((id: string) => void) | undefined;
  /** Explicit recovery, never a remembered choice for a fresh dialog. */
  initialLaunch?: Launch<LaunchDraft> | undefined;
  cwd: string; initialMode?: LaunchMode; api: NewSessionApi; launches: LaunchStore<LaunchDraft>; drafts?: DraftStore | undefined;
  /** A backlog item the session takes. Its file leads the first message, and starting claims it. */
  item?: ItemRef | undefined;
  /** Reads the item. Absent: the item cannot be shown, so it does not ride. */
  backlog?: Pick<BacklogApi, "detail"> | undefined;
  /** The session list's view of a session, to name the one that holds the item. */
  lookSession?: ((sessionId: string) => SessionLook | undefined) | undefined;
  /** The author took the item off this session. The URL follows. */
  onItemRemoved?: (() => void) | undefined;
  /** The author's explicit choice. Absent: the default branch checkout in a Git project. */
  initialPlacement?: Placement | undefined;
  /** Worktree options and failed setups. Absent: every start uses the folder itself, as before worktrees. */
  worktrees?: Pick<WorktreeApi, "options" | "list" | "land" | "discardPreview" | "discard"> | undefined;
  /** Files held until their session exists. App-wide, so draft recovery still finds them. */
  deferred: DeferredFiles;
  /** The author moved the destination. The URL follows, so a reload comes back here. */
  onDestination?: ((cwd: string, placement?: Placement) => void) | undefined;
  /** Open this session. `unsent` is set when its first message may not have gone out. */
  onStarted: (session: Session, unsent?: { draft: string; error: string }) => void;
  onClose: () => void;
}) {
  const [destination, setDestination] = useState<Destination>(() => ({
    cwd: initialCwd,
    setupId: initialLaunch?.worktree?.setup.phase === "failed" ? initialLaunch.worktree.id : undefined,
    placement: initialPlacement ?? (initialLaunch?.placement.destination?.kind === "fresh-worktree" ? "fresh"
      : initialLaunch?.placement.destination ? "existing" : undefined),
  }));
  const [options, setOptions] = useState<Options>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [choice, setChoice] = useState<AgentChoice>(initialLaunch?.choice ?? {});
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
  const [item, setItem] = useState(backlog ? initialLaunch?.placement.item ?? initialItem : undefined);
  const [itemLoad, setItemLoad] = useState<ItemLoad>();
  // The claim that beat this start. The item stays, so the author can see who holds it.
  const [taken, setTaken] = useState<BacklogClaim | undefined>(initialLaunch?.state.type === "failed" ? initialLaunch.state.taken : undefined);
  useEffect(() => {
    if (!item || !backlog) return;
    const controller = new AbortController();
    backlog.detail(item, controller.signal).then((detail) => { if (!controller.signal.aborted) setItemLoad({ ref: item, detail }); },
      (error: unknown) => { if (!controller.signal.aborted) setItemLoad({ ref: item, error: messageOf(error) }); });
    return () => controller.abort();
  }, [item, backlog]);
  const removeItem = useCallback(() => { setItem(undefined); setTaken(undefined); onItemRemoved?.(); }, [onItemRemoved]);
  // The project the window points at now, longest path first, so a nested project wins over its parent.
  const chosenProject = destination.cwd ? [...projects].sort((a, b) => b.path.length - a.path.length)
    .find((project) => destination.cwd === project.path || destination.cwd.startsWith(`${project.path}/`)) : undefined;
  const routedTo = itemLoad?.detail?.item.destination;
  const carry = item ? carryState(itemLoad, item, taken, lookSession, (claim) => {
    if (claim.kind === "claimed") onStarted({ id: claim.sessionId, cwd: claim.cwd });
  }, {
    chosen: destination.cwd ? chosenProject?.name ?? destinationLabel(destination.cwd, projects) : undefined,
    // Before the projects arrive, the folder the window opened at is the item's own destination.
    routed: routedTo?.kind === "routed" && (chosenProject ? chosenProject.id === routedTo.projectId : destination.cwd === initialCwd),
  }) : undefined;
  const itemTitle = carry && carry.type !== "loading" ? carry.title : undefined;
  // Nothing starts while the item cannot go with it: the author removes it, or waits for it to load.
  const itemBlocks = carry !== undefined && carry.type !== "ready";
  // Is the folder in a Git project? Until the server says, the start leaves the choice to it, which is the same default.
  useEffect(() => {
    if (!worktrees || !destination.cwd) return;
    const controller = new AbortController();
    worktrees.options(destination.cwd, controller.signal).then((value) => { if (!controller.signal.aborted) setOptions({ cwd: destination.cwd, value }); },
      () => { if (!controller.signal.aborted) setOptions({ cwd: destination.cwd }); });
    return () => controller.abort();
  }, [worktrees, destination.cwd]);
  const where = options?.cwd === destination.cwd ? options.value : undefined;
  const git = where?.kind === "git" ? where : undefined;
  const fresh = git !== undefined && destination.placement === "fresh";
  const defaultBranch = git !== undefined && destination.placement === undefined;
  // Resolve implicit starts to the default branch before reading its models, skills, and files.
  const cwd = defaultBranch ? git.defaultCwd ?? git.repo : fresh ? git.repo : destination.cwd;
  const repo = git?.repo;
  useEffect(() => {
    if (!worktrees || !repo) return;
    const controller = new AbortController();
    worktrees.list(repo, controller.signal).then((records) => {
      if (!controller.signal.aborted) for (const record of records) launches.recoverSetup(record);
    }, () => { /* Inventory failure does not block a start. */ });
    return () => controller.abort();
  }, [worktrees, repo, launches]);
  useEffect(() => () => attachments.dispose(), [attachments]);

  useEffect(() => {
    const controller = new AbortController();
    api.projects(controller.signal).then(setProjects, () => { /* The label falls back to the folder name. */ });
    return () => controller.abort();
  }, [api]);
  // Pi's models and defaults depend on the folder. A choice survives a move only where it still exists.
  useEffect(() => {
    // A source's item with no destination opens with no folder. Nothing can start until the author picks one.
    if (!cwd) return;
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
    if (!cwd) { setResources({ cwd, catalog: { type: "ready", commands: [] }, commands: [] }); return; }
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
  const canSend = defaults?.cwd === cwd && (!worktrees || options?.cwd === destination.cwd) && !itemBlocks;
  const [restoring, setRestoring] = useState<LaunchDraft | undefined>(initialLaunch?.draft);
  const putBack = useCallback((draft: LaunchDraft) => { setRestoring(draft); }, []);
  const onNew = useCallback(async (message: AppendMessage) => {
    const authored = message.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
    const typed = authored.trim();
    const draft: LaunchDraft = { text: authored, attachments: message.attachments ?? [] };
    const refuse = (error: string) => { setPhase({ type: "composing", error }); void putBack(draft); };
    let prompt: ReturnType<typeof promptOf>;
    try { prompt = promptOf(message); } catch (error) { refuse(messageOf(error)); return; }
    const { text, files } = deferred.split(prompt.text);
    if (!canSend) { void putBack(draft); return; }
    if (text === "" && !prompt.attachments?.length && files.length === 0 && !item) return;
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
    const retrying = initialLaunch?.worktree?.id === destination.setupId ? initialLaunch?.worktree : undefined;
    const site = retrying ? { destination: { kind: "fresh-worktree" as const }, setupId: retrying.id, worktree: retrying }
      : destination.placement !== undefined || where?.kind === "non-git"
        ? { destination: { kind: destination.placement === "fresh" ? "fresh-worktree" as const : "existing-workspace" as const } } : {};
    const placement = item ? { ...site, item, ...(itemTitle ? { title: itemTitle } : {}) } : site;
    const launch = launches.launch(retrying?.repo ?? cwd, { text, images: prompt.attachments, files, command }, { model, thinkingLevel }, draft, placement);
    if (initialLaunch) launches.take(initialLaunch.id);
    setPhase({ type: "starting", id: launch.id });
    // Both modes show progress in the app-owned pending page, never in this window.
    onLaunching?.(launch.id);
    if (onLaunching) return;
    onClose();
    const outcome = await launch.done;
    if (outcome.type === "started") { launches.take(launch.id); onStarted(outcome.session); }
    if (outcome.type === "unsent") { launches.take(launch.id); onStarted(outcome.session, { draft: typed, error: outcome.error }); }
  }, [deferred, resources, cwd, launches, model, thinkingLevel, onStarted, onLaunching, onClose, initialLaunch, putBack, where, destination.placement, destination.setupId, item, itemTitle, canSend]);

  const starting = phase.type === "starting";
  const runtime = useExternalStoreRuntime({
    messages: useThreadMessages([], false), onNew, adapters: { dictation, attachments },
    isRunning: false, isDisabled: starting, isSendDisabled: !canSend,
  });
  useEffect(() => { runtimeRef.current = runtime; return () => { runtimeRef.current = null; }; }, [runtime]);
  // Restore after the runtime has committed its enabled composer. Restoring during the disabled → enabled
  // transition lets the runtime's composer synchronization overwrite the first restored attachment.
  useEffect(() => {
    if (!restoring) return;
    setRestoring(undefined);
    const composer = runtime.thread.composer;
    composer.setText([restoring.text, composer.getState().text].filter(Boolean).join("\n"));
    void (async () => {
      for (const attachment of restoring.attachments) await composer.addAttachment(reusableAttachment(attachment));
    })();
  }, [restoring, runtime]);
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
  const label = !cwd ? "Choose a project" : fresh ? freshLabel(destinationLabel(git.repo, projects), git)
    : defaultBranch && cwd !== git.repo ? `${destinationLabel(git.repo, projects)} · ${git.defaultBranch}` : destination.label ?? destinationLabel(cwd, projects);
  const view: StartPhase = phase.type === "starting" ? { type: "starting" }
    : phase.error ? { type: "failed", message: phase.error } : { type: "ready" };
  // Clears the bar and its files. The saved draft follows the bar, so it clears too.
  const discard = () => { setPhase({ type: "composing" }); void runtimeRef.current?.thread.composer.reset(); };

  return <AssistantRuntimeProvider runtime={runtime}>
    <DictationProvider adapter={dictation}>
      <ImageViewerProvider>
        <NewSessionDialog hidden={hidden || starting} carry={carry ? {
            card: <BacklogCarry state={carry} onRemove={removeItem} />,
            note: carry.type === "ready" ? <p className="bl-note">Starting gives this item to the new session until you archive it.</p> : undefined,
            placeholder: "Add anything the item does not say, or start with the item as written…",
            onSendEmpty: canSend ? () => { void onNew(EMPTY_MESSAGE); } : undefined,
            blocked: itemBlocks,
          } : undefined}
          phase={view} rapidfire={mode === "rapidfire"} onRapidfire={() => setMode(mode === "rapidfire" ? "switch" : "rapidfire")}
          onDiscard={discard} onClose={onClose} model={modelBinding} mentions={mentions}
          commands={{ catalog: resources?.cwd === cwd ? resources.catalog : { type: "loading" }, onRetry: () => setResourceAttempt((n) => n + 1) }}
          destination={<DestinationPicker binding={{
            cwd, label, disabled: starting, placement: worktrees ? (fresh ? "fresh" : "existing") : undefined,
            listProjects: (signal) => api.projects(signal),
            listWorkspaces: (projectId, signal) => api.workspaces(projectId, signal),
            ...(worktrees ? { worktreeOptions: (path: string, signal: AbortSignal) =>
              where && (path === destination.cwd || path === git?.repo) ? Promise.resolve(where) : worktrees.options(path, signal) } : {}),
            onChoose: (next, nextLabel, placement) => {
              setDestination({ cwd: next, ...(placement === "fresh" ? {} : { label: nextLabel }), placement });
              if (placement) onDestination?.(next, placement); else onDestination?.(next);
            },
          }} />}
          />
      </ImageViewerProvider>
    </DictationProvider>
  </AssistantRuntimeProvider>;
}
