// Two fields of the shared trigger schemas have the static type `never` on this branch: `schedule.on`
// (src/shared/triggerSchedules.ts) and `action.thinkingLevel` (src/shared/triggers.ts). Each union is built with
// `array.map(Type.Literal)`, and TypeBox's `Static` of a union built from a plain array is `never`. The server branch
// fixes both. Until it merges, this file is the one place that crosses into those two fields, and it does nothing
// else. After the merge, replace each helper with the plain value: `daysOf(s)` reads `s.on`, `wireDays(d)` is `d`,
// and `wireThinkingLevel(l)` is `l`.
import type { TriggerAction } from "@shared/triggers";
import type { TriggerSchedule } from "@shared/triggerSchedules";
import { WEEK, type ThinkingLevel, type Weekday } from "./triggerValues";

type WeeklySchedule = Extract<TriggerSchedule, { kind: "weekly" }>;
type WireThinkingLevel = NonNullable<TriggerAction["thinkingLevel"]>;

/** A weekly schedule's days as the server sends them, read as the weekday strings they are. */
export function daysOf(schedule: WeeklySchedule): Weekday[] {
  const on: readonly string[] = schedule.on;
  return WEEK.filter((day) => on.includes(day));
}
/** `schedule.on` for the wire. The server checks the values. */
export const wireDays = (days: readonly Weekday[]): WeeklySchedule["on"] => days as unknown as WeeklySchedule["on"];
/** `action.thinkingLevel` for the wire. */
export const wireThinkingLevel = (level: ThinkingLevel): WireThinkingLevel => level as unknown as WireThinkingLevel;
