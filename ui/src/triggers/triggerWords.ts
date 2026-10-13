// The triggers screen's words: schedules, times, outcomes, and the run strip.
// Pure. Every function takes the clock and the zones it needs, so a test or a
// part fixes them. Copy talks about times and runs, never cron words.
import type { Trigger, TriggerFire } from "@shared/triggers";
import { nextOccurrence, type TriggerSchedule } from "@shared/triggerSchedules";
import { WEEK, type Weekday } from "./triggerValues";
import { daysOf, wireDays } from "./triggerWire";

/** What every time word needs: the instant now, the browser's locale and zone, and the host's zone. */
export interface WordClock {
  now: number;
  /** Absent: the browser's own locale. */
  locale?: string | undefined;
  /** The browser's zone. A time in another zone names its zone. */
  browserZone: string;
  /** The daemon host's zone: a schedule in another zone names its zone. */
  hostZone: string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
export { WEEK, type Weekday };
export const DAY_SHORT: Record<Weekday, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const DAY_PLURAL: Record<Weekday, string> = { mon: "Mondays", tue: "Tuesdays", wed: "Wednesdays", thu: "Thursdays", fri: "Fridays", sat: "Saturdays", sun: "Sundays" };

const formats = new Map<string, Intl.DateTimeFormat>();
function format(locale: string | undefined, zone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale ?? ""}|${zone}|${JSON.stringify(options)}`;
  let found = formats.get(key);
  if (!found) {
    try { found = new Intl.DateTimeFormat(locale, { ...options, timeZone: zone }); }
    catch { found = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }); }
    formats.set(key, found);
  }
  return found;
}
const TIME: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
const part = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";

/** "3:00 AM" for "03:00", in the browser's locale. */
export function timeOfDay(at: string, locale?: string): string {
  const [hour, minute] = at.split(":").map(Number);
  return format(locale, "UTC", TIME).format(Date.UTC(2026, 0, 5, hour ?? 0, minute ?? 0));
}

/** "New York (America/New_York)" for the zone chip and its options; "UTC" for UTC. */
export function zoneLabel(zone: string): string {
  if (zone === "UTC" || zone === "Etc/UTC") return zone;
  const city = (zone.split("/").at(-1) ?? zone).replaceAll("_", " ");
  return city === zone ? zone : `${city} (${zone})`;
}

/** "New York time" for America/New_York, "UTC" for UTC. */
export function zoneWords(zone: string): string {
  if (zone === "UTC" || zone === "Etc/UTC") return "UTC";
  return `${(zone.split("/").at(-1) ?? zone).replaceAll("_", " ")} time`;
}

/** The days a schedule runs on, Monday first. */
export function scheduleDays(schedule: TriggerSchedule): Weekday[] {
  return schedule.kind === "daily" ? [...WEEK] : daysOf(schedule);
}
/** A schedule from the form's choices. Seven days, or none chosen yet, is every day. */
export function scheduleOf(days: readonly string[], at: string, timezone: string): TriggerSchedule {
  const on = WEEK.filter((day) => days.includes(day));
  if (on.length === 0 || on.length === 7) return { kind: "daily", at, timezone };
  return { kind: "weekly", at, timezone, on: wireDays(on) };
}

const listWords = (items: readonly string[]) => items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")}, and ${items.at(-1) ?? ""}`;
const isNight = (at: string) => at >= "21:00" || at < "05:00";

/** "Every night at 3:00 AM", "Weekdays at 9:00 AM", "Sundays at 4:00 AM New York time". */
export function scheduleWords(schedule: TriggerSchedule, hostZone: string, locale?: string): string {
  const time = timeOfDay(schedule.at, locale);
  const zone = schedule.timezone === hostZone ? "" : ` ${zoneWords(schedule.timezone)}`;
  const days = scheduleDays(schedule);
  const set = days.join(",");
  const words = days.length === 7 ? `${isNight(schedule.at) ? "Every night" : "Every day"} at ${time}`
    : set === "mon,tue,wed,thu,fri" ? `Weekdays at ${time}`
    : set === "sat,sun" ? `Weekends at ${time}`
    : days.length === 1 ? `${DAY_PLURAL[days[0] ?? "mon"]} at ${time}`
    : `${listWords(days.map((day) => DAY_SHORT[day]))} at ${time}`;
  return `${words}${zone}`;
}

/** "in 25 min", "in 9 h", "in 4 d", "due now": the row's time slot. */
export function relativeShort(target: number, now: number): string {
  const left = target - now;
  if (left <= MINUTE) return "due now";
  const minutes = Math.ceil(left / MINUTE);
  if (minutes < 60) return `in ${String(minutes)} min`;
  const hours = Math.round(left / HOUR);
  if (hours < 24) return `in ${String(hours)} h`;
  return `in ${String(Math.round(left / DAY))} d`;
}

/** "in 9 hours", "in 1 minute": the page's status line. */
export function relativeLong(target: number, now: number): string {
  const left = target - now;
  if (left <= MINUTE) return "now";
  const unit = (count: number, word: string) => `in ${String(count)} ${word}${count === 1 ? "" : "s"}`;
  const minutes = Math.ceil(left / MINUTE);
  if (minutes < 60) return unit(minutes, "minute");
  const hours = Math.round(left / HOUR);
  if (hours < 24) return unit(hours, "hour");
  return unit(Math.round(left / DAY), "day");
}

/** The parts of one instant in one zone. A zone that is not the browser's names itself after the time. */
function instant(ms: number, zone: string, clock: WordClock) {
  const parts = format(clock.locale, zone, { weekday: "short", month: "short", day: "numeric", ...TIME }).formatToParts(ms);
  const time = format(clock.locale, zone, TIME).format(ms);
  const suffix = zone === clock.browserZone ? "" : ` ${zoneWords(zone)}`;
  return { weekday: part(parts, "weekday"), date: `${part(parts, "month")} ${part(parts, "day")}`, time: `${time}${suffix}` };
}

/** "Tue, Oct 13 at 3:00 AM". */
export function whenLong(ms: number, zone: string, clock: WordClock): string {
  const { weekday, date, time } = instant(ms, zone, clock);
  return `${weekday}, ${date} at ${time}`;
}
/** "Oct 12, 3:00 AM". */
export function whenShort(ms: number, zone: string, clock: WordClock): string {
  const { date, time } = instant(ms, zone, clock);
  return `${date}, ${time}`;
}
/** "Oct 12 at 3:00 AM". */
export function whenAt(ms: number, zone: string, clock: WordClock): string {
  const { date, time } = instant(ms, zone, clock);
  return `${date} at ${time}`;
}
/** "Tue, Oct 12, 3:00 AM": a run's name in the Runs list. The list names the zone once, in its heading. */
export function runWhen(ms: number, zone: string, clock: WordClock): string {
  const { weekday, date, time } = instant(ms, zone, { ...clock, browserZone: zone });
  return `${weekday}, ${date}, ${time}`;
}
/** "New York time" when the trigger's zone is not the browser's: said once, in the Runs heading. */
export function runsZone(zone: string, clock: WordClock): string | undefined {
  return zone === clock.browserZone ? undefined : zoneWords(zone);
}
/** "Oct 12". */
export function dateOnly(ms: number, zone: string, clock: WordClock): string {
  return instant(ms, zone, clock).date;
}
/** "3:00 AM", with the zone when it is not the browser's. */
export function timeOnly(ms: number, zone: string, clock: WordClock): string {
  return instant(ms, zone, clock).time;
}

export function firstLine(text: string): string {
  return text.split("\n").map((line) => line.trim()).find(Boolean) ?? text.trim();
}

/** The row's last outcome line. */
export function outcomeWords(fire: TriggerFire | undefined, zone: string, clock: WordClock): string {
  if (!fire) return "No runs yet";
  const outcome = fire.outcome;
  if (outcome.kind === "running") return "Starting…";
  if (outcome.kind === "started") return `Started ${whenShort(fire.occurrence, zone, clock)}${fire.cause === "manual" ? " by Run now" : ""}`;
  if (outcome.kind === "failed") return `Failed ${dateOnly(fire.occurrence, zone, clock)}: ${firstLine(outcome.error)}`;
  return `Missed ${whenShort(fire.occurrence, zone, clock)}`;
}

/** "6 hours", "1 day", "90 min". */
export function graceWords(minutes: number): string {
  if (minutes <= 0) return "Never";
  if (minutes % 1440 === 0) return `${String(minutes / 1440)} ${minutes === 1440 ? "day" : "days"}`;
  if (minutes % 60 === 0) return `${String(minutes / 60)} ${minutes === 60 ? "hour" : "hours"}`;
  return `${String(minutes)} min`;
}

/** The Run late field's hint. */
export function runLateHint(at: string, grace: number, locale?: string): string {
  const time = timeOfDay(at, locale);
  if (grace <= 0) return `If Forgerie is off at ${time}, the run is recorded as missed.`;
  return `If Forgerie is off at ${time}, the run starts when it is back, up to ${graceWords(grace)} late. After that, the run is recorded as missed.`;
}

/** From 01:00 to 02:59 a clock change can skip or repeat the time. */
export function clockChangeHint(at: string): string | undefined {
  return at >= "01:00" && at < "03:00"
    ? "Clocks change at this hour on some nights. On those nights Forgerie runs once, at the nearest valid time." : undefined;
}

export type MarkTone = "plain" | "bad" | "warn" | "live";
export function fireTone(fire: TriggerFire): MarkTone {
  switch (fire.outcome.kind) {
    case "started": return "plain";
    case "failed": return "bad";
    case "missed": return "warn";
    case "running": return "live";
  }
}

/** The run strip, oldest first. A Run now that has no history entry yet ends it as a live mark. */
export function stripMarks(history: readonly TriggerFire[], starting: boolean): MarkTone[] {
  const marks = [...history].reverse().map(fireTone);
  return starting ? [...marks, "live"] : marks;
}

/** "Last 7 runs: 5 started, 2 failed." */
export function stripWords(history: readonly TriggerFire[]): string {
  if (history.length === 0) return "No runs yet.";
  const count = (kind: TriggerFire["outcome"]["kind"]) => history.filter((fire) => fire.outcome.kind === kind).length;
  const parts = ([["started", "started"], ["failed", "failed"], ["missed", "missed"], ["running", "starting"]] as const)
    .map(([kind, word]) => [count(kind), word] as const).filter(([value]) => value > 0).map(([value, word]) => `${String(value)} ${word}`);
  return `Last ${history.length === 1 ? "run" : `${String(history.length)} runs`}: ${parts.join(", ")}.`;
}

/** The next run if the trigger were resumed now. */
export function nextIfResumed(trigger: Trigger, now: number): number | undefined {
  try { return nextOccurrence(trigger.schedule, now); } catch { return undefined; }
}

/** The row's accessible name: the strip in words. */
export function rowLabel(trigger: Trigger, clock: WordClock): string {
  const next = trigger.state.kind === "active" ? `Next run ${relativeLong(trigger.state.nextFireAt, clock.now)}.` : "Paused.";
  return `${trigger.name}. ${scheduleWords(trigger.schedule, clock.hostZone, clock.locale)}. ${next} ${stripWords(trigger.history)}`;
}

/**
 * A Run now the browser started. `recordedId` is the request ID the server's 202 answer returned: the one its
 * history entry carries. The browser cannot build it from its own request ID, so it never tries.
 */
export interface PendingRun { triggerId: string; recordedId: string }
/** The run's history entry has arrived (running or done), so the history shows it from here on. */
export function runRecorded(trigger: Trigger, pending: PendingRun): boolean {
  return trigger.history.some((fire) => fire.requestId === pending.recordedId);
}

/** "Also covers 2 earlier runs that passed while Forgerie was off." */
export function skippedWords(count: number): string | undefined {
  if (count <= 0) return undefined;
  return count === 1 ? "Also covers 1 earlier run that passed while Forgerie was off."
    : `Also covers ${String(count)} earlier runs that passed while Forgerie was off.`;
}

/** The status line about the last run. */
export function lastRunWords(fire: TriggerFire | undefined, zone: string, clock: WordClock): string {
  if (!fire) return "No runs yet.";
  const when = `Last run ${whenAt(fire.occurrence, zone, clock)}`;
  switch (fire.outcome.kind) {
    case "running": return `${when} is starting.`;
    case "started": return `${when} started a session.`;
    case "failed": return `${when} failed.`;
    case "missed": return `${when} was missed.`;
  }
}

/** Why a missed run did not start late. */
export function missedWords(fire: TriggerFire, zone: string, grace: number, clock: WordClock): string {
  const time = timeOnly(fire.occurrence, zone, clock);
  return grace <= 0 ? `Forgerie was not running at ${time}, and this trigger does not run late, so the run did not start.`
    : `Forgerie was not running at ${time} and came back more than ${graceWords(grace)} later, so the run did not start late.`;
}

/** The store is unavailable (503): what is wrong, what stops, and what to do. */
export function storeOffWords(message: string): string {
  const sentence = message.trim().replace(/\.+$/u, "");
  return `Triggers are off. ${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}. No trigger runs until sessiond can open its store. Check the sessiond log, then restart sessiond.`;
}
