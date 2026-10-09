import { describe, expect, it } from "vitest";
import { meterModel, RESET_SOON_MS } from "./meterModel";
import { parseQuotaPayload } from "./quotaData";
import { resetPreview, spanWords } from "./resetModel";

const ZONE = "UTC";
const now = new Date("2026-10-09T14:00:00Z");
const week = 604800;
const payload = (resets: Record<string, unknown>) => parseQuotaPayload({
  version: 1, updatedAt: "2026-10-09T13:59:00Z",
  providers: [
    { id: "claude", name: "Claude", accounts: [{ email: "me@work.example", available: true, selected: true, priority: 100, resets: resets["claude"], windows: [
      { id: "five_hour", name: "Five-hour", usedPercent: 27, remainingPercent: 73, resetsAt: "2026-10-09T17:00:00Z", lengthSeconds: 18000 },
      // One day left in the week.
      { id: "seven_day", name: "Seven-day", usedPercent: 86, remainingPercent: 14, resetsAt: "2026-10-10T14:00:00Z", lengthSeconds: week },
    ] }] },
    { id: "codex", name: "Codex", accounts: [
      { email: "a@example", available: true, selected: true, priority: 100, resets: resets["codex"], windows: [
        { id: "seven_day", name: "Seven-day", usedPercent: 62, remainingPercent: 38, resetsAt: "2026-10-14T03:45:00Z", lengthSeconds: week },
      ] },
      { email: "b@example", available: true, selected: false, priority: 0, windows: [] },
    ] },
  ],
});
const claude = { expiresAt: ["2026-10-22T16:00:00Z"], clears: ["five_hour", "seven_day"], restartsWindows: false };
const codex = { expiresAt: ["2026-10-22T20:26:38Z", "2026-10-29T18:51:16Z", "2026-11-06T23:20:10Z"], restartsWindows: true };

describe("reset marker", () => {
  it("marks each account that has a reset, and no other", () => {
    const rows = meterModel(payload({ claude, codex }), {}, now, ZONE);
    expect(rows.flatMap((provider) => provider.accounts.map((account) => [account.key, account.reset?.count]))).toEqual([
      ["claude/me@work.example", 1], ["codex/a@example", 3], ["codex/b@example", undefined],
    ]);
    expect(rows[1]?.accounts[0]?.reset?.words).toBe("3 resets available, the first expires Oct 22");
  });

  it("drops resets that have lapsed, and counts the rest", () => {
    const rows = meterModel(payload({ codex: { ...codex, expiresAt: ["2026-10-01T00:00:00Z", "2026-10-29T18:51:16Z"] } }), {}, now, ZONE);
    expect(rows[1]?.accounts[0]?.reset).toMatchObject({ count: 1, soonest: "Oct 29" });
  });

  it("flags a reset that lapses within the soon window, one millisecond either side", () => {
    const at = (offset: number) => new Date(now.getTime() + RESET_SOON_MS + offset).toISOString();
    const soon = (offset: number) => meterModel(payload({ codex: { expiresAt: [at(offset)], restartsWindows: true } }), {}, now, ZONE)[1]?.accounts[0]?.reset?.soon;
    expect(soon(0)).toBe(true);
    expect(soon(1)).toBe(false);
  });

  it("ignores a malformed reset field rather than failing the reading", () => {
    expect(meterModel(payload({ codex: { expiresAt: "soon" } }), {}, now, ZONE)[1]?.accounts[0]?.reset).toBeUndefined();
  });
});

describe("reset preview", () => {
  it("Claude refills and keeps the weekly date, so the refill must be used in the day left", () => {
    const preview = resetPreview(payload({ claude }), "claude/me@work.example", now, ZONE);
    expect(preview?.restarts).toBe(false);
    expect(preview?.horizon).toEqual({ name: "Seven-day", resetsNow: "Sat, Oct 10, 2:00 PM", resetsAfter: "Sat, Oct 10, 2:00 PM", leftAfter: "24 hours" });
    expect(preview?.after.lines.map((line) => line.share)).toEqual(["100", "100"]);
    // A full week's budget with one day to spend it is credit expiring unspent.
    expect(preview?.after.clocks.at(-1)?.clock.tone).toBe("loss");
    expect(preview?.gain).toBe(86);
  });

  it("Codex refills and starts the window over, so the full week comes back", () => {
    const preview = resetPreview(payload({ codex }), "codex/a@example", now, ZONE);
    expect(preview?.restarts).toBe(true);
    expect(preview?.horizon).toEqual({ name: "Seven-day", resetsNow: "Wed, Oct 14, 3:45 AM", resetsAfter: "Fri, Oct 16, 2:00 PM", leftAfter: "7 days" });
    expect(preview?.after.clocks[0]?.clock).toEqual({ text: "7d", tone: "plain" });
    expect(preview).toMatchObject({ count: 3, expires: "Oct 22", later: ["Oct 29", "Nov 6"] });
  });

  it("has nothing to preview for an account without a reset", () => {
    expect(resetPreview(payload({}), "codex/b@example", now, ZONE)).toBeUndefined();
  });
});

describe("spanWords", () => {
  it("says hours below two days and days above", () => {
    expect(spanWords(47 * 3_600_000)).toBe("47 hours");
    expect(spanWords(48 * 3_600_000)).toBe("2 days");
    expect(spanWords(1)).toBe("1 hour");
  });
});
