import { describe, expect, it } from "vitest";
import { nextOccurrence, parseTriggerSchedule, TriggerScheduleError } from "./triggerSchedules.js";

const iso = (value: number) => new Date(value).toISOString();
const at = (value: string) => Date.parse(value);

describe("nextOccurrence", () => {
  it("returns today's time when it is still ahead, otherwise tomorrow's", () => {
    const nightly = parseTriggerSchedule({ kind: "daily", at: "03:00", timezone: "America/Denver" });
    // 03:00 MDT is 09:00Z.
    expect(iso(nextOccurrence(nightly, at("2026-10-12T08:59:00Z")))).toBe("2026-10-12T09:00:00.000Z");
    expect(iso(nextOccurrence(nightly, at("2026-10-12T16:00:00Z")))).toBe("2026-10-13T09:00:00.000Z");
  });

  it("is strictly after its argument, so feeding an occurrence back gives the next one", () => {
    const nightly = parseTriggerSchedule({ kind: "daily", at: "03:00", timezone: "UTC" });
    const first = nextOccurrence(nightly, at("2026-10-12T00:00:00Z"));
    expect(iso(first)).toBe("2026-10-12T03:00:00.000Z");
    expect(iso(nextOccurrence(nightly, first))).toBe("2026-10-13T03:00:00.000Z");
  });

  it("uses the local date of the time zone, not of UTC", () => {
    const morning = parseTriggerSchedule({ kind: "daily", at: "09:00", timezone: "Asia/Tokyo" });
    // 2026-10-12T23:30Z is already 08:30 on 2026-10-13 in Tokyo.
    expect(iso(nextOccurrence(morning, at("2026-10-12T23:30:00Z")))).toBe("2026-10-13T00:00:00.000Z");
  });

  it("fires weekly schedules only on the listed weekdays", () => {
    const weekdays = parseTriggerSchedule({ kind: "weekly", on: ["mon", "tue", "wed", "thu", "fri"], at: "03:00", timezone: "UTC" });
    // 2026-10-16 is a Friday. The next weekday is Monday 2026-10-19.
    expect(iso(nextOccurrence(weekdays, at("2026-10-16T04:00:00Z")))).toBe("2026-10-19T03:00:00.000Z");
    const sundays = parseTriggerSchedule({ kind: "weekly", on: ["sun"], at: "12:00", timezone: "UTC" });
    expect(iso(nextOccurrence(sundays, at("2026-10-18T12:00:00Z")))).toBe("2026-10-25T12:00:00.000Z");
  });

  it("moves a time that spring-forward skips past the gap and still fires that day", () => {
    const night = parseTriggerSchedule({ kind: "daily", at: "02:30", timezone: "America/New_York" });
    // 2026-03-08 02:00 EST jumps to 03:00 EDT. 02:30 becomes 03:30 EDT, which is 07:30Z.
    expect(iso(nextOccurrence(night, at("2026-03-08T00:00:00Z")))).toBe("2026-03-08T07:30:00.000Z");
    expect(iso(nextOccurrence(night, at("2026-03-08T07:30:00Z")))).toBe("2026-03-09T06:30:00.000Z");
  });

  it("fires a time that fall-back repeats only at its first instant", () => {
    const night = parseTriggerSchedule({ kind: "daily", at: "01:30", timezone: "America/New_York" });
    // 2026-11-01 01:30 happens at 05:30Z (EDT) and again at 06:30Z (EST).
    const first = nextOccurrence(night, at("2026-11-01T00:00:00Z"));
    expect(iso(first)).toBe("2026-11-01T05:30:00.000Z");
    expect(iso(nextOccurrence(night, first))).toBe("2026-11-02T06:30:00.000Z");
  });
});

describe("parseTriggerSchedule", () => {
  it.each([
    { kind: "daily", at: "24:00", timezone: "UTC" },
    { kind: "daily", at: "3:00", timezone: "UTC" },
    { kind: "weekly", on: [], at: "03:00", timezone: "UTC" },
    { kind: "weekly", on: ["mon", "mon"], at: "03:00", timezone: "UTC" },
    { kind: "daily", at: "03:00", timezone: "Mars/Olympus_Mons" },
    { kind: "hourly", at: "03:00", timezone: "UTC" },
  ])("rejects %j", (input) => {
    expect(() => parseTriggerSchedule(input)).toThrow(TriggerScheduleError);
  });
});
