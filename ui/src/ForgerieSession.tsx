import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AssistantRuntimeProvider, useExternalStoreRuntime, type AppendMessage, type AssistantRuntime } from "@assistant-ui/react";
import { browserTransport, createSessionStore } from "./sessionStore";
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

// Binding: the only React component that reads the Forgerie transport/store.
export function ForgerieSession({ id, known, initialDraft, onSwitchSession }: {
  id: string; known?: Session | undefined; initialDraft?: string;
  onSwitchSession: (session: Session, draft?: string) => void;
}) {
  const [store] = useState(() => createSessionStore(id, browserTransport, {}, known));
  const [dictation] = useState(() => new ForgerieDictationAdapter());
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const runtimeRef = useRef<AssistantRuntime | null>(null);
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
  const send = useCallback(async (text: string, images?: PromptAttachment[]) => { applyResult(await store.send(text, images)); }, [store, applyResult]);
  const onNew = useCallback(async (message: AppendMessage) => {
    setSendError(undefined);
    await sendMessage(message, send, () => runtimeRef.current?.thread.composer, setSendError);
  }, [send]);
  const onCancel = useCallback(async () => {
    try { await store.cancel(); } catch { /* The store exposes the command error. */ }
  }, [store]);
  const messages = useThreadMessages(state.transcript.messages, state.transcript.isRunning);
  const runtime = useExternalStoreRuntime({
    messages, onNew, onCancel, adapters: { dictation, attachments },
    isRunning: state.transcript.isRunning,
    isLoading: state.connection.type === "loading",
    isDisabled: state.connection.type !== "ready",
    isSendDisabled: state.sending || state.connection.type !== "ready",
  });
  useEffect(() => { runtimeRef.current = runtime; return () => { runtimeRef.current = null; }; }, [runtime]);
  useEffect(() => { if (initialDraft !== undefined) runtime.thread.composer.setText(initialDraft); }, [initialDraft, runtime]);
  const error = state.connection.type === "reconnecting" ? "Reconnecting automatically. Your draft stays here."
    : state.connection.type === "failed" ? state.connection.message
    : sendError ?? state.commandError ?? state.transcript.error;
  const status = state.connection.type === "loading" ? "Connecting"
    : state.connection.type === "reconnecting" ? "Reconnecting"
    : state.connection.type === "failed" ? "Disconnected"
    : state.sending ? "Sending" : state.transcript.isRunning ? "Running"
    : state.ask.type === "open" ? "Waiting for you" : "Connected";
  const ask: AskBinding | undefined = state.ask.type === "open" ? {
    ask: state.ask.ask, phase: state.ask.phase, offline: state.connection.type !== "ready",
    onSubmit: (answers) => void store.submitAsk(answers), onDismiss: () => void store.dismissAsk(),
    onChat: send,
  } : undefined;

  return <AssistantRuntimeProvider runtime={runtime}>
    <DictationProvider adapter={dictation}>
    <SessionFrame name={state.session?.name ?? "Session"} status={status} error={error}
      recovery={state.connection.type === "failed" ? <button onClick={() => window.location.reload()}>Reload</button> : undefined}>
      <Thread ask={ask} mentions={mentions} commands={{ catalog: state.commands, onRetry: () => void store.loadCommands() }}
        commandResult={state.commandResult ? {
          result: state.commandResult, disabled: state.sending || state.connection.type !== "ready",
          onChoose: (requestId, value) => { void store.respondToCommand(requestId, value).then(applyResult).catch(() => { /* Store exposes the error and keeps the choices. */ }); },
          onClose: store.dismissCommand,
        } : undefined} />
    </SessionFrame>
    </DictationProvider>
  </AssistantRuntimeProvider>;
}
