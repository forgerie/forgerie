import { describe, expect, it } from "vitest";
import type { TriggerFire } from "@shared/triggers";
import type { TriggerSchedule } from "@shared/triggerSchedules";
import {
  clockChangeHint, graceWords, lastRunWords, missedWords, nextIfResumed, outcomeWords, relativeLong, relativeShort, rowLabel, runLateHint, runRecorded,
  scheduleOf, scheduleWords, skippedWords, storeOffWords, stripMarks, stripWords, whenLong, whenShort, zoneLabel, type WordClock,
} from "./triggerWords";
import { digest, docs, HOST_ZONE, NOW, nightly, serverRunId, triage } from "./fixtures/triggers";

const LOCALE = "en-US";
const clock: WordClock = { now: NOW, locale: LOCALE, browserZone: HOST_ZONE, hostZone: HOST_ZONE };
const daily = (at: string, timezone = HOST_ZONE): TriggerSchedule => ({ kind: "daily", at, timezone });
const weekly = (days: string[], at = "09:00") => scheduleOf(days, at, HOST_ZONE);

describe("schedule words", () => {
  it("says night from 21:00 to 04:59 and day otherwise", () => {
    expect(scheduleWords(daily("04:59"), HOST_ZONE, LOCALE)).toBe("Every night at 4:59 AM");
    expect(scheduleWords(daily("05:00"), HOST_ZONE, LOCALE)).toBe("Every day at 5:00 AM");
    expect(scheduleWords(daily("20:59"), HOST_ZONE, LOCALE)).toBe("Every day at 8:59 PM");
    expect(scheduleWords(daily("21:00"), HOST_ZONE, LOCALE)).toBe("Every night at 9:00 PM");
  });
  it("names each set of weekdays", () => {
    expect(scheduleWords(weekly(["mon", "tue", "wed", "thu", "fri"]), HOST_ZONE, LOCALE)).toBe("Weekdays at 9:00 AM");
    expect(scheduleWords(weekly(["sat", "sun"], "10:00"), HOST_ZONE, LOCALE)).toBe("Weekends at 10:00 AM");
    expect(scheduleWords(weekly(["mon"]), HOST_ZONE, LOCALE)).toBe("Mondays at 9:00 AM");
    expect(scheduleWords(weekly(["fri", "mon", "wed"]), HOST_ZONE, LOCALE)).toBe("Mon, Wed, and Fri at 9:00 AM");
    expect(scheduleWords(weekly(["sun", "thu"]), HOST_ZONE, LOCALE)).toBe("Thu and Sun at 9:00 AM");
  });
  it("reads all seven days as daily, and saves them as daily", () => {
    expect(weekly(["mon", "tue", "wed", "thu", "fri", "sat", "sun"], "03:00")).toEqual(daily("03:00"));
    expect(scheduleWords({ kind: "weekly", at: "03:00", timezone: HOST_ZONE, on: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as never[] }, HOST_ZONE, LOCALE))
      .toBe("Every night at 3:00 AM");
  });
  it("words the store being off as two sentences", () => {
    expect(storeOffWords("database is locked.")).toBe("Triggers are off. Database is locked. No trigger runs until sessiond can open its store. Check the sessiond log, then restart sessiond.");
  });
  it("labels a zone chip by its city and its name", () => {
    expect(zoneLabel("America/New_York")).toBe("New York (America/New_York)");
    expect(zoneLabel("America/Argentina/Buenos_Aires")).toBe("Buenos Aires (America/Argentina/Buenos_Aires)");
    expect(zoneLabel("UTC")).toBe("UTC");
  });
  it("names a zone that is not the host's", () => {
    expect(scheduleWords(daily("03:00", "America/New_York"), HOST_ZONE, LOCALE)).toBe("Every night at 3:00 AM New York time");
    expect(scheduleWords(daily("03:00", "UTC"), HOST_ZONE, LOCALE)).toBe("Every night at 3:00 AM UTC");
    expect(scheduleWords(daily("03:00", HOST_ZONE), HOST_ZONE, LOCALE)).toBe("Every night at 3:00 AM");
  });
});

describe("times", () => {
  it("counts down in the row's short words", () => {
    expect(relativeShort(NOW + 9 * 3_600_000, NOW)).toBe("in 9 h");
    expect(relativeShort(NOW + 25 * 60_000, NOW)).toBe("in 25 min");
    expect(relativeShort(NOW + 4 * 86_400_000, NOW)).toBe("in 4 d");
    expect(relativeShort(NOW + 30_000, NOW)).toBe("due now");
    expect(relativeLong(NOW + 9 * 3_600_000, NOW)).toBe("in 9 hours");
    expect(relativeLong(NOW + 3_600_000, NOW)).toBe("in 1 hour");
  });
  it("writes absolute times in the trigger's zone, naming it when it is not the browser's", () => {
    const next = nightly.state.kind === "active" ? nightly.state.nextFireAt : 0;
    expect(whenLong(next, HOST_ZONE, clock)).toBe("Tue, Oct 13 at 3:00 AM");
    expect(whenLong(next, HOST_ZONE, { ...clock, browserZone: "Europe/Berlin" })).toBe("Tue, Oct 13 at 3:00 AM Denver time");
    expect(whenShort(Date.UTC(2026, 9, 4, 8), "America/New_York", clock)).toBe("Oct 4, 4:00 AM New York time");
  });
  it("gives a paused trigger the time it would run if resumed now", () => {
    expect(whenLong(nextIfResumed(docs, NOW) ?? 0, "America/New_York", clock)).toBe("Sun, Oct 18 at 4:00 AM New York time");
  });
});

