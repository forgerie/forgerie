import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AssistantRuntimeProvider, useExternalStoreRuntime, type AppendMessage, type AssistantRuntime } from "@assistant-ui/react";
import type { Session, SessionModel } from "./contracts";
import { useThreadMessages } from "./useThreadMessages";
import { Thread } from "./ui/Thread";
import { SessionFrame } from "./ui/SessionFrame";
import { ForgerieDictationAdapter } from "./speech/ForgerieDictationAdapter";
import { DictationProvider } from "./DictationProvider";
import { createChatDraft } from "./chatDraft";
import type { DraftStore } from "./draftStore";
import { DestinationPicker } from "./ui/DestinationPicker";
import type { ModelBinding } from "./ui/ModelPicker";
import { destinationLabel, keepChoice, thinkingLevelsFor, type AgentChoice, type NewSessionApi, type Project } from "./newSession";

/** The draft store key of the first message, which has no session yet. */
export const NEW_SESSION_DRAFT = "new-session";
type Phase = { type: "composing"; error?: string } | { type: "starting" };
interface Defaults { cwd: string; models: SessionModel[]; model?: SessionModel | undefined; thinkingLevel?: string | undefined }

/**
 * Binding: a session that does not exist yet. The one input bar takes the
 * first message; its line above names where the session starts, and the model
 * picker sets the model and thinking level it starts with. Send creates the
 * session, sends the message, and opens it. Nothing is retried: a step that
 * may have worked is reported, never repeated.
 */
export function NewSession({ cwd: initialCwd, api, drafts, onStarted, onDestination }: {
  cwd: string; api: NewSessionApi; drafts?: DraftStore | undefined;
  /** The author moved the destination. The URL follows, so a reload comes back here. */
  onDestination?: ((cwd: string) => void) | undefined;
  /** The session exists. `draft` and `error` are set when its first message did not go out. */
  onStarted: (session: Session, unsent?: { draft: string; error: string }) => void;
}) {
  const [destination, setDestination] = useState<{ cwd: string; label?: string }>({ cwd: initialCwd });
  const [projects, setProjects] = useState<Project[]>([]);
  const [choice, setChoice] = useState<AgentChoice>({});
  const [defaults, setDefaults] = useState<Defaults>();
  const [phase, setPhase] = useState<Phase>({ type: "composing" });
  const [dictation] = useState(() => new ForgerieDictationAdapter());
  const runtimeRef = useRef<AssistantRuntime | null>(null);
  const [saved] = useState(() => drafts?.session(NEW_SESSION_DRAFT));
  const [chatDraft] = useState(() => createChatDraft(() => runtimeRef.current?.thread.composer, saved));
  const { cwd } = destination;
  // A start can outlive this view (Back, another session, a reload). Its
  // result must not pull the reader away from where they went.
  const alive = useRef(true);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  // A reload during a start could leave a session without its first message.
  useEffect(() => {
    if (phase.type !== "starting") return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase.type]);

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

  const known = defaults?.cwd === cwd ? defaults : undefined;
  const model = choice.model ?? known?.model;
  const thinkingLevel = choice.thinkingLevel ?? known?.thinkingLevel;
  const onNew = useCallback(async (message: AppendMessage) => {
    const text = message.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n").trim();
    const restore = (error: string) => {
      setPhase({ type: "composing", error });
      const composer = runtimeRef.current?.thread.composer;
      if (composer) composer.setText([text, composer.getState().text].filter(Boolean).join("\n"));
      else saved?.saveChat([text, saved.chat()].filter(Boolean).join("\n"));
    };
    if (text === "") return;
    if (text.startsWith("!")) { restore("Shell commands need a running session. Send a first message, then run the command."); return; }
    setPhase({ type: "starting" });
    // Start with exactly what the bar shows. Pi's own default for a create can
    // differ from the default its model list reports for the same folder.
    const result = await api.start(cwd, text, { model, thinkingLevel });
    if (result.type === "started") { if (alive.current) onStarted(result.session); return; }
    const { failure } = result;
    if (failure.stage === "prompt") {
      if (!alive.current) return;
      onStarted(failure.session, { draft: text, error: `The session started, but its first message may not have reached Pi: ${failure.message} Check the transcript before you send it again.` });
      return;
    }
    restore(failure.maybeStarted
      ? `${failure.message} The session may have started anyway. Check the session list before you try again.`
      : `The session did not start: ${failure.message}`);
  }, [api, cwd, model, thinkingLevel, onStarted, saved]);

  const runtime = useExternalStoreRuntime({
    messages: useThreadMessages([], false), onNew, adapters: { dictation },
    isRunning: false, isDisabled: phase.type === "starting",
    isSendDisabled: defaults?.cwd !== cwd,
  });
  useEffect(() => { runtimeRef.current = runtime; return () => { runtimeRef.current = null; }; }, [runtime]);
  useEffect(() => {
    if (!saved) return;
    chatDraft.hydrate(saved.chat());
    return runtime.thread.composer.subscribe(chatDraft.sync);
  }, [runtime, chatDraft, saved]);

  const modelBinding: ModelBinding = useMemo(() => ({
    model, thinkingLevel, disabled: phase.type === "starting",
    listModels: async () => known?.models ?? (await api.models(cwd)).models,
    listThinkingLevels: async () => thinkingLevelsFor(model),
    onModel: async (provider, id) => {
      const picked = known?.models.find((item) => item.provider === provider && item.id === id) ?? { provider, id };
      setChoice((current) => ({ ...current, model: picked, ...(picked.reasoning === false ? { thinkingLevel: "off" } : {}) }));
    },
    onThinkingLevel: async (level) => { setChoice((current) => ({ ...current, thinkingLevel: level })); },
  }), [model, thinkingLevel, phase.type, known, api, cwd]);
  const label = destination.label ?? destinationLabel(cwd, projects);

  return <AssistantRuntimeProvider runtime={runtime}>
    <DictationProvider adapter={dictation}>
    <SessionFrame name="New session" status={phase.type === "starting" ? "Starting session…" : ""}
      error={phase.type === "composing" ? phase.error : undefined}>
      <Thread model={modelBinding} attachments={false} chatDraft={chatDraft}
        beforeComposer={<DestinationPicker binding={{
          cwd, label, disabled: phase.type === "starting",
          listProjects: (signal) => api.projects(signal),
          listWorkspaces: (projectId, signal) => api.workspaces(projectId, signal),
          onChoose: (next, nextLabel) => { setDestination({ cwd: next, label: nextLabel }); onDestination?.(next); },
        }} />} />
    </SessionFrame>
    </DictationProvider>
  </AssistantRuntimeProvider>;
}
