import { describe, expect, it } from "vitest";
import { meterModel } from "./meterModel";
import { meterHeight, meterLayout, METER_SHARE, METER_SIZES } from "./meterPlan";
import { parseQuotaPayload } from "./quotaData";

const now = new Date("2026-10-09T04:00:00Z");
const week = (remainingPercent: number, resetsAt: string, id = "seven_day") =>
  ({ id, name: id === "seven_day" ? "Seven-day" : "Fable", usedPercent: 100 - remainingPercent, remainingPercent, resetsAt, lengthSeconds: 604800 });
// The live payload of 2026-10-09, shortened: every kind of mark the meters draw.
const payload = parseQuotaPayload({
  version: 1, updatedAt: "2026-10-09T03:59:00Z",
  providers: [
    { id: "claude", name: "Claude", routing: "pinned", accounts: [{ email: "me@work.example", available: true, selected: true, priority: 100, windows: [
      { id: "five_hour", name: "Five-hour", usedPercent: 27, remainingPercent: 73, resetsAt: "2026-10-09T07:40:00Z", lengthSeconds: 18000 },
      // Half the week left (pace 50): 20 is dry, Fable at 55 is on pace.
      week(20, "2026-10-12T16:00:00Z"), week(55, "2026-10-12T16:00:00Z", "weekly_fable"),
    ] }] },
    { id: "codex", name: "Codex", accounts: [
      { email: "a@example", available: true, selected: true, priority: 100, windows: [week(95, "2026-10-12T16:00:00Z")] },
      { email: "b@example", available: false, selected: false, priority: 100, windows: [] },
    ] },
    { id: "openrouter", name: "OpenRouter", routing: "rotating", accounts: [{ email: "sk-or-v1-545", available: true, selected: true, priority: 0, windows: [
      { id: "openrouter_credits", name: "Credits", usedPercent: 64, remainingPercent: 36, resetsAt: null, remainingAmount: 1.5 },
    ] }] },
    { id: "antigravity", name: "Antigravity", accounts: [{ email: "c@example", available: true, selected: true, priority: 100, windows: [
      { id: "antigravity_gemini", name: "Gemini", usedPercent: 100, remainingPercent: 0, resetsAt: "2026-10-09T23:31:55Z" },
      { id: "antigravity_claude", name: "Claude", usedPercent: 0, remainingPercent: 100, resetsAt: "2026-10-16T04:00:00Z" },
    ] }] },
  ],
});

describe("the meters, every account", () => {
  const [claude, codex, openrouter, antigravity] = meterModel(payload, {}, "every", now);
  it("labels lines only where an account has more than one, and shares one clock between lines that reset together", () => {
    const account = claude!.accounts[0]!;
    expect(account.lines.map((line) => [line.label, line.share, line.clock.text])).toEqual([["5h", "73", "4h"], ["7d", "20", "↓4d"], ["Fable", "55", "4d"]]);
    // The week is dry and Fable is not, so their clocks differ even though the reset is the same.
    expect(account.clocks).toEqual([{ start: 0, end: 1, clock: { text: "4h", tone: "plain" } }, { start: 1, end: 2, clock: { text: "↓4d", tone: "dry" } },
      { start: 2, end: 3, clock: { text: "4d", tone: "plain" } }]);
    expect(codex!.accounts[0]!.lines[0]!.label).toBeUndefined();
  });
  it("says which way a lane is off pace in words as well as in its mark", () => {
    const [, dry] = claude!.accounts[0]!.lines;
    expect(dry!.mark).toMatchObject({ kind: "bar", remaining: 20, standing: { kind: "dry" } });
    expect(dry!.words).toBe("Seven-day: 20% left, resets in 4d, 30 points behind an even spend.");
    const loss = codex!.accounts[0]!.lines[0]!;
    expect(loss.clock).toEqual({ text: "↑4d", tone: "loss" });
    expect(loss.mark.kind === "bar" && loss.mark.doom).toBeCloseTo(Math.log(95 / 50) / Math.log(8));
  });
  it("marks the routed account only where the router pins one of several", () => {
    expect(claude!.accounts[0]!.routed).toBe(false);
    expect(codex!.accounts.map((account) => [account.routed, account.out, account.empty])).toEqual([[true, false, undefined], [false, true, "No windows reported"]]);
    expect(openrouter!.accounts[0]!.routed).toBe(false);
  });
  it("draws a balance as a number and a pool as a token, last", () => {
    expect(openrouter!.accounts[0]!.lines[0]).toMatchObject({ mark: { kind: "balance", amount: "$1", tone: "low" }, share: undefined, clock: { text: "—", tone: "none" } });
    expect(antigravity!.accounts[0]!.lines.map((line) => line.mark.kind)).toEqual(["bar", "pool"]);
    expect(antigravity!.accounts[0]!.lines[1]).toMatchObject({ mark: { kind: "pool", refusing: true }, words: "Gemini: refusing work, the provider reports no level, resets in 20h." });
  });
  it("hides the bars the user turned off, and says so when nothing is left", () => {
    const [hidden] = meterModel(payload, { five_hour: false, seven_day: false, weekly_fable: false }, "every", now);
    expect(hidden!.accounts[0]!.empty).toBe("Every bar is turned off");
  });
});

