// The values a trigger's form chooses from that the shared schema does not name as types: weekdays in the order the
// day buttons and the schedule words read them, and the thinking levels this app knows.
import { KNOWN_THINKING_LEVELS } from "../newSession";

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
/** Monday first, as the day buttons and the schedule words read. */
export const WEEK: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export type ThinkingLevel = (typeof KNOWN_THINKING_LEVELS)[number];

/** A thinking level the browser knows, or nothing. */
export function thinkingLevelOf(value: unknown): ThinkingLevel | undefined {
  return KNOWN_THINKING_LEVELS.find((level) => level === value);
}
