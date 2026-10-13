import { Type, type Static } from "typebox";
import { Check } from "typebox/value";

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const LocalTimeSchema = Type.String({ pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" });
const TimeZoneSchema = Type.String({ minLength: 1, maxLength: 64 });

export const TriggerScheduleSchema = Type.Union([
  Type.Object({ kind: Type.Literal("daily"), at: LocalTimeSchema, timezone: TimeZoneSchema }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal("weekly"),
    on: Type.Array(Type.Union([
      Type.Literal(WEEKDAYS[0]), Type.Literal(WEEKDAYS[1]), Type.Literal(WEEKDAYS[2]),
      Type.Literal(WEEKDAYS[3]), Type.Literal(WEEKDAYS[4]), Type.Literal(WEEKDAYS[5]), Type.Literal(WEEKDAYS[6]),
    ]), { minItems: 1, maxItems: 7, uniqueItems: true }),
    at: LocalTimeSchema,
    timezone: TimeZoneSchema,
  }, { additionalProperties: false }),
]);
export type TriggerSchedule = Static<typeof TriggerScheduleSchema>;

export class TriggerScheduleError extends Error {}

/** Validate an untrusted schedule. The time zone must be one the host's ICU data knows, or "UTC". */
export function parseTriggerSchedule(value: unknown): TriggerSchedule {
  if (!Check(TriggerScheduleSchema, value)) throw new TriggerScheduleError("A schedule is daily or weekly, at HH:mm, in an IANA time zone.");
  wallClock(value.timezone);
  return value;
}

/**
 * The first occurrence strictly after `after` (Unix milliseconds).
 *
 * Local times follow Temporal's "compatible" disambiguation. A time that a DST change skips moves forward by the
 * length of the gap, so a daily schedule still fires once that day. A time that a DST change repeats fires at its
 * first instant only.
 */
export function nextOccurrence(schedule: TriggerSchedule, after: number): number {
  const clock = wallClock(schedule.timezone);
  const hour = Number(schedule.at.slice(0, 2));
  const minute = Number(schedule.at.slice(3, 5));
  const days = schedule.kind === "daily" ? undefined : new Set(schedule.on.map((day) => WEEKDAYS.indexOf(day)));
  const today = clock.parts(after);
  // Start one local day early: the instant of a local date can fall before `after` when the offset is large.
  for (let offset = -1; offset <= 8; offset++) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    if (days !== undefined && !days.has(date.getUTCDay())) continue;
    const instant = localInstant(clock, date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), hour, minute);
    if (instant > after) return instant;
  }
  throw new Error(`No occurrence of ${schedule.kind} schedule ${schedule.at} within eight days`);
}

const HOUR = 3_600_000;
interface WallParts { year: number; month: number; day: number; hour: number; minute: number; second: number }
interface WallClock { parts(instant: number): WallParts; offset(instant: number): number }
const clocks = new Map<string, WallClock>();

function wallClock(timezone: string): WallClock {
  const cached = clocks.get(timezone);
  if (cached !== undefined) return cached;
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, hourCycle: "h23",
      year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
    });
  } catch {
    throw new TriggerScheduleError(`Unknown time zone "${timezone}".`);
  }
  const parts = (instant: number): WallParts => {
    const values = Object.fromEntries(format.formatToParts(instant).map((part) => [part.type, Number(part.value)]));
    return { year: values["year"] ?? 0, month: values["month"] ?? 0, day: values["day"] ?? 0, hour: values["hour"] ?? 0, minute: values["minute"] ?? 0, second: values["second"] ?? 0 };
  };
  const clock: WallClock = {
    parts,
    offset: (instant) => {
      const wall = parts(instant);
      return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - Math.floor(instant / 1000) * 1000;
    },
  };
  clocks.set(timezone, clock);
  return clock;
}

function localInstant(clock: WallClock, year: number, month: number, day: number, hour: number, minute: number): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  // The offsets in force well before and well after this wall time. They differ only near a DST change.
  const before = clock.offset(wall - 18 * HOUR);
  const after = clock.offset(wall + 18 * HOUR);
  const exact = [...new Set([before, after])].map((offset) => wall - offset).filter((instant) => clock.offset(instant) === wall - instant);
  if (exact.length > 0) return Math.min(...exact);
  // A skipped wall time: keep the earlier offset, which lands the same distance past the gap.
  return wall - before;
}