describe("the meters at a glance", () => {
  it("draws one line per provider: the routed account's longest window", () => {
    const glance = meterModel(payload, {}, "glance", now);
    expect(glance.map((provider) => provider.accounts.map((account) => account.lines.map((line) => line.id)))).toEqual([
      [["seven_day"]], [["seven_day"]], [["openrouter_credits"]], [["antigravity_claude"]]]);
    expect(glance.every((provider) => provider.accounts.every((account) => !account.routed && account.lines.every((line) => line.label === undefined)))).toBe(true);
  });
  it("says so when no account is in service", () => {
    const down = structuredClone(payload);
    down.providers[0]!.accounts[0]!.available = false;
    expect(meterModel(down, {}, "glance", now)[0]!.accounts).toEqual([{ key: "claude/", email: "", reset: undefined, routed: false, out: true, lines: [], clocks: [], empty: "No account in service" }]);
  });
});

describe("what fits in the room the meters share with the list", () => {
  const rows = (mode: "every" | "glance") => meterModel(payload, {}, mode, now);
  const size = METER_SIZES;
  const every = meterHeight(rows("every"), false, "every");
  const named = meterHeight(rows("every"), true, "every");
  const glance = meterHeight(rows("glance"), false, "glance");
  it("adds up the meters' height from the sizes in the stylesheet", () => {
    // Claude 3 lines; Codex 1 + 1 (empty); OpenRouter 1; Antigravity 2.
    const lines = 3 * size.line + 2 * size.lineGap + 2 * size.line + size.accountGap + size.line + 2 * size.line + size.lineGap;
    expect(every).toBe(size.header + size.padding + lines + 3 * size.providerGap);
    expect(named - every).toBe(5 * (size.email + size.lineGap));
    // One line per provider, at line spacing.
    expect(glance).toBe(size.header + size.padding + 4 * size.line + 3 * size.lineGap);
  });
  const room = (height: number) => Math.ceil(height / METER_SHARE);
  it("shows every account while it fits, with addresses only while they fit too", () => {
    expect(meterLayout(room(named), "auto", rows)).toMatchObject({ mode: "every", names: true });
    expect(meterLayout(room(named) - 3, "auto", rows)).toMatchObject({ mode: "every", names: false });
    expect(meterLayout(room(every), "auto", rows)).toMatchObject({ mode: "every", names: false });
  });
  it("falls back to one line per provider when every account does not fit, until the reader chooses", () => {
    expect(meterLayout(room(every) - 3, "auto", rows).mode).toBe("glance");
    expect(meterLayout(room(every) - 3, "every", rows).mode).toBe("every");
    expect(meterLayout(10_000, "glance", rows)).toMatchObject({ mode: "glance", names: true });
  });
  it("draws everything while the room is unmeasured", () => {
    expect(meterLayout(0, "auto", rows)).toEqual({ mode: "every", names: true, budget: undefined });
  });
});
