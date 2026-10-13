import type { Trigger } from "@shared/triggers";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { whenLong, type WordClock } from "./triggerWords";

/** The one question the screen may ask at a time. */
export type TriggerQuestion =
  | { kind: "run"; trigger: Trigger; busy: boolean; error?: string | undefined }
  | { kind: "delete"; trigger: Trigger; busy: boolean; error?: string | undefined }
  | { kind: "leave"; name: string };

/**
 * Shape: the screen's confirmations. Run now asks first, because each run
 * costs a whole workflow run. Delete says what goes and what stays. Leaving
 * with unsaved changes asks before the changes are lost.
 */
export function TriggerDialog({ question, clock, projectLabel, onConfirm, onCancel }: {
  question: TriggerQuestion; clock: WordClock;
  projectLabel: (cwd: string) => string;
  onConfirm: () => void; onCancel: () => void;
}) {
  if (question.kind === "leave") return <ConfirmDialog tone="plain" title="Discard your changes?" confirmLabel="Discard changes" cancelLabel="Keep editing"
    onConfirm={onConfirm} onCancel={onCancel}>
    <p>Your changes to “{question.name}” are not saved.</p>
  </ConfirmDialog>;
  const { trigger, busy, error } = question;
  if (question.kind === "delete") return <ConfirmDialog tone="danger" title={`Delete “${trigger.name}”?`} confirmLabel="Delete trigger" busyLabel="Deleting…"
    busy={busy} onConfirm={onConfirm} onCancel={onCancel}>
    <p>It stops running, and its run history is deleted. The sessions it started stay in your session list.</p>
    {error ? <p role="alert">Could not delete “{trigger.name}”: {error}</p> : null}
  </ConfirmDialog>;
  const after = trigger.state.kind === "paused" ? "The trigger stays paused."
    : `The next scheduled run stays ${whenLong(trigger.state.nextFireAt, trigger.schedule.timezone, clock)}.`;
  return <ConfirmDialog tone="plain" title={`Run “${trigger.name}” now?`} confirmLabel="Run now" busyLabel="Starting…" busy={busy}
    onConfirm={onConfirm} onCancel={onCancel}>
    <p>It starts {trigger.action.workflow} in a new session of {projectLabel(trigger.action.cwd)}, as a scheduled run would. {after}</p>
    {error ? <p role="alert">Could not run “{trigger.name}”: {error}</p> : null}
  </ConfirmDialog>;
}
