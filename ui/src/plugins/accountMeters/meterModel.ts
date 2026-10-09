import {
  accountDrained, formatAmount, isUnmeteredWindow, longestWindow, orderedWindows, providerRouting, routedAccount, visibleWindows,
  windowCountdown, windowLabel, windowStanding, type QuotaAccount, type QuotaPayload, type QuotaWindow, type Standing,
} from "./quotaData";

/** Every account and every bar, or one line per provider: its routed account's longest window. */
export type MeterMode = "every" | "glance";

/** What a lane's slot draws. */
export type Mark =
  /** A metered window. `doom` (0..1) is how hard the credit past pace burns: 0 at the window's own rate, 1 at eight times it. */
  | { kind: "bar"; remaining: number; standing: Standing; doom: number }
  /** A pool that answers or refuses and reports no level. */
  | { kind: "pool"; refusing: boolean }
  /** A prepaid balance: a number, not a bar, because it has no maximum to plot against. */
  | { kind: "balance"; amount: string; tone: "ok" | "low" | "out" };

export type ClockTone = "none" | "plain" | "loss" | "dry";
export interface Clock { text: string; tone: ClockTone }
export interface MeterLine {
  id: string;
  /** A short window name, given only where an account draws more than one line and they need telling apart. */
  label: string | undefined;
  mark: Mark;
  /** The share left, in whole points. Absent where there is no level. */
  share: string | undefined;
  clock: Clock;
  /** The whole line in words, for hover and for a screen reader. */
  words: string;
}
/** A clock printed once for a run of consecutive lines that share it. Rows are 0-based line indexes, end exclusive. */
export interface ClockRun { start: number; end: number; clock: Clock }
export interface MeterAccount {
  email: string;
  /**
   * The router pins its work here. Marked only where it answers a question:
   * a pinned provider with more than one account to choose between.
   */
  routed: boolean;
  /** Unavailable, or nothing in it can serve. */
  out: boolean;
  lines: MeterLine[];
  clocks: ClockRun[];
  /** Why the account draws no lines. */
  empty: string | undefined;
}
export interface MeterProvider { id: string; name: string; accounts: MeterAccount[] }

/**
 * Where the doom hue stops moving, as a multiple of the window's natural
 * rate. Past eight times natural, "very bad" and "worse" are the same
 * instruction.
 */
const DOOM_RATE_CAP = 8;
/** A balance at or under this many dollars is low. */
const LOW_BALANCE = 2;

/** The meters as rows, from one payload. Pure: the caller passes the clock. */
export function meterModel(payload: QuotaPayload, settings: Readonly<Record<string, unknown>>, mode: MeterMode, now: Date): MeterProvider[] {
  return payload.providers.map((provider) => {
    const pinned = providerRouting(provider) === "pinned";
    if (mode === "every") {
      const choice = pinned && provider.accounts.length > 1;
      return { id: provider.id, name: provider.name, accounts: provider.accounts.map((account) =>
        meterAccount(account, visibleWindows(orderedWindows(account), settings), choice, now)) };
    }
    const account = routedAccount(provider);
    if (account === undefined) {
      return { id: provider.id, name: provider.name, accounts: provider.accounts.length === 0 ? []
        : [{ email: "", routed: false, out: true, lines: [], clocks: [], empty: "No account in service" }] };
    }
    const longest = longestWindow(visibleWindows(orderedWindows(account), settings), now);
    return { id: provider.id, name: provider.name, accounts: [meterAccount(account, longest ? [longest] : [], false, now)] };
  });
}

function meterAccount(account: QuotaAccount, windows: QuotaWindow[], marksRouted: boolean, now: Date): MeterAccount {
  const out = !account.available || accountDrained(account);
  // The pool is a boolean, so it goes last, under the measurements it is not one of.
  const ordered = [...windows].sort((left, right) => Number(isUnmeteredWindow(left)) - Number(isUnmeteredWindow(right)));
  const labelled = ordered.length > 1;
  const lines = ordered.map((quotaWindow) => meterLine(quotaWindow, account.available, labelled, now));
  const empty = lines.length > 0 ? undefined
    : account.windows.length === 0 ? "No windows reported" : "Every bar is turned off";
  return { email: account.email, routed: marksRouted && account.selected, out, lines, clocks: clockRuns(lines), empty };
}

