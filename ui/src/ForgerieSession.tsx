import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AssistantRuntimeProvider, useExternalStoreRuntime, type AppendMessage, type AssistantRuntime } from "@assistant-ui/react";
import { browserTransport, createSessionStore, isBashRunning, shellAvailabilityOf } from "./sessionStore";
import type { Session } from "./contracts";
import { useThreadMessages } from "./useThreadMessages";
import { Thread } from "./ui/Thread";
import { SessionFrame } from "./ui/SessionFrame";
import type { AskBinding } from "./ui/useAskMode";
import type { CommandResult } from "./commands";
import { createMentionSource } from "./mentionSource";
import { ForgerieDictationAdapter } from "./speech/ForgerieDictationAdapter";
import { DictationProvider } from "./DictationProvider";
import { createAttachmentAdapter, type PromptAttachment } from "./attachments";
import { sendMessage } from "./sendMessage";
import { createChatDraft } from "./chatDraft";
import type { HandoffDoor } from "./handoffDoor";
import { SessionDoorsProvider } from "./ui/SessionDoor";
import type { DraftStore } from "./draftStore";
import { workingSend } from "./queue";
import type { TreeOutcome } from "./sessionTree";
import { SessionTreeNavigator, TreeOpener } from "./ui/SessionTreeNavigator";

