import { useState } from "react";
import type { Trigger, TriggerFire } from "@shared/triggers";
import { ListSection } from "../ui/ListSection";
import { ActionRow } from "../ui/ActionRow";
import { MarkStrip } from "../ui/MarkStrip";
import { TextButton } from "../ui/TextButton";
import { triggerFireSummary } from "@shared/triggers";
import { firstLine, runsZone, runWhen, skippedWords, stripMarks, whenLong, type WordClock } from "./triggerWords";
import { fireCountWords, isSpread, isSpreadFire, PROJECT_STATUS, type ProjectName } from "./triggerTargets";
import { FireProjects } from "./FireProjects";
import { failingWhileRunning } from "./triggersModel";

const FIRST = 10;
/** "Scheduled", or "Scheduled. <error's first line>" and the earlier runs it covers: one sentence per fact. */
const detailWords = (cause: string, outcome: TriggerFire["outcome"], skipped: string | undefined) => {
  const more = [outcome.kind === "failed" ? firstLine(outcome.error) : outcome.kind === "unavailable" ? firstLine(outcome.reason) : undefined, skipped].filter(Boolean);
  return more.length ? `${cause}. ${more.join(" ")}` : cause;
};
/** A run in several projects: "3 of 4 started" as its status, and what else happened in its detail. */
function spreadWords(fire: TriggerFire, cause: string, skipped: string | undefined) {
  const summary = triggerFireSummary(fire);
  // Still starting in some projects: what has settled so far goes in the detail, so a failure shows at once.
  if (fire.outcome.kind === "running") return { status: "Starting…", detail: summary.running < summary.total ? `${cause}. ${fireCountWords(fire)}.` : cause };
  if (fire.outcome.kind === "missed") return { status: "Missed", detail: [cause, skipped].filter(Boolean).join(". ") };
  const rest = ([["failed", summary.failed], ["unavailable", summary.unavailable], ["missed", summary.missed]] as const)
    .filter(([, count]) => count > 0).map(([word, count]) => `${String(count)} ${word}`);
  const facts = [rest.length ? `${rest.join(", ")}.` : undefined, skipped].filter(Boolean);
  return { status: `${String(summary.started)} of ${String(summary.total)} started`, detail: facts.length ? `${cause}. ${facts.join(" ")}` : cause };
}

/**
 * Shape: one row per run, newest first: when it was due, how it went, why it
 * ran, and the session it opened. A run in several projects counts them, and
 * Projects opens each project's outcome under it. The first ten show; the rest
 * wait behind Show all.
 */
export function TriggerRuns({ trigger, clock, starting, projectName, narrow = false, onOpenSession }: {
  trigger: Trigger; clock: WordClock; starting: boolean;
  projectName: ProjectName;
  /** A narrow column: each run's status goes under its time. */
  narrow?: boolean | undefined;
  onOpenSession: (session: { id: string; cwd: string }) => void;
}) {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
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
      // A trigger with several projects that ran in one, such as a Run now in one project, names that project.
      const only = isSpread(trigger.action.targets) && fire.projects.length === 1 ? fire.projects[0]?.cwd : undefined;
      const cause = `${fire.cause === "manual" ? "Run now" : "Scheduled"}${only ? ` in ${projectName(only)}` : ""}`;
      const skipped = skippedWords(fire.skippedBefore);
      const name = runWhen(fire.occurrence, zone, clock);
      if (isSpreadFire(fire)) {
        const words = spreadWords(fire, cause, skipped);
        const shown = open.has(fire.requestId);
        return <ActionRow key={fire.requestId} layout={narrow ? "stacked" : "head"} name={name} status={words.status}
          tone={outcome.kind === "failed" || failingWhileRunning(fire) ? "danger" : undefined} detail={words.detail}
          actions={<TextButton label="Projects" title={`Each project's outcome on ${name}`} pressed={shown} onPress={() => toggle(fire.requestId)} />}
          below={shown ? <FireProjects fire={fire} projectName={projectName} narrow={narrow} onOpenSession={onOpenSession} /> : undefined} />;
      }
      return <ActionRow key={fire.requestId} layout={narrow ? "stacked" : "head"} name={name} status={PROJECT_STATUS[outcome.kind]}
        tone={outcome.kind === "failed" ? "danger" : outcome.kind === "unavailable" ? "quiet" : undefined}
        detail={<span title={outcome.kind === "failed" ? outcome.error : undefined}>{detailWords(cause, outcome, skipped)}</span>}
        actions={session ? <TextButton label="Open session" onPress={() => onOpenSession(session)} /> : undefined} />;
    })}
  </ListSection>;
}