describe("outcomes", () => {
  const [failed, , started, manual, , missed] = nightly.history as [TriggerFire, TriggerFire, TriggerFire, TriggerFire, TriggerFire, TriggerFire];
  it("says how the last run went", () => {
    expect(outcomeWords(started, HOST_ZONE, clock)).toBe("Started Oct 10, 3:00 AM");
    expect(outcomeWords(manual, HOST_ZONE, clock)).toBe("Started Oct 9, 2:41 PM by Run now");
    expect(outcomeWords(failed, HOST_ZONE, clock)).toBe(`Failed Oct 12: Workflow "refine-backlog" was not found in /home/simonwjackson/code/sandbox/forgerie.`);
    expect(outcomeWords(missed, HOST_ZONE, clock)).toBe("Missed Oct 8, 3:00 AM");
    expect(outcomeWords(digest.history[0], HOST_ZONE, clock)).toBe("Starting…");
    expect(outcomeWords(undefined, HOST_ZONE, clock)).toBe("No runs yet");
  });
  it("says the last run as a sentence", () => {
    expect(lastRunWords(failed, HOST_ZONE, clock)).toBe("Last run Oct 12 at 3:00 AM failed.");
    expect(lastRunWords(started, HOST_ZONE, clock)).toBe("Last run Oct 10 at 3:00 AM started a session.");
    expect(lastRunWords(missed, HOST_ZONE, clock)).toBe("Last run Oct 8 at 3:00 AM was missed.");
    expect(lastRunWords(undefined, HOST_ZONE, clock)).toBe("No runs yet.");
  });
  it("explains a missed run with the trigger's grace", () => {
    expect(missedWords(missed, HOST_ZONE, 360, clock)).toBe("Forgerie was not running at 3:00 AM and came back more than 6 hours later, so the run did not start late.");
    expect(skippedWords(2)).toBe("Also covers 2 earlier runs that passed while Forgerie was off.");
    expect(skippedWords(0)).toBeUndefined();
  });
  it("draws the strip oldest first, with a starting run at the end", () => {
    expect(stripMarks(nightly.history, false)).toEqual(["plain", "warn", "plain", "plain", "plain", "bad", "bad"]);
    expect(stripMarks([], true)).toEqual(["live"]);
    expect(stripWords(nightly.history)).toBe("Last 7 runs: 4 started, 2 failed, 1 missed.");
    expect(stripWords([])).toBe("No runs yet.");
  });
  it("names the row by its strip", () => {
    expect(rowLabel(triage, clock)).toBe("Weekday triage. Weekdays at 9:00 AM. Next run in 15 hours. Last 7 runs: 7 started.");
  });
});

describe("a Run now from this browser", () => {
  it("stays starting until a history entry carries the ID the server answered with", () => {
    expect(runRecorded(digest, { triggerId: "inbox-digest", recordedId: serverRunId("inbox-digest", "a1b2") })).toBe(true);
    // A browser request ID is not the recorded one, even when the recorded one happens to contain it.
    expect(runRecorded(digest, { triggerId: "inbox-digest", recordedId: "a1b2" })).toBe(false);
    expect(runRecorded(digest, { triggerId: "inbox-digest", recordedId: "trigger-inbox-digest-run-a1b2" })).toBe(false);
  });
});

describe("hints", () => {
  it("warns of clock changes from 01:00 to 02:59 only", () => {
    expect(clockChangeHint("00:59")).toBeUndefined();
    expect(clockChangeHint("01:00")).toMatch(/^Clocks change/);
    expect(clockChangeHint("02:59")).toMatch(/^Clocks change/);
    expect(clockChangeHint("03:00")).toBeUndefined();
  });
  it("words the run-late choices and their hint", () => {
    expect([0, 60, 90, 360, 1440, 2880].map(graceWords)).toEqual(["Never", "1 hour", "90 min", "6 hours", "1 day", "2 days"]);
    expect(runLateHint("03:00", 360, LOCALE)).toBe("If Forgerie is off at 3:00 AM, the run starts when it is back, up to 6 hours late. After that, the run is recorded as missed.");
    expect(runLateHint("03:00", 0, LOCALE)).toBe("If Forgerie is off at 3:00 AM, the run is recorded as missed.");
  });
});
