import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AssistantRuntimeProvider, useExternalStoreRuntime, type AppendMessage, type AssistantRuntime } from "@assistant-ui/react";
import { browserTransport, createSessionStore } from "./sessionStore";
import { convertMessage } from "./transcript";
import { Thread } from "./ui/Thread";

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
  const runtime = useExternalStoreRuntime({
    messages: state.transcript.messages, convertMessage, onNew, onCancel,
    isRunning: state.transcript.isRunning,
    isLoading: state.connection.type === "loading",
    isDisabled: state.connection.type !== "ready",
    isSendDisabled: state.sending,
  });
  useEffect(() => { runtimeRef.current = runtime; }, [runtime]);
  const error = state.connection.type === "failed" ? state.connection.message
    : state.commandError ?? state.transcript.error;
  const status = state.connection.type === "loading" ? "Connecting"
    : state.connection.type === "failed" ? "Disconnected"
    : state.sending ? "Sending" : state.transcript.isRunning ? "Running" : "Connected";

  return <AssistantRuntimeProvider runtime={runtime}>
    <main className="session-shell">
      <header className="session-header">
        <div className="session-heading"><span className="product-name">Forgerie</span>
          <h1 title={state.session?.name ?? id}>{state.session?.name ?? "Session"}</h1>
        </div>
        <span className="connection-status" role="status">{status}</span>
      </header>
      {error && <div className="notice" role="alert"><p>{error}</p>
        {state.connection.type === "failed" && <button onClick={() => window.location.reload()}>Reload</button>}
      </div>}
      <Thread />
    </main>
  </AssistantRuntimeProvider>;
}
