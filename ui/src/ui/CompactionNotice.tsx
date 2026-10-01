import type { CompactionState } from "../compaction";

export interface CompactionBinding {
  state: CompactionState;
  disabled: boolean;
  queueCount: number;
  onSend: (text: string) => Promise<void>;
  onClearQueue: () => void;
  onDismiss: () => void;
}

/** Shape: session feedback stays outside persisted conversation messages. */
export function CompactionNotice({ state, disabled, queueCount, onClearQueue, onDismiss }: CompactionBinding) {
  if (state.type === "idle") return null;
  const failed = state.type === "finished" && state.outcome === "failed";
  const title = state.type === "checking" ? "Checking compaction status…" : state.type === "queued" ? "Compaction queued" : state.type === "running" ? "Compacting history…"
    : state.message.split("\n")[0];
  const detail = state.type === "queued" ? state.text : state.type === "finished" ? state.message.split("\n").slice(1).join("\n").trim() : "";
  return <section className="compaction-notice" aria-label="Compaction" data-phase={state.type} data-error={failed || undefined}>
    <div className="compaction-head">
      <span role={failed ? "alert" : "status"}>{title}</span>
      {state.type === "queued" && <button type="button" disabled={disabled} onClick={onClearQueue}
        title="Clears every queued item, not the active run">Clear entire queue{queueCount > 1 ? ` (${queueCount})` : ""}</button>}
      {state.type === "finished" && <button type="button" onClick={onDismiss} aria-label="Dismiss compaction feedback">Dismiss</button>}
    </div>
    {detail && <details className="compaction-detail"><summary>{state.type === "queued" ? "Queued command" : "Completion details"}</summary><pre>{detail}</pre></details>}
  </section>;
}
