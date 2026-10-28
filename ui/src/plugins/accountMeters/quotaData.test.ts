import { describe, expect, it } from "vitest";
import {
  accountDrained, formatAmount, isStale, isUnmeteredWindow, orderedWindows, PACE_MARGIN_POINTS, parseQuotaPayload,
  poolStanding, providerRouting, spanLabel, visibleWindows, windowCountdown, windowLabel, windowPaceFraction, windowStanding,
} from "./quotaData";

// Ported from the original client plugin's quota-data.test.js. The cases and
// their reasons are the same; tests of helpers the meters no longer use were
// left behind with those helpers.
const payload = {
  version: 1,
  updatedAt: "2026-08-15T02:15:09Z",
  providers: [{
    id: "claude", name: "Claude", routing: "pinned",
    accounts: [{
      email: "person@example.com", available: true, selected: true, priority: 100,
      windows: [
        { id: "five_hour", name: "Five-hour", usedPercent: 25, remainingPercent: 75, resetsAt: "2026-08-15T02:30:00Z" },
        { id: "seven_day", name: "Seven-day", usedPercent: 84, remainingPercent: 16, resetsAt: null },
      ],
    }],
  }],
};
const clone = () => structuredClone(payload);

describe("the quota contract", () => {
  it("parses the sanitized payload", () => {
    expect(parseQuotaPayload(payload)).toEqual(payload);
  });
  it("treats a provider from a router that predates rotating pools as pinned", () => {
    const legacy: { providers: { routing?: string }[] } = clone();
    delete legacy.providers[0]!.routing;
    expect(providerRouting(parseQuotaPayload(legacy).providers[0]!)).toBe("pinned");
    const rotating = clone(); rotating.providers[0]!.routing = "rotating";
    expect(providerRouting(parseQuotaPayload(rotating).providers[0]!)).toBe("rotating");
  });
  it("carries a balance and a stated length through, and adds neither where the router sent none", () => {
    const withFunds = clone();
    Object.assign(withFunds.providers[0]!.accounts[0]!.windows[0]!, { remainingAmount: 9.617546, lengthSeconds: 7200 });
    const windows = parseQuotaPayload(withFunds).providers[0]!.accounts[0]!.windows;
    expect(windows[0]).toMatchObject({ remainingAmount: 9.617546, lengthSeconds: 7200 });
    expect("remainingAmount" in windows[1]!).toBe(false);
    expect("lengthSeconds" in windows[1]!).toBe(false);
  });
  it("rejects percentages outside the contract, unreadable instants, and unknown versions", () => {
    const over = clone(); over.providers[0]!.accounts[0]!.windows[0]!.remainingPercent = 101;
    expect(() => parseQuotaPayload(over)).toThrow("cannot read");
    const badDate = clone(); badDate.providers[0]!.accounts[0]!.windows[0]!.resetsAt = "soon";
    expect(() => parseQuotaPayload(badDate)).toThrow("cannot read");
    expect(() => parseQuotaPayload({ ...payload, version: 2 })).toThrow("cannot read");
  });
});

describe("which windows to draw, and in what order", () => {
  it("hides only the bars the user turned off, and keeps a window no setting names", () => {
    const windows = [{ id: "five_hour" }, { id: "seven_day" }, { id: "antigravity_gemini" }];
    expect(visibleWindows(windows, {}).map((w) => w.id)).toEqual(["five_hour", "seven_day", "antigravity_gemini"]);
    expect(visibleWindows(windows, { five_hour: false }).map((w) => w.id)).toEqual(["seven_day", "antigravity_gemini"]);
    expect(visibleWindows([{ id: "brand_new" }], { five_hour: false }).map((w) => w.id)).toEqual(["brand_new"]);
  });
  it("orders windows shortest first, pools after time windows, a key cap before its balance, and unknowns last in arrival order", () => {
    const ids = (windows: { id: string }[]) => orderedWindows({ windows }).map((w) => w.id);
    expect(ids([{ id: "seven_day" }, { id: "five_hour" }])).toEqual(["five_hour", "seven_day"]);
    expect(ids([{ id: "antigravity_gpt_oss" }, { id: "seven_day" }, { id: "antigravity_gemini" }, { id: "antigravity_claude" }]))
      .toEqual(["seven_day", "antigravity_gemini", "antigravity_claude", "antigravity_gpt_oss"]);
    expect(ids([{ id: "openrouter_credits" }, { id: "openrouter_key_limit" }])).toEqual(["openrouter_key_limit", "openrouter_credits"]);
    expect(ids([{ id: "monthly" }, { id: "five_hour" }, { id: "hourly" }])).toEqual(["five_hour", "monthly", "hourly"]);
  });
  it("names a window by its label or its own length, and invents no length", () => {
    expect(windowLabel({ id: "five_hour" })).toBe("5h");
    expect(windowLabel({ id: "seven_day" })).toBe("7d");
    expect(windowLabel({ id: "five_hour", lengthSeconds: 7200 })).toBe("2h");
    expect(windowLabel({ id: "seven_day", lengthSeconds: 30 * 24 * 60 * 60 })).toBe("30d");
    expect(windowLabel({ id: "weekly_fable", lengthSeconds: 604800 })).toBe("Fable");
    expect(windowLabel({ id: "antigravity_gpt_oss" })).toBe("GPT-OSS");
    expect(windowLabel({ id: "openrouter_key_limit" })).toBe("Key limit");
    expect(windowLabel({ id: "monthly" })).toBeUndefined();
    expect(windowLabel({ id: "five_hour", lengthSeconds: 5400 })).toBeUndefined();
  });
  it("identifies the unmetered pool", () => {
    expect(isUnmeteredWindow({ id: "antigravity_gemini" })).toBe(true);
    expect(isUnmeteredWindow({ id: "antigravity_claude" })).toBe(false);
    expect(isUnmeteredWindow(undefined)).toBe(false);
  });
});

