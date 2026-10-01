import type { CompactionState } from "../compaction";

export interface CompactionBinding {
  state: CompactionState;
  disabled: boolean;
  /** The server will queue compaction: an agent run or a shell command holds the session. Defaults to the thread's run state. */
  waits?: boolean;
  onSend: (text: string) => Promise<void>;
  onDismiss: () => void;
}

/**
 * Shape: session feedback stays outside persisted conversation messages. A
 * queued compaction is one row of the queue above the composer, which also
 * owns clearing it, so this notice starts at checking, running, and finished.
 */
export function CompactionNotice({ state, onDismiss }: CompactionBinding) {
  if (state.type === "idle" || state.type === "queued") return null;
  const failed = state.type === "finished" && state.outcome === "failed";
  const title = state.type === "checking" ? "Checking compaction status…" : state.type === "running" ? "Compacting history…"
    : state.message.split("\n")[0];
  const detail = state.type === "finished" ? state.message.split("\n").slice(1).join("\n").trim() : "";
  return <section className="compaction-notice" aria-label="Compaction" data-phase={state.type} data-error={failed || undefined}>
    <div className="compaction-head">
      <span role={failed ? "alert" : "status"}>{title}</span>
      {state.type === "finished" && <button type="button" onClick={onDismiss} aria-label="Dismiss compaction feedback">Dismiss</button>}
    </div>
    {detail && <details className="compaction-detail"><summary>Completion details</summary><pre>{detail}</pre></details>}
  </section>;
}
