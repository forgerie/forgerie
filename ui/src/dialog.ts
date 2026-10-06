import { DIALOG_INPUT_MAX_LENGTH, type PendingDialog } from "./contracts";

export type { PendingDialog };
/** What the browser is doing with one dialog. The daemon owns whether it is open. */
export type DialogPhase = { type: "answering" } | { type: "sending" } | { type: "failed"; message: string };
/** The store keeps one phase, tagged with its dialog, so a newer dialog never inherits it. */
export type StoredDialogPhase = { dialogId: string } & DialogPhase | { dialogId?: undefined; type: "answering" };
export const noDialogPhase: StoredDialogPhase = { type: "answering" };

export function phaseFor(stored: StoredDialogPhase, dialogId: string): DialogPhase {
  if (stored.dialogId !== dialogId || stored.type === "answering") return { type: "answering" };
  return stored.type === "failed" ? { type: "failed", message: stored.message } : { type: "sending" };
}

/**
 * Time left before the daemon closes the dialog. Display only: the daemon
 * closes it and status then drops it, so a countdown at zero just waits.
 */
export function dialogCountdown(timeoutAt: string | undefined, nowMs: number): string | undefined {
  if (timeoutAt === undefined) return undefined;
  const deadline = Date.parse(timeoutAt);
  if (!Number.isFinite(deadline)) return undefined;
  const seconds = Math.ceil((deadline - nowMs) / 1000);
  if (seconds <= 0) return "Closing…";
  if (seconds >= 3600) return `Closes in ${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  if (seconds >= 60) return `Closes in ${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `Closes in ${seconds}s`;
}

export function dialogInputProblem(text: string): string | undefined {
  return text.length > DIALOG_INPUT_MAX_LENGTH
    ? `The answer exceeds ${DIALOG_INPUT_MAX_LENGTH} characters. Shorten it before sending.` : undefined;
}
