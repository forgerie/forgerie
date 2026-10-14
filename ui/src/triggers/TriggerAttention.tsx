import type { Trigger } from "@shared/triggers";
import { AlertCard, type AlertAction } from "../ui/AlertCard";
import { problemsSince, projectProblemsSince } from "./triggersModel";
import { dateOnly, missedWords, skippedWords, whenShort, type WordClock } from "./triggerWords";
import { fireCountWords, isSpreadFire, listWords, type ProjectName } from "./triggerTargets";

/**
 * Shape: the newest failed or missed run since the trigger last needed a look,
 * and the two ways forward. It stays until the reader marks it as seen:
 * opening the page, editing, or running now does not clear it. A run in
 * several projects names the projects that failed; the error shown is the
 * newest unseen one's.
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
  // A fire's summary can still name an acknowledged failure. Use its newest unseen project instead.
  const unseen = projectProblemsSince(latest, trigger.attention.since);
  const newest = unseen[0];
  const running = latest.outcome.kind === "running";
  const failed = newest?.outcome.kind === "failed" ? { ...newest.outcome, cwd: newest.cwd } : undefined;
  const when = whenShort(latest.occurrence, zone, clock);
  const skipped = skippedWords(latest.skippedBefore);
  const actions: AlertAction[] = [
    { label: "Mark as seen", onPress: onAcknowledge },
    { label: "Run now…", onPress: onRunNow },
    ...failed?.sessionId && failed.cwd ? [{ label: "Open session", onPress: () => onOpenSession({ id: failed.sessionId ?? "", cwd: failed.cwd ?? "" }) }] : [],
  ];
  const spread = isSpreadFire(latest);
  const failedIn = unseen.filter((item) => item.outcome.kind === "failed").map((item) => projectName(item.cwd));
  const stillStarting = latest.projects.filter((item) => item.outcome.kind === "running").length;
  const where = spread && failed && failedIn.length > 0
    ? `Failed in ${listWords(failedIn)}: ${fireCountWords(latest)}.${failedIn.length > 1 ? ` The error below is from ${failedIn[0] ?? ""}.` : ""}` : undefined;
  const next = running
    ? `${stillStarting === 1 ? "1 project is" : `${String(stillStarting)} projects are`} still starting. Fix the cause, then run it now in the failed project or wait for the next run.`
    : "Fix the cause, then run it now or wait for the next run.";
  return <AlertCard tone={failed ? "bad" : "warn"} label={failed ? "Run failed" : "Run missed"} subject={failed ? "Failed" : "Missed"}
    title={when}
    code={failed?.error} codeLabel="Error" codeLines={errorLines} actions={actions}>
    {where ? <p>{where}</p> : null}
    <p>{failed ? next : missedWords(latest, zone, trigger.missedGraceMinutes, clock)}</p>
    {problems.length > 1 ? <p>{problems.length} runs had problems since {dateOnly(trigger.attention.since, zone, clock)}.</p> : null}
    {skipped ? <p>{skipped}</p> : null}
  </AlertCard>;
}
