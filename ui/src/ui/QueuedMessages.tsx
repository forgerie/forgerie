import { queueKindOf, type QueuedMessage, type QueueKind } from "../queue";

export interface QueueBinding {
  /** Pi's queue in delivery order, from the last session status. */
  items: readonly QueuedMessage[];
  disabled: boolean;
  onClear: () => void;
}

const kindLabels: Record<QueueKind, string> = { steer: "Steer", followUp: "Follow-up", compaction: "Compaction" };

/**
 * Shape: the work waiting for the agent, after assistant-ui's message-queue
 * element. Pi owns the queue and can only clear all of it, so there is no
 * per-item remove. Stop returns every item to the draft instead.
 */
export function QueuedMessages({ items, disabled, onClear }: QueueBinding) {
  if (items.length === 0) return null;
  return <section className="queue" aria-label="Queued messages">
    <div className="queue-head">
      <span role="status">{items.length} queued</span>
      <button type="button" disabled={disabled} onClick={onClear}
        title="Removes every queued item, including items from other windows. The current run continues.">
        Clear entire queue{items.length > 1 ? ` (${items.length})` : ""}
      </button>
    </div>
    <ol className="queue-items">
      {items.map((item, index) => {
        const kind = queueKindOf(item);
        // Pi gives queued items no IDs. Position and content identify a row.
        return <li key={`${index}:${item.kind}:${item.text}`} className="queue-item" data-kind={kind}>
          <span className="queue-kind">{kindLabels[kind]}</span>
          <span className="queue-text">{item.text}</span>
        </li>;
      })}
    </ol>
  </section>;
}
