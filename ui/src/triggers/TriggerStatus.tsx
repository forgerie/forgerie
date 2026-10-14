import type { Trigger } from "@shared/triggers";
import { ReadoutLine } from "../ui/ReadoutLine";
import { TextButton } from "../ui/TextButton";
import { dateOnly, lastRunWords, nextIfResumed, relativeLong, whenLong, type WordClock } from "./triggerWords";
import { isSpreadFire, type ProjectName } from "./triggerTargets";
import { FireProjects } from "./FireProjects";

/**
 * Shape: where the trigger stands, in sentences: who made it when an agent
 * did, when it runs next (or would, if resumed), and how its last run went,
 * with the session that run opened one press away. A run in several projects
 * counts them and lists each project's outcome under the line.
 */
export function TriggerStatus({ trigger, clock, starting, creatorName, projectName, narrow = false, onPause, onResume, onOpenSession }: {
  trigger: Trigger; clock: WordClock;
  projectName: ProjectName;
  /** A narrow column: each project's status goes under its name. */
  narrow?: boolean | undefined;
  /** A Run now from this browser that the history does not show yet. */
  starting: boolean;
  /** The name of the session whose agent made the trigger, when the session list knows it. */
  creatorName?: string | undefined;
  onPause: () => void; onResume: () => void;
  onOpenSession: (session: { id: string; cwd: string }) => void;
}) {
  const zone = trigger.schedule.timezone;
  const creator = trigger.createdBy.kind === "agent" ? trigger.createdBy : undefined;
  const latest = trigger.history[0];
  const outcome = latest?.outcome;
  const spread = latest !== undefined && isSpreadFire(latest);
  // One project: its session is one press away on the line. Several: each project's row has its own.
  const session = spread ? undefined : outcome?.kind === "started" ? { id: outcome.sessionId, cwd: outcome.cwd }
    : outcome?.kind === "failed" && outcome.sessionId && outcome.cwd ? { id: outcome.sessionId, cwd: outcome.cwd } : undefined;
  const resumed = trigger.state.kind === "paused" ? nextIfResumed(trigger, clock.now) : undefined;
  return <div>
    {creator ? <ReadoutLine action={<TextButton label="Open the agent's session" onPress={() => onOpenSession({ id: creator.sessionId, cwd: creator.cwd })} />}>
      An agent made this trigger in {creatorName ? `“${creatorName}”` : "another session"}.
    </ReadoutLine> : null}
    {trigger.state.kind === "active"
      ? <ReadoutLine action={<TextButton label="Pause" onPress={onPause} />}>
        Next run {whenLong(trigger.state.nextFireAt, zone, clock)}, {relativeLong(trigger.state.nextFireAt, clock.now)}.
      </ReadoutLine>
      : <ReadoutLine action={<TextButton label="Resume" onPress={onResume} />}>
        Paused since {dateOnly(trigger.state.pausedAt, zone, clock)}.{resumed === undefined ? null : ` If you resume now, the next run is ${whenLong(resumed, zone, clock)}.`}
      </ReadoutLine>}
    {starting && outcome?.kind !== "running"
      ? <ReadoutLine>Starting… Its session shows under Runs once it opens.</ReadoutLine>
      : <>
        <ReadoutLine action={session ? <TextButton label="Open session" onPress={() => onOpenSession(session)} /> : undefined}>
          {lastRunWords(latest, zone, clock)}
        </ReadoutLine>
        {spread ? <FireProjects fire={latest} projectName={projectName} narrow={narrow} onOpenSession={onOpenSession} /> : null}
      </>}
  </div>;
}
