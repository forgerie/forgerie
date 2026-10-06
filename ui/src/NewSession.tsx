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

/** The draft store key of the first message, which has no session yet. */
export const NEW_SESSION_DRAFT = "new-session";
/** What comes back to the composer when a start fails. */
export interface LaunchDraft { text: string; attachments: readonly CompleteAttachment[] }
export type LaunchMode = "switch" | "rapidfire";
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
export function NewSession({ cwd: initialCwd, initialMode = "switch", api, launches, deferred, drafts, onStarted, onDestination, onClose }: {
  cwd: string; initialMode?: LaunchMode; api: NewSessionApi; launches: LaunchStore<LaunchDraft>; drafts?: DraftStore | undefined;
  /** Files held until their session exists. App-wide, so "Put back" in a later window still finds them. */
  deferred: DeferredFiles;
  /** The author moved the destination. The URL follows, so a reload comes back here. */
  onDestination?: ((cwd: string) => void) | undefined;
  /** Open this session. `unsent` is set when its first message may not have gone out. */
  onStarted: (session: Session, unsent?: { draft: string; error: string }) => void;
  onClose: () => void;
}) {
  const [destination, setDestination] = useState<{ cwd: string; label?: string }>({ cwd: initialCwd });
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
  const { cwd } = destination;
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
    const launch = launches.launch(cwd, { text, images: prompt.attachments, files, command }, { model, thinkingLevel }, draft);
    if (mode === "rapidfire") return;
    setPhase({ type: "starting", id: launch.id });
    const outcome = await launch.done;
    // The window closed while it started (Back, the row, a reload): the start stays in the list,
    // so the app's notice says how it went and "Put back" still has its files. A success needs nothing.
    if (!alive.current) { if (outcome.type === "started") launches.take(launch.id); return; }
    launches.take(launch.id);
    if (outcome.type === "started") { onStarted(outcome.session); return; }
    if (outcome.type === "unsent") { onStarted(outcome.session, { draft: typed, error: outcome.error }); return; }
    refuse(outcome.error);
  }, [deferred, resources, cwd, launches, model, thinkingLevel, mode, onStarted, putBack, saved]);

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
  const label = destination.label ?? destinationLabel(cwd, projects);
  const progress = phase.type === "starting" ? started.find((item) => item.id === phase.id)?.state : undefined;
  const view: StartPhase = phase.type === "starting"
    ? { type: "starting", progress: (progress?.type === "starting" ? progress.progress : undefined) ?? "Starting session…" }
    : phase.error ? { type: "failed", message: phase.error } : { type: "ready" };
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
          destination={<DestinationPicker binding={{
            cwd, label, disabled: starting,
            listProjects: (signal) => api.projects(signal),
            listWorkspaces: (projectId, signal) => api.workspaces(projectId, signal),
            onChoose: (next, nextLabel) => { setDestination({ cwd: next, label: nextLabel }); onDestination?.(next); },
          }} />}
          tray={<LaunchTray launches={started.filter((launch) => phase.type !== "starting" || launch.id !== phase.id)} onOpen={open}
            onRestore={(launch) => { const taken = launches.take(launch.id); if (taken) void putBack(taken.draft); }}
            onDismiss={(launch) => launches.dismiss(launch.id)} />} />
      </ImageViewerProvider>
    </DictationProvider>
  </AssistantRuntimeProvider>;
}