describe("balances and clocks", () => {
  it("writes a balance in whole dollars, rounded down, and tells empty from nearly empty", () => {
    expect([9.617546, 9.999, 42, 0, 0.004].map(formatAmount)).toEqual(["$9", "$9", "$42", "$0", "<$1"]);
    expect([undefined, Number.NaN, -1].map(formatAmount)).toEqual([undefined, undefined, undefined]);
  });
  it("writes a countdown in one unit, never two", () => {
    expect([45 * 60_000, 90 * 60_000, 38 * 3_600_000, 65 * 3_600_000, 0, Number.NaN].map(spanLabel)).toEqual(["45m", "2h", "2d", "3d", "now", ""]);
  });
  it("leaves the countdown empty for a balance that never resets", () => {
    const now = new Date("2026-09-20T00:45:00Z");
    expect(windowCountdown({ resetsAt: "2026-09-20T06:45:00Z" }, now)).toBe("6h");
    expect(windowCountdown({ resetsAt: null }, now)).toBe("");
  });
  it("doubts a reading five minutes old", () => {
    const now = new Date("2026-08-15T02:15:00Z");
    expect(isStale("2026-08-15T02:10:01Z", now)).toBe(false);
    expect(isStale("2026-08-15T02:10:00Z", now)).toBe(true);
  });
  it("treats an account as drained only when nothing in it can serve", () => {
    const spent = { id: "seven_day", remainingPercent: 0 };
    const left = { id: "seven_day", remainingPercent: 4 };
    const gemini = { id: "antigravity_gemini", remainingPercent: 100 };
    expect(accountDrained({ windows: [spent] })).toBe(true);
    expect(accountDrained({ windows: [spent, left] })).toBe(false);
    // Gemini reports full for ever, so only the proxy's own verdict can drain it.
    expect(accountDrained({ windows: [spent, gemini] }, true)).toBe(false);
    expect(accountDrained({ windows: [spent, gemini] }, false)).toBe(true);
    expect(accountDrained({ windows: [] })).toBe(false);
  });
});

