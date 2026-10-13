import type { Trigger } from "@shared/triggers";
import { AlertCard, type AlertAction } from "../ui/AlertCard";
import { problemsSince } from "./triggersModel";
import { dateOnly, missedWords, skippedWords, whenShort, type WordClock } from "./triggerWords";

/**
 * Shape: the newest failed or missed run since the trigger last needed a look,
 * and the two ways forward. It stays until the reader marks it as seen:
 * opening the page, editing, or running now does not clear it.
 */
export function TriggerAttention({ trigger, clock, errorLines, onAcknowledge, onRunNow, onOpenSession }: {
  trigger: Trigger; clock: WordClock;
  /** How many lines of the error show before Show more: fewer when the page is short. */
  errorLines: number;
  onAcknowledge: () => void; onRunNow: () => void;
  onOpenSession: (session: { id: string; cwd: string }) => void;
}) {
  const problems = problemsSince(trigger);
  const latest = problems[0];
  if (trigger.attention === null || !latest) return null;
  const zone = trigger.schedule.timezone;
  const failed = latest.outcome.kind === "failed" ? latest.outcome : undefined;
  const when = whenShort(latest.occurrence, zone, clock);
  const skipped = skippedWords(latest.skippedBefore);
  const actions: AlertAction[] = [
    { label: "Mark as seen", onPress: onAcknowledge },
    { label: "Run now…", onPress: onRunNow },
    ...failed?.sessionId && failed.cwd ? [{ label: "Open session", onPress: () => onOpenSession({ id: failed.sessionId ?? "", cwd: failed.cwd ?? "" }) }] : [],
  ];
  return <AlertCard tone={failed ? "bad" : "warn"} label={failed ? "Run failed" : "Run missed"} subject={failed ? "Failed" : "Missed"}
    title={failed ? `The ${when} run failed.` : `The ${when} run was missed.`}
    code={failed?.error} codeLabel="Error" codeLines={errorLines} actions={actions}>
    <p>{failed ? "Fix the cause, then run it now or wait for the next run." : missedWords(latest, zone, trigger.missedGraceMinutes, clock)}</p>
    {problems.length > 1 ? <p>{problems.length} runs had problems since {dateOnly(trigger.attention.since, zone, clock)}.</p> : null}
    {skipped ? <p>{skipped}</p> : null}
  </AlertCard>;
}
