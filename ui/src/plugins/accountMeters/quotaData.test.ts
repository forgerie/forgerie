import { describe, expect, it } from "vitest";
import {
  accountDrained, formatAmount, isStale, isUnmeteredWindow, longestWindow, orderedWindows, PACE_MARGIN_POINTS, parseQuotaPayload,
  providerRouting, routedAccount, spanLabel, visibleWindows, windowCountdown, windowLabel, windowPaceFraction, windowStanding,
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
  it("gives no routed account when the selected one is unavailable", () => {
    const unavailable = clone(); unavailable.providers[0]!.accounts[0]!.available = false;
    expect(routedAccount(parseQuotaPayload(unavailable).providers[0]!)).toBeUndefined();
    expect(routedAccount(parseQuotaPayload(payload).providers[0]!)?.email).toBe("person@example.com");
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

describe("the longest window", () => {
  const now = new Date("2026-08-15T02:15:00Z");
  it("decides by length, not by pressure", () => {
    const fiveHour = { id: "five_hour", remainingPercent: 4, resetsAt: "2026-08-15T06:00:00Z" };
    const sevenDay = { id: "seven_day", remainingPercent: 90, resetsAt: "2026-08-16T00:00:00Z" };
    expect(longestWindow([fiveHour, sevenDay], now)?.id).toBe("seven_day");
    expect(longestWindow([sevenDay, fiveHour], now)?.id).toBe("seven_day");
    expect(longestWindow([], now)).toBeUndefined();
  });
  it("falls back to the furthest reset for pools, and breaks a tie toward the emptiest", () => {
    const gemini = { id: "antigravity_gemini", remainingPercent: 100, resetsAt: "2026-08-15T06:00:00Z" };
    const claude = { id: "antigravity_claude", remainingPercent: 3, resetsAt: "2026-08-18T02:15:00Z" };
    const gptOss = { id: "antigravity_gpt_oss", remainingPercent: 41, resetsAt: "2026-08-18T02:15:00Z" };
    expect(longestWindow([gemini, claude, gptOss], now)?.id).toBe("antigravity_claude");
    expect(longestWindow([{ id: "mystery", remainingPercent: 1, resetsAt: null }, gemini], now)?.id).toBe("antigravity_gemini");
  });
});

describe("balances and clocks", () => {
  it("writes a balance in whole dollars, rounded down, and tells empty from nearly empty", () => {
    expect([9.617546, 9.999, 42, 0, 0.004].map(formatAmount)).toEqual(["$9", "$9", "$42", "$0", "<$1"]);
    expect([undefined, Number.NaN, -1].map(formatAmount)).toEqual([undefined, undefined, undefined]);
  });
  it("writes a countdown in one unit, never two", () => {
    expect([45 * 60_000, 90 * 60_000, 38 * 3_600_000, 65 * 3_600_000, 0, Number.NaN].map(spanLabel)).toEqual(["45m", "2h", "38h", "3d", "now", ""]);
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
