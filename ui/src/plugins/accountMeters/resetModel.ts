import { meterAccount, shortDate, type MeterAccount } from "./meterModel";
import { formatAmount, isUnmeteredWindow, orderedWindows, windowSeconds, type QuotaPayload, type QuotaWindow } from "./quotaData";

/**
 * What spending one banked reset would do to an account, drawn in the meters'
 * own grammar: the refilled windows now and after, with the same pace rules.
 * Pure: the caller passes the clock. Nothing here spends a reset.
 */
export interface ResetPreview {
  key: string;
  provider: string;
  email: string;
  /** Codex starts the refilled windows over; Claude keeps their reset dates. */
  restarts: boolean;
  before: MeterAccount;
  after: MeterAccount;
  /** The longest refilled window, which sets the deadline the reader plans around. */
  horizon: { name: string; resetsNow: string; resetsAfter: string; leftAfter: string } | undefined;
  /** Points of the longest window the reset gives back. */
  gain: number | undefined;
  count: number;
  /** The reset this would use: the one that lapses first. */
  expires: string;
  /** The ones left after, soonest first. */
  later: string[];
}

/** "Sat, Oct 10, 8:00 AM", to the nearest minute. `zone` is for tests; the reader's own zone otherwise. */
export function longDate(instant: string | Date, zone?: string): string {
  return new Date(Math.round(new Date(instant).getTime() / 60_000) * 60_000).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    ...(zone ? { timeZone: zone } : {}) });
}

/** A span in words for a sentence: "33 hours", "7 days". The meters' own `33h` reads as a figure, not a phrase. */
export function spanWords(milliseconds: number): string {
  const hours = Math.max(1, Math.round(milliseconds / 3_600_000));
  if (hours < 48) return `${String(hours)} ${hours === 1 ? "hour" : "hours"}`;
  return `${String(Math.round(hours / 24))} days`;
}

/** A window a reset can refill: one with a level, not a pool and not a balance. */
const refillable = (quotaWindow: QuotaWindow) => !isUnmeteredWindow(quotaWindow) && formatAmount(quotaWindow.remainingAmount) === undefined;

export function resetPreview(payload: QuotaPayload, key: string, now: Date, zone?: string): ResetPreview | undefined {
  for (const provider of payload.providers) {
    for (const account of provider.accounts) {
      if (`${provider.id}/${account.email}` !== key || !account.resets) continue;
      const resets = account.resets;
      const live = resets.expiresAt.filter((instant) => new Date(instant).getTime() > now.getTime());
      const first = live[0];
      if (first === undefined) return undefined;
      const clears = resets.clears;
      const windows = orderedWindows(account).filter((quotaWindow) => refillable(quotaWindow) && (clears === undefined || clears.includes(quotaWindow.id)));
      const refilled = windows.map((quotaWindow): QuotaWindow => {
        const length = windowSeconds(quotaWindow);
        const resetsAt = !resets.restartsWindows ? quotaWindow.resetsAt
          : length === undefined ? null : new Date(now.getTime() + length * 1000).toISOString();
        return { ...quotaWindow, usedPercent: 0, remainingPercent: 100, resetsAt };
      });
      const longestIndex = longestIndexOf(windows);
      const longBefore = longestIndex === undefined ? undefined : windows[longestIndex];
      const longAfter = longestIndex === undefined ? undefined : refilled[longestIndex];
      return {
        key, provider: provider.name, email: account.email, restarts: resets.restartsWindows,
        before: meterAccount(provider.id, { ...account, resets: undefined }, windows, false, now, zone),
        after: meterAccount(provider.id, { ...account, resets: undefined }, refilled, false, now, zone),
        horizon: longBefore?.resetsAt && longAfter?.resetsAt ? {
          name: longBefore.name,
          resetsNow: longDate(longBefore.resetsAt, zone),
          resetsAfter: longDate(longAfter.resetsAt, zone),
          leftAfter: spanWords(new Date(longAfter.resetsAt).getTime() - now.getTime()),
        } : undefined,
        gain: longBefore === undefined ? undefined : Math.round(100 - Math.max(0, Math.min(100, longBefore.remainingPercent))),
        count: live.length,
        expires: shortDate(first, zone),
        later: live.slice(1).map((instant) => shortDate(instant, zone)),
      };
    }
  }
  return undefined;
}

/** The window with the longest stated length; the last one when none states it. */
function longestIndexOf(windows: readonly QuotaWindow[]): number | undefined {
  if (windows.length === 0) return undefined;
  let best = windows.length - 1;
  windows.forEach((quotaWindow, index) => {
    const length = windowSeconds(quotaWindow) ?? 0;
    if (length > (windowSeconds(windows[best] as QuotaWindow) ?? 0)) best = index;
  });
  return best;
}
