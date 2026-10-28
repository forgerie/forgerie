import { useRef, type MouseEvent } from "react";
import { queueKindOf, type QueuedMessage, type QueueKind } from "../queue";
import { LedgeLines } from "./LedgeLines";

export interface QueueBinding {
  /** Pi's queue in delivery order, from the last session status. */
  items: readonly QueuedMessage[];
  disabled: boolean;
  onClear: () => void;
}

const kindLabels: Record<QueueKind, string> = { steer: "Steer", followUp: "Follow-up", compaction: "Compaction" };

/**
 * Shape: the work waiting for the agent, as the ledge's band nearest the input bar, after assistant-ui's
 * message-queue element. Pi owns the queue and can only clear all of it, so there is no per-item remove. Stop
 * returns every item to the draft instead.
 *
 * The live region stays mounted while the list comes and goes, and while the ledge is folded away, so a screen
 * reader hears the first queued item and hears the queue empty.
 */
export function QueuedMessages({ items, disabled, onClear }: QueueBinding) {
  const seen = useRef(false);
  if (items.length > 0) seen.current = true;
  const announcement = items.length > 0 ? `${items.length} queued` : seen.current ? "Queue empty" : "";
  function clear(event: MouseEvent<HTMLButtonElement>) {
    onClear();
    // The list unmounts when Pi confirms. Keep focus, and the touch keyboard, in the input.
    event.currentTarget.closest(".composer-region")?.querySelector<HTMLElement>(".composer [data-composer-input]")?.focus({ preventScroll: true });
  }
  return <>
    <span className="queue-announcer sr-only" role="status">{announcement}</span>
    {/* Pi gives queued items no IDs. Position and content identify a line. */}
    <LedgeLines label="Queued messages" listLabel="Queue, in delivery order"
      head={<><strong>{items.length}</strong> queued, sent in this order</>}
      action={{ label: items.length > 1 ? "Clear all" : "Clear", disabled, onPress: clear,
        title: items.length > 1 ? "Removes every queued message, including ones from other windows. The current run continues."
          : "Removes the queued message, including from other windows. The current run continues." }}
      lines={items.map((item, index) => {
        const kind = queueKindOf(item);
        return { key: `${index}:${item.kind}:${item.text}`, kind: kindLabels[kind], kindTone: kind === "steer" ? "strong" : undefined,
          face: kind === "compaction" ? "code" : undefined, text: item.text };
      })} />
  </>;
}