// Binding: the only React component that reads the Forgerie transport/store.
export function ForgerieSession({ id, known, initialDraft, drafts, onSwitchSession }: {
  id: string; known?: Session | undefined; initialDraft?: string | undefined;
  /** Where unsent drafts outlive this view. Without it, they last only while the view is mounted. */
  drafts?: DraftStore | undefined;
  onSwitchSession: (session: Session, draft?: string) => void;
}) {
  const [store] = useState(() => createSessionStore(id, browserTransport, {}, known));
  const [dictation] = useState(() => new ForgerieDictationAdapter());
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const runtimeRef = useRef<AssistantRuntime | null>(null);
  const [saved] = useState(() => drafts?.session(id));
  const [chatDraft] = useState(() => createChatDraft(() => runtimeRef.current?.thread.composer, saved));
  const sessionId = state.session?.id;
  const cwd = state.session?.cwd;
  const mentions = useMemo(() => sessionId && cwd ? createMentionSource({ id: sessionId, cwd }, browserTransport.request) : undefined,
    [sessionId, cwd]);
  const [attachments] = useState(() => createAttachmentAdapter(store.saveAttachment));
  const [sendError, setSendError] = useState<string>();
  useEffect(() => { void store.start(); return () => { attachments.dispose(); store.dispose(); }; }, [store, attachments]);
  const applyResult = useCallback((result: CommandResult | void) => {
    if (!runtimeRef.current || result?.type !== "done") return;
    if (result.session && result.session.id !== id) onSwitchSession(result.session, result.promptDraft);
    else if (result.promptDraft !== undefined) runtimeRef.current.thread.composer.setText(result.promptDraft);
  }, [id, onSwitchSession]);
  // A fork opens as its own session. Continuing reloads this one and returns the entry's text to the message box.
  const applyTree = useCallback((outcome: TreeOutcome) => {
    if (outcome.type === "forked") onSwitchSession(outcome.session, outcome.promptDraft);
    else if (outcome.type === "continued") runtimeRef.current?.thread.composer.setText(outcome.editorText);
  }, [onSwitchSession]);
  const openDoor = useCallback((door: HandoffDoor) => onSwitchSession({ id: door.sessionId, cwd: door.cwd }), [onSwitchSession]);
  const send = useCallback(async (text: string, images?: PromptAttachment[], options?: { steer?: boolean }) => {
    applyResult(await store.send(text, images, options));
  }, [store, applyResult]);
  const onNew = useCallback(async (message: AppendMessage) => {
    setSendError(undefined);
    // assistant-ui marks a steer on the message itself (composer.send({ steer: true })).
    await sendMessage(message, (text, images) => send(text, images, { steer: message.steer === true }),
      () => runtimeRef.current?.thread.composer, setSendError);
  }, [send]);
  const onCancel = useCallback(async () => {
    try {
      const restored = await store.cancel();
      chatDraft.restore(restored.map((message) => message.text).join("\n\n"));
    } catch { /* The store exposes the command error. */ }
  }, [store, chatDraft]);
  const messages = useThreadMessages(state.transcript.messages, state.transcript.isRunning);
  const runtime = useExternalStoreRuntime({
    messages, onNew, onCancel, adapters: { dictation, attachments },
    isRunning: state.transcript.isRunning,
    isLoading: state.connection.type === "loading",
    isDisabled: state.connection.type !== "ready",
    isSendDisabled: state.sending || state.connection.type !== "ready",
  });
  useEffect(() => { runtimeRef.current = runtime; return () => { runtimeRef.current = null; }; }, [runtime]);
  // Bring back the saved chat draft, then save every change. A fork's prompt draft, set next, replaces it.
  useEffect(() => {
    if (!saved) return;
    chatDraft.hydrate(saved.chat());
    return runtime.thread.composer.subscribe(chatDraft.sync);
  }, [runtime, chatDraft, saved]);
  useEffect(() => { if (initialDraft !== undefined) runtime.thread.composer.setText(initialDraft); }, [initialDraft, runtime]);
  // Once joined, the store names the open ask. Answers saved for any other ask can never be sent.
  const openAskId = state.ask.type === "open" ? state.ask.ask.askId : undefined;
  const joined = state.connection.type === "ready";
  useEffect(() => { if (joined) saved?.keepAnswers(openAskId); }, [saved, joined, openAskId]);
  const error = state.connection.type === "reconnecting" ? "Reconnecting automatically. Your draft stays here."
    : state.connection.type === "failed" ? state.connection.message
    : sendError ?? state.commandError ?? state.transcript.error;
  const status = state.connection.type === "loading" ? "Connecting"
    : state.connection.type === "reconnecting" ? "Reconnecting"
    : state.connection.type === "failed" ? "Disconnected"
    : state.sending ? "Sending" : state.compaction.type === "running" ? "Compacting"
    : state.compaction.type === "queued" ? "Compaction queued" : state.transcript.isRunning ? "Running"
    : isBashRunning(state) ? "Running shell command"
    : state.ask.type === "open" ? "Waiting for you" : "Connected";
  const ask: AskBinding | undefined = state.ask.type === "open" ? {
    ask: state.ask.ask, phase: state.ask.phase, offline: state.connection.type !== "ready",
    onSubmit: (answers) => void store.submitAsk(answers), onDismiss: () => void store.dismissAsk(),
    onChat: send, answers: saved,
  } : undefined;

  return <AssistantRuntimeProvider runtime={runtime}>
    <DictationProvider adapter={dictation}>
    <SessionFrame name={state.session?.name ?? "Session"} status={status} error={error}
      recovery={state.connection.type === "failed" ? <button onClick={() => window.location.reload()}>Reload</button> : undefined}
      actions={<TreeOpener idle={state.connection.type === "ready" && !state.sending && !state.transcript.isRunning}
        onOpen={() => { void store.openTree().catch(() => { /* The store exposes the error. */ }); }} />}>
      <SessionDoorsProvider cwd={cwd} open={openDoor}>
      <Thread ask={ask} mentions={mentions} chatDraft={chatDraft} commands={{ catalog: state.commands, onRetry: () => void store.loadCommands() }}
        compaction={{ state: state.compaction, disabled: state.sending || state.connection.type !== "ready",
          waits: state.transcript.isRunning || isBashRunning(state),
          onSend: send, onDismiss: store.dismissCompaction }}
        shell={{ availability: shellAvailabilityOf(state), onRun: send }}
        queue={{ items: state.status?.queuedMessages ?? [], disabled: state.sending || state.connection.type !== "ready",
          onClear: () => { void store.clearQueue().catch(() => { /* Store exposes the error. */ }); } }}
        working={workingSend(state.status, state.compaction, state.transcript.isRunning)}
        model={{ model: state.status?.model, thinkingLevel: state.status?.thinkingLevel, disabled: state.connection.type !== "ready",
          listModels: store.listModels, listThinkingLevels: store.listThinkingLevels, onModel: store.setModel, onThinkingLevel: store.setThinkingLevel }}
        commandResult={state.commandResult ? {
          result: state.commandResult, disabled: state.sending || state.connection.type !== "ready",
          onChoose: (requestId, value) => { void store.respondToCommand(requestId, value).then(applyResult).catch(() => { /* Store exposes the error and keeps the choices. */ }); },
          onClose: store.dismissCommand,
        } : undefined} />
      </SessionDoorsProvider>
      {state.tree.type === "open" && <SessionTreeNavigator tree={state.tree.tree} operation={state.tree.operation}
        onContinue={(targetId, summary) => { void store.continueTree(targetId, summary).then(applyTree); }}
        onFork={(entryId) => { void store.forkTree(entryId).then(applyTree); }}
        onAbort={() => { void store.abortTree(); }} onClose={store.closeTree} />}
    </SessionFrame>
    </DictationProvider>
  </AssistantRuntimeProvider>;
}
