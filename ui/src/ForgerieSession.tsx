import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AssistantRuntimeProvider, useExternalStoreRuntime, type AppendMessage, type AssistantRuntime } from "@assistant-ui/react";
import { browserTransport, createSessionStore } from "./sessionStore";
import { useThreadMessages } from "./useThreadMessages";
import { Thread } from "./ui/Thread";
import { SessionFrame } from "./ui/SessionFrame";
import { AskForm } from "./ui/AskForm";

// Binding: the only React component that reads the Forgerie transport/store.
export function ForgerieSession({ id }: { id: string }) {
  const [store] = useState(() => createSessionStore(id, browserTransport));
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const runtimeRef = useRef<AssistantRuntime | null>(null);
  useEffect(() => { void store.start(); return store.dispose; }, [store]);
  const onNew = useCallback(async (message: AppendMessage) => {
    const text = message.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
    try { await store.send(text); }
    catch {
      // assistant-ui clears the composer before onNew. Preserve a failed draft.
      runtimeRef.current?.thread.composer.setText(text);
    }
  }, [store]);
  const onCancel = useCallback(async () => {
    try { await store.cancel(); } catch { /* The store exposes the command error. */ }
  }, [store]);
  const messages = useThreadMessages(state.transcript.messages, state.transcript.isRunning);
  const runtime = useExternalStoreRuntime({
    messages, onNew, onCancel,
    isRunning: state.transcript.isRunning,
    isLoading: state.connection.type === "loading",
    isDisabled: state.connection.type !== "ready",
    isSendDisabled: state.sending || state.connection.type !== "ready",
  });
  useEffect(() => { runtimeRef.current = runtime; }, [runtime]);
  const error = state.connection.type === "reconnecting" ? "Reconnecting automatically. Your draft stays here."
    : state.connection.type === "failed" ? state.connection.message
    : state.commandError ?? state.transcript.error;
  const status = state.connection.type === "loading" ? "Connecting"
    : state.connection.type === "reconnecting" ? "Reconnecting"
    : state.connection.type === "failed" ? "Disconnected"
    : state.sending ? "Sending" : state.transcript.isRunning ? "Running"
    : state.ask.type === "open" ? "Waiting for you" : "Connected";
  const ask = state.ask.type === "open"
    ? <AskForm key={state.ask.ask.askId} ask={state.ask.ask} phase={state.ask.phase}
      offline={state.connection.type !== "ready"}
      onSubmit={(answers) => void store.submitAsk(answers)} onDismiss={() => void store.dismissAsk()} />
    : undefined;

  return <AssistantRuntimeProvider runtime={runtime}>
    <SessionFrame name={state.session?.name ?? "Session"} status={status} error={error}
      recovery={state.connection.type === "failed" ? <button onClick={() => window.location.reload()}>Reload</button> : undefined}>
      <Thread ask={ask} />
    </SessionFrame>
  </AssistantRuntimeProvider>;
}