function meterLine(quotaWindow: QuotaWindow, available: boolean, labelled: boolean, now: Date): MeterLine {
  // The label is drawn small beside the lane; the words use the router's full name.
  const label = labelled ? windowLabel(quotaWindow) ?? quotaWindow.name : undefined;
  const name = quotaWindow.name;
  const countdown = windowCountdown(quotaWindow, now);
  const reset = countdown === "" ? "never resets" : countdown === "now" ? "resets now" : `resets in ${countdown}`;
  if (isUnmeteredWindow(quotaWindow)) {
    const refusing = !available || quotaWindow.remainingPercent <= 0;
    return { id: quotaWindow.id, label, mark: { kind: "pool", refusing }, share: undefined, clock: plainClock(countdown),
      words: sentence(`${name}: ${refusing ? "refusing work" : "answering"}`, "the provider reports no level", reset, available ? undefined : "not in service") };
  }
  const amount = formatAmount(quotaWindow.remainingAmount);
  if (amount !== undefined) {
    const value = quotaWindow.remainingAmount ?? 0;
    return { id: quotaWindow.id, label, share: undefined, clock: plainClock(countdown),
      mark: { kind: "balance", amount, tone: value <= 0 ? "out" : value <= LOW_BALANCE ? "low" : "ok" },
      words: sentence(`${name}: ${amount} left`, reset, available ? undefined : "not in service") };
  }
  const standing = windowStanding(quotaWindow, now);
  const remaining = Math.round(Math.max(0, Math.min(100, quotaWindow.remainingPercent)));
  const gap = standing.pace === undefined ? undefined : Math.round(quotaWindow.remainingPercent - standing.pace);
  const pace = gap === undefined ? "no pace, because the window states no length or has turned over"
    : gap < 0 ? `${String(-gap)} points behind an even spend` : `${String(gap)} points ahead of an even spend`;
  return { id: quotaWindow.id, label, share: String(remaining),
    mark: { kind: "bar", remaining, standing, doom: standing.kind === "loss" ? doom(remaining / standing.pace) : 0 },
    clock: standingClock(countdown, standing),
    words: sentence(`${name}: ${String(remaining)}% left`, reset, pace, available ? undefined : "not in service") };
}

/**
 * The doom hue, by rate rather than by deadline. `remaining / pace` is how
 * many times the window's natural rate you would have to sustain to waste
 * nothing. It is unit-free, so it reads the same on a five-hour lane and a
 * seven-day one.
 */
function doom(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 1) return 0;
  return Math.min(1, Math.log(rate) / Math.log(DOOM_RATE_CAP));
}

const plainClock = (text: string): Clock => text === "" ? { text: "—", tone: "none" } : { text, tone: "plain" };

/**
 * The clock, and which kind of trouble it names. The arrow carries the
 * meaning, not the hue: amber against red is the pair red-green colour
 * blindness collapses, and the two states are opposite instructions. Up:
 * credit is expiring unspent. Down: the lane runs dry before this reset.
 */
function standingClock(text: string, standing: Standing): Clock {
  if (text === "") return { text: "—", tone: "none" };
  if (standing.kind === "drained" || standing.kind === "dry") return { text: `↓${text}`, tone: "dry" };
  if (standing.kind === "loss") return { text: `↑${text}`, tone: "loss" };
  return { text, tone: "plain" };
}

/** Consecutive lines whose clocks agree share one clock: Claude's week and Fable reset together, so one clock says it once. */
function clockRuns(lines: readonly MeterLine[]): ClockRun[] {
  const runs: ClockRun[] = [];
  lines.forEach((line, index) => {
    const last = runs.at(-1);
    if (last && last.end === index && last.clock.text === line.clock.text && last.clock.tone === line.clock.tone) last.end = index + 1;
    else runs.push({ start: index, end: index + 1, clock: line.clock });
  });
  return runs;
}

function sentence(...parts: (string | undefined)[]): string {
  return `${parts.filter((part) => part !== undefined).join(", ")}.`;
}
