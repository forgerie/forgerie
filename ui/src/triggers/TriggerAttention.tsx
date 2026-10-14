import type { Trigger } from "@shared/triggers";
import { AlertCard, type AlertAction } from "../ui/AlertCard";
import { problemsSince } from "./triggersModel";
import { dateOnly, missedWords, skippedWords, whenShort, type WordClock } from "./triggerWords";
import { fireCountWords, isSpreadFire, listWords, type ProjectName } from "./triggerTargets";

/**
 * Shape: the newest failed or missed run since the trigger last needed a look,
 * and the two ways forward. It stays until the reader marks it as seen:
 * opening the page, editing, or running now does not clear it. A run in
 * several projects names the projects that failed; the error shown is the
 * first one's.
 */
export function TriggerAttention({ trigger, clock, errorLines, projectName, onAcknowledge, onRunNow, onOpenSession }: {
  trigger: Trigger; clock: WordClock;
  projectName: ProjectName;
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
  const spread = isSpreadFire(latest);
  const failedIn = latest.projects.filter((item) => item.outcome.kind === "failed").map((item) => projectName(item.cwd));
  const where = spread && failed && failedIn.length > 0
    ? `Failed in ${listWords(failedIn)}: ${fireCountWords(latest)}.${failedIn.length > 1 ? ` The error below is from ${failedIn[0] ?? ""}.` : ""}` : undefined;
  return <AlertCard tone={failed ? "bad" : "warn"} label={failed ? "Run failed" : "Run missed"} subject={failed ? "Failed" : "Missed"}
    title={when}
    code={failed?.error} codeLabel="Error" codeLines={errorLines} actions={actions}>
    {where ? <p>{where}</p> : null}
    <p>{failed ? "Fix the cause, then run it now or wait for the next run." : missedWords(latest, zone, trigger.missedGraceMinutes, clock)}</p>
    {problems.length > 1 ? <p>{problems.length} runs had problems since {dateOnly(trigger.attention.since, zone, clock)}.</p> : null}
    {skipped ? <p>{skipped}</p> : null}
  </AlertCard>;
}