describe("pace", () => {
  it("places pace at the share of the window still to run, from a stated length first", () => {
    const now = new Date("2026-09-20T00:45:00Z");
    expect(windowPaceFraction({ id: "five_hour", resetsAt: "2026-09-20T03:15:00Z" }, now)).toBe(0.5);
    expect(windowPaceFraction({ id: "weekly_fable", lengthSeconds: 604800, resetsAt: "2026-09-23T00:45:00Z" }, now)).toBe(3 / 7);
    expect(windowPaceFraction({ id: "antigravity_claude", resetsAt: "2026-09-21T00:45:00Z" }, now)).toBeUndefined();
    expect(windowPaceFraction({ id: "openrouter_credits", resetsAt: null }, now)).toBeUndefined();
  });
  it("gives no pace at all once the reset has passed", () => {
    const now = new Date("2026-09-20T00:45:00Z");
    expect(windowPaceFraction({ id: "five_hour", resetsAt: "2026-09-20T00:44:00Z" }, now)).toBeUndefined();
    expect(windowPaceFraction({ id: "five_hour", resetsAt: "2026-09-20T00:45:00Z" }, now)).toBeUndefined();
    expect(windowPaceFraction({ id: "five_hour", lengthSeconds: 18000, resetsAt: "2026-09-20T00:45:01Z" }, now)).toBe(1 / 18000);
  });
  it("does not call a window that just reset dry", () => {
    const now = new Date("2026-09-22T22:30:00Z");
    expect(windowStanding({ id: "seven_day", lengthSeconds: 604800, remainingPercent: 99, resetsAt: "2026-09-29T22:29:00Z" }, now).kind).toBe("ok");
  });
  it("applies the same margin on both sides of pace", () => {
    const now = new Date("2026-09-22T00:00:00Z");
    // Half the week left, so pace is 50.
    const at = (remainingPercent: number) => windowStanding({ id: "seven_day", lengthSeconds: 604800, remainingPercent, resetsAt: "2026-09-25T12:00:00Z" }, now).kind;
    expect([at(50 + PACE_MARGIN_POINTS - 1), at(50 + PACE_MARGIN_POINTS), at(50 - PACE_MARGIN_POINTS + 1), at(50 - PACE_MARGIN_POINTS)]).toEqual(["ok", "loss", "ok", "dry"]);
  });
  it("stands two meters on one window on the same clock", () => {
    const now = new Date("2026-09-22T00:00:00Z");
    const resetsAt = "2026-09-25T12:00:00Z";
    const week = windowStanding({ id: "seven_day", lengthSeconds: 604800, remainingPercent: 38, resetsAt }, now);
    const fable = windowStanding({ id: "weekly_fable", lengthSeconds: 604800, remainingPercent: 34, resetsAt }, now);
    expect([week.kind, fable.kind]).toEqual(["dry", "dry"]);
    expect(week.pace).toBe(fable.pace);
  });
  it("names the other standings", () => {
    const now = new Date("2026-09-22T00:00:00Z");
    expect(windowStanding({ id: "seven_day", lengthSeconds: 604800, remainingPercent: 0, resetsAt: "2026-09-25T12:00:00Z" }, now).kind).toBe("drained");
    expect(windowStanding({ id: "antigravity_claude", remainingPercent: 40, resetsAt: "2026-09-25T12:00:00Z" }, now).kind).toBe("unpaced");
    expect(windowStanding({ id: "seven_day", lengthSeconds: 604800, remainingPercent: 40, resetsAt: "2026-09-21T12:00:00Z" }, now).kind).toBe("unpaced");
  });
});

describe("a pool of accounts", () => {
  const now = new Date("2026-10-28T18:15:27Z");
  const hours = (count: number) => new Date(now.getTime() + count * 3_600_000).toISOString();
  const week = (remainingPercent: number, resetsAt: string) => ({ id: "seven_day", lengthSeconds: 604800, remainingPercent, resetsAt });

  it("loses a whole account when two full ones reset together and are spent at one account's pace", () => {
    const reading = poolStanding([week(100, hours(168)), week(100, hours(168))], now);
    expect(reading.remaining).toBe(100);
    // Grey on the left half, orange on the right: one account's worth resets unused.
    expect(reading.standing).toEqual({ kind: "loss", pace: 50 });
    expect(reading.lost).toBeCloseTo(100);
    expect(reading.rate).toBeCloseTo(2);
  });
  it("cannot let an empty account cancel out a full one that resets first", () => {
    // The live Claude reading of 2026-10-28: 59% resetting in 37.7 h, 2% resetting in 67.7 h.
    const soon = "2026-10-30T08:00:00Z";
    const reading = poolStanding([week(2, "2026-10-31T14:00:00Z"), week(59, soon)], now);
    expect(reading.remaining).toBe(30.5);
    expect(reading.standing.kind).toBe("loss");
    expect(reading.standing.pace).toBeCloseTo((22.47 + 2) / 2, 1);
    expect(reading.lost).toBeCloseTo(36.5, 0);
    expect(reading.lostAt).toBe(soon);
    expect(reading.soonest).toBe(soon);
    expect(reading.rate).toBeCloseTo(2.63, 1);
  });
  it("reads one account exactly as its own bar does", () => {
    for (const share of [5, 40, 50, 90]) {
      const single = week(share, hours(84));
      expect(poolStanding([single], now).standing).toEqual(windowStanding(single, now));
    }
  });
  it("loses nothing when the accounts are spread so that one account's pace spends them all", () => {
    // Each account holds just what one account's pace spends before its own reset, after the one before it.
    const reading = poolStanding([week(50, hours(84)), week(50, hours(168))], now);
    expect(reading.lost).toBeCloseTo(0);
    expect(reading.standing.kind).toBe("ok");
    expect(reading.rate).toBeCloseTo(1);
  });
  it("runs dry only when it empties before the soonest reset refills it", () => {
    const dry = poolStanding([week(0, hours(84)), week(5, hours(84))], now);
    expect(dry.standing).toEqual({ kind: "dry", pace: 25 });
    expect(dry.lost).toBe(0);
    // A little left, but the other account refills in an hour: not dry.
    expect(poolStanding([week(1, hours(1)), week(0, hours(120))], now).standing.kind).toBe("ok");
  });
  it("gives no pace when any account's window has none", () => {
    expect(poolStanding([week(100, hours(10)), { id: "seven_day", lengthSeconds: 604800, remainingPercent: 100, resetsAt: null }], now).standing.kind).toBe("unpaced");
  });
});
