import type { AskEvent, PendingAsk } from "./contracts";

/**
 * What the input region shows. While an ask is open, the ask form replaces the
 * composer; there is no state where both are offered.
 */
export type AskState =
  | { type: "none" }
  | { type: "open"; ask: PendingAsk; phase: AskPhase };
export type AskPhase =
  | { type: "answering"; error?: string }
  | { type: "sending"; action: AskAction };
export type AskAction = "submit" | "dismiss";

export const noAsk: AskState = { type: "none" };
const opened = (ask: PendingAsk): AskState => ({ type: "open", ask, phase: { type: "answering" } });

/**
 * Take the daemon's open ask from a status read. The same ask keeps its local
 * phase, so a resync during a send does not re-enable the form.
 */
export function resyncAsk(current: AskState, pending: PendingAsk | undefined): AskState {
  if (!pending) return noAsk;
  return current.type === "open" && current.ask.askId === pending.askId ? current : opened(pending);
}

export function reduceAskEvent(current: AskState, event: AskEvent): AskState {
  switch (event.type) {
    case "ask.opened": return resyncAsk(current, event.ask);
    // Only the named ask closes. A late close of a replaced ask changes nothing.
    case "ask.closed": return current.type === "open" && current.ask.askId === event.askId ? noAsk : current;
  }
}

/** Apply `update` only while `askId` is still the open ask. */
export function whileOpen(current: AskState, askId: string, update: (open: Extract<AskState, { type: "open" }>) => AskState): AskState {
  return current.type === "open" && current.ask.askId === askId ? update(current) : current;
}
