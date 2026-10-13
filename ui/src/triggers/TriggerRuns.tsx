import { useState } from "react";
import type { Trigger, TriggerFire } from "@shared/triggers";
import { ListSection } from "../ui/ListSection";
import { ActionRow } from "../ui/ActionRow";
import { MarkStrip } from "../ui/MarkStrip";
import { TextButton } from "../ui/TextButton";
import { firstLine, runsZone, runWhen, skippedWords, stripMarks, whenLong, type WordClock } from "./triggerWords";

const FIRST = 10;
/** "Scheduled", or "Scheduled. <error's first line>" and the earlier runs it covers: one sentence per fact. */
const detailWords = (cause: string, outcome: TriggerFire["outcome"], skipped: string | undefined) => {
  const more = [outcome.kind === "failed" ? firstLine(outcome.error) : undefined, skipped].filter(Boolean);
  return more.length ? `${cause}. ${more.join(" ")}` : cause;
};
const STATUS: Record<TriggerFire["outcome"]["kind"], string> = { started: "Started", failed: "Failed", missed: "Missed", running: "Starting…" };

/**
 * Shape: one row per run, newest first: when it was due, how it went, why it
 * ran, and the session it opened. The first ten show; the rest wait behind
 * Show all.
 */
export function TriggerRuns({ trigger, clock, starting, narrow = false, onOpenSession }: {
  trigger: Trigger; clock: WordClock; starting: boolean;
  /** A narrow column: each run's status goes under its time. */
  narrow?: boolean | undefined;
  onOpenSession: (session: { id: string; cwd: string }) => void;
}) {
  const [all, setAll] = useState(false);
  const zone = trigger.schedule.timezone;
  const history = trigger.history;
  const shown = all ? history : history.slice(0, FIRST);
  const empty = trigger.state.kind === "active" ? `No runs yet. The first run is ${whenLong(trigger.state.nextFireAt, zone, clock)}.` : "No runs yet.";
  return <ListSection title="Runs" placement="document" aside={history.length ? <><span>{history.length}</span>
    <MarkStrip marks={stripMarks(history, starting && history[0]?.outcome.kind !== "running")} limit={14} />
    {runsZone(zone, clock) ? <span>{runsZone(zone, clock)}</span> : null}</> : undefined}
    empty={empty} note={history.length ? "Forgerie keeps the last 50 runs." : undefined}
    foot={history.length > FIRST ? <TextButton label={all ? "Show fewer" : `Show all ${String(history.length)}`} onPress={() => setAll(!all)} /> : undefined}>
    {shown.map((fire) => {
      const outcome = fire.outcome;
      const session = outcome.kind === "started" ? { id: outcome.sessionId, cwd: outcome.cwd }
        : outcome.kind === "failed" && outcome.sessionId && outcome.cwd ? { id: outcome.sessionId, cwd: outcome.cwd } : undefined;
      const cause = fire.cause === "manual" ? "Run now" : "Scheduled";
      const skipped = skippedWords(fire.skippedBefore);
      return <ActionRow key={fire.requestId} layout={narrow ? "stacked" : "head"} name={runWhen(fire.occurrence, zone, clock)} status={STATUS[outcome.kind]}
        tone={outcome.kind === "failed" ? "danger" : undefined}
        detail={<span title={outcome.kind === "failed" ? outcome.error : undefined}>{detailWords(cause, outcome, skipped)}</span>}
        actions={session ? <TextButton label="Open session" onPress={() => onOpenSession(session)} /> : undefined} />;
    })}
  </ListSection>;
}
