// Two fields of the shared trigger schemas have the static type `never`:
// `schedule.on` (src/shared/triggerSchedules.ts) and `action.thinkingLevel`
// (src/shared/triggers.ts). Each union is built with `array.map(Type.Literal)`,
// and TypeBox's `Static` of a union built from a plain array is `never`. The
// server branch fixes the schemas. Until it lands, the browser types both
// fields from its own lists here, and this file is the one place that crosses
// into the wire types. Delete it when the shared types are right.
import type { TriggerAction } from "@shared/triggers";
import type { TriggerSchedule } from "@shared/triggerSchedules";
import { KNOWN_THINKING_LEVELS } from "../newSession";

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
/** Monday first, as the day buttons and the schedule words read. */
export const WEEK: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export type ThinkingLevel = (typeof KNOWN_THINKING_LEVELS)[number];

type WeeklySchedule = Extract<TriggerSchedule, { kind: "weekly" }>;
type WireThinkingLevel = NonNullable<TriggerAction["thinkingLevel"]>;

/** A weekly schedule's days as the server sends them, read as the weekday strings they are. */
export function daysOf(schedule: WeeklySchedule): Weekday[] {
  const on: readonly string[] = schedule.on;
  return WEEK.filter((day) => on.includes(day));
}
/** Days for the wire. The server checks the values. */
export const wireDays = (days: readonly Weekday[]): WeeklySchedule["on"] => days as unknown as WeeklySchedule["on"];

/** A thinking level the browser knows, or nothing. */
export function thinkingLevelOf(value: unknown): ThinkingLevel | undefined {
  return KNOWN_THINKING_LEVELS.find((level) => level === value);
}
/** A thinking level for the wire. */
export const wireThinkingLevel = (level: ThinkingLevel): WireThinkingLevel => level as unknown as WireThinkingLevel;
