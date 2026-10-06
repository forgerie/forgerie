import { useRef, type MouseEvent } from "react";
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
 *
 * The live region stays mounted while the list comes and goes, so a screen
 * reader hears the first queued item and hears the queue empty.
 */
export function QueuedMessages({ items, disabled, onClear }: QueueBinding) {
  const seen = useRef(false);
  if (items.length > 0) seen.current = true;
  const announcement = items.length > 0 ? `${items.length} queued` : seen.current ? "Queue empty" : "";
  function clear(event: MouseEvent<HTMLButtonElement>) {
    onClear();
    // The list unmounts when Pi confirms. Keep focus, and the touch keyboard, in the input.
    event.currentTarget.closest(".composer-region")?.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus({ preventScroll: true });
  }
  return <>
    <span className="queue-announcer sr-only" role="status">{announcement}</span>
    {items.length > 0 && <section className="queue" aria-label="Queued messages">
      <div className="queue-head">
        <span aria-hidden>{items.length} queued</span>
        <button type="button" disabled={disabled} onClick={clear}
          title="Removes every queued item, including items from other windows. The current run continues.">
          Clear entire queue{items.length > 1 ? ` (${items.length})` : ""}
        </button>
      </div>
      {/* Focusable so a keyboard can scroll it when it overflows its height budget. */}
      <ol className="queue-items" tabIndex={0} aria-label="Queue, in delivery order">
        {items.map((item, index) => {
          const kind = queueKindOf(item);
          // Pi gives queued items no IDs. Position and content identify a row.
          return <li key={`${index}:${item.kind}:${item.text}`} className="queue-item" data-kind={kind}>
            <span className="queue-kind">{kindLabels[kind]}</span><span className="sr-only">: </span>
            <span className="queue-text">{item.text}</span>
          </li>;
        })}
      </ol>
    </section>}
  </>;
}
