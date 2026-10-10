// Integration-only entry. Unlike a Caliper part, this uses the real API through the configured Vite proxy.
import { useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import "../src/ui/theme.css";
import { createChildAgentsStore } from "../src/childAgents/childAgentsStore";
import { ChildAgentsPanel } from "../src/childAgents/ChildAgentsPanel";

function Live() {
  const [store] = useState(() => {
    const query = new URLSearchParams(location.search);
    const id = query.get("session"); const cwd = query.get("cwd");
    if (!id || !cwd) throw new Error("Pass the isolated acceptance session and cwd");
    return createChildAgentsStore(fetch, () => ({ id, cwd }));
  });
  const [open, setOpen] = useState(true);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => { store.refresh(); return () => store.dispose(); }, [store]);
  if (!open) return <button onClick={() => setOpen(true)}>Child agents</button>;
  return <ChildAgentsPanel children={state.children} openId={state.open?.conversationId} transcript={state.open?.transcript}
    drafts={{ values: state.drafts ?? {}, update: store.updateDraft }} detail={state.detail} outcome={state.outcome} pending={state.pending} error={state.error ?? state.open?.error} runs={state.runs}
    actions={{ onOpenChild: store.open, onBack: store.close, onClose: () => { store.close(); setOpen(false); }, onDismissError: store.dismissError,
      onSend: store.send, onStop: (id) => { void store.stop(id).catch(() => {}); }, onAnswer: store.answer,
      onReview: (id) => { void store.review(id); }, onLand: (id) => { void store.land(id); }, onPreviewDiscard: (id) => { void store.previewDiscard(id); },
      onDiscard: (id, token) => { void store.discard(id, token); }, onContinue: store.continue, onRuns: () => { void store.openRuns(); },
      onCleanup: () => { void store.openCleanup(); }, onRetryDetail: () => { void store.retryDetail(); }, onBackDetail: store.dismissDetail, onDismissOutcome: store.dismissOutcome }} />;
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing root");
createRoot(root).render(<Live />);
