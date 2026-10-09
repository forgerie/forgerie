import { z } from "zod";

/**
 * The CLIProxyAPI quota contract and every judgement the meters draw from it.
 *
 * Ported from the original client's `cliproxyapi-quota` plugin
 * (cliproxyapi-nix, forgerie-plugin/cliproxyapi-quota/quota-data.js). The
 * rules are unchanged; only the language and the parser are new. Nothing here
 * touches the DOM, the network, or the clock: callers pass `now`.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Window ids in ascending window length. An id the router adds later keeps the
 * order it arrived in, after the ones named here, so a new window never
 * silently swaps the position of an existing one.
 */
const WINDOW_ORDER = [
  "five_hour",
  "seven_day",
  "antigravity_gemini",
  "antigravity_claude",
  "antigravity_gpt_oss",
  "openrouter_key_limit",
  "openrouter_credits",
];

const WINDOW_LABELS: Readonly<Record<string, string>> = {
  antigravity_gemini: "Gemini",
  antigravity_claude: "Claude",
  antigravity_gpt_oss: "GPT-OSS",
  // Shares the seven-day length, so a length label would say "7d" twice in one account.
  weekly_fable: "Fable",
  // A balance rather than a window: it is spent down and topped up, never
  // reset, so it carries no countdown and no pace line.
  openrouter_credits: "Credits",
  openrouter_key_limit: "Key limit",
};

/**
 * How long each known window runs, in seconds. Read off the window id, which
 * is a guess dressed as a fact: a `lengthSeconds` the router sends always
 * wins, and an id not listed here gets no pace at all rather than a plausible
 * invention.
 */
const WINDOW_SECONDS: Readonly<Record<string, number>> = {
  five_hour: 5 * 60 * 60,
  seven_day: 7 * 24 * 60 * 60,
};

const instant = (field: string) => z.string().refine((value) => Number.isFinite(new Date(value).getTime()), `CLIProxyAPI returned an invalid ${field}.`);
const percent = z.number().min(0).max(100);
const windowSchema = z.object({
  id: z.string(),
  name: z.string(),
  usedPercent: percent,
  remainingPercent: percent,
  resetsAt: instant("resetsAt").nullable(),
  // Only a balance-backed window carries one, so absent is the normal case.
  remainingAmount: z.number().nonnegative().optional().catch(undefined),
  // Absent from every router build shipped so far. Carried through so pace
  // becomes exact the day the router sends it.
  lengthSeconds: z.number().positive().optional().catch(undefined),
});
/**
 * Banked usage-limit resets the provider granted this account. The router
 * sends it for Claude and Codex accounts only, so absent is the normal case
 * elsewhere. A malformed value, or an account with none, is dropped rather
 * than failing the whole reading.
 */
const resetsSchema = z.object({
  /** One instant per unused reset, soonest first. */
  expiresAt: z.array(instant("resets.expiresAt")).min(1),
  /** Window ids a reset refills. Absent: every metered window. */
  clears: z.array(z.string()).optional(),
  /**
   * Whether a reset also starts the refilled windows over. Codex does; Claude
   * refills usage and keeps each window's reset date. The router says which,
   * because only the provider knows.
   */
  restartsWindows: z.boolean(),
  /**
   * How many resets the provider would let this account spend right now. Zero
   * means it holds them back (Codex does until a limit is near); null or
   * absent means it did not say.
   */
  applicableCount: z.number().int().nonnegative().nullable().optional().catch(undefined),
  /** The provider refuses a reset until this instant. */
  cooldownUntil: instant("resets.cooldownUntil").nullable().optional().catch(undefined),
});
const accountSchema = z.object({
  email: z.string(),
  available: z.boolean(),
  selected: z.boolean(),
  priority: z.number().int(),
  windows: z.array(windowSchema),
  resets: resetsSchema.optional().catch(undefined),
});
const providerSchema = z.object({
  id: z.string(),
  name: z.string(),
  // Absent from every router build before rotating pools existed, so a
  // missing value means the account is pinned rather than that it is unknown.
  routing: z.string().optional().transform((value): "pinned" | "rotating" => value === "rotating" ? "rotating" : "pinned"),
  accounts: z.array(accountSchema),
});
const payloadSchema = z.object({ version: z.literal(1), updatedAt: instant("updatedAt"), providers: z.array(providerSchema) });

export type QuotaWindow = z.infer<typeof windowSchema>;
export type QuotaAccount = z.infer<typeof accountSchema>;
export type QuotaResets = z.infer<typeof resetsSchema>;
export type QuotaProvider = z.infer<typeof providerSchema>;
export type QuotaPayload = z.infer<typeof payloadSchema>;
/** The fields the judgements below read. Tests and callers may pass less than a full window. */
type WindowFacts = Pick<QuotaWindow, "id"> & Partial<Pick<QuotaWindow, "name" | "remainingPercent" | "resetsAt" | "remainingAmount" | "lengthSeconds">>;

export function parseQuotaPayload(value: unknown): QuotaPayload {
  const parsed = payloadSchema.safeParse(value);
  if (!parsed.success) throw new Error("CLIProxyAPI returned a quota response this app cannot read.");
  return parsed.data;
}

/**
 * Does the router pin this provider's account, or merely report the best one?
 * A provider whose accounts are served round-robin (OpenRouter keys) is
 * `rotating`: its selected account is the one with the most headroom, which
 * is worth drawing but must not be marked as routed.
 */
export function providerRouting(provider: Pick<QuotaProvider, "routing">): "pinned" | "rotating" {
  return provider.routing;
}

/** An account's windows, shortest first. Stable, so an unrecognised window keeps its arrival order after the known ones. */
export function orderedWindows<W extends WindowFacts>(account: { windows: readonly W[] } | undefined): W[] {
  return [...(account?.windows ?? [])].sort((left, right) => windowRank(left.id) - windowRank(right.id));
}

/**
 * The windows to draw, after the user's bar settings. A window is hidden only
 * when its setting is explicitly `false`, so a router that adds a window does
 * not hide it by accident.
 */
export function visibleWindows<W extends WindowFacts>(windows: readonly W[], settings: Readonly<Record<string, unknown>> = {}): W[] {
  return windows.filter((quotaWindow) => settings[quotaWindow.id] !== false);
}

/** A pool that answers or refuses and never reports a level. A bar would claim a measurement the provider does not make. */
export function isUnmeteredWindow(quotaWindow: WindowFacts | undefined): boolean {
  return quotaWindow?.id === "antigravity_gemini";
}

/**
 * What is left to spend, in whole US dollars, rounded down so the figure never
 * claims more than the account will pay out. A balance with something in it
 * but less than a dollar reads `<$1`, because an empty balance and a nearly
 * empty one stop work at different moments.
 */
export function formatAmount(remainingAmount: number | undefined): string | undefined {
  if (typeof remainingAmount !== "number" || !Number.isFinite(remainingAmount) || remainingAmount < 0) return undefined;
  if (remainingAmount === 0) return "$0";
  if (remainingAmount < 1) return "<$1";
  return `$${String(Math.floor(remainingAmount))}`;
}

/**
 * A countdown in one unit, never two. `1d 14h` reads as a precision a
 * countdown does not have. Minutes below an hour, hours below two days, days
 * above that.
 */
export function spanLabel(milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) return "";
  if (milliseconds <= 0) return "now";
  if (milliseconds < HOUR_MS) return `${String(Math.max(1, Math.round(milliseconds / MINUTE_MS)))}m`;
  const hours = milliseconds / HOUR_MS;
  return hours < 48 ? `${String(Math.round(hours))}h` : `${String(Math.round(hours / 24))}d`;
}

/** The same, for a window: empty where a balance has no reset at all. */
export function windowCountdown(quotaWindow: Pick<WindowFacts, "resetsAt">, now: Date): string {
  if (quotaWindow.resetsAt === null || quotaWindow.resetsAt === undefined) return "";
  return spanLabel(new Date(quotaWindow.resetsAt).getTime() - now.getTime());
}

export function windowSeconds(quotaWindow: WindowFacts): number | undefined {
  if (typeof quotaWindow.lengthSeconds === "number" && quotaWindow.lengthSeconds > 0) return quotaWindow.lengthSeconds;
  return WINDOW_SECONDS[quotaWindow.id];
}

/**
 * A short name for a window: its own label, or its length written the way the
 * countdown is (`5h`, `7d`). Undefined when neither is known; callers then use
 * the name the router gave it.
 */
export function windowLabel(quotaWindow: WindowFacts): string | undefined {
  const explicit = WINDOW_LABELS[quotaWindow.id];
  if (explicit !== undefined) return explicit;
  const length = windowSeconds(quotaWindow);
  if (length === undefined) return undefined;
  const days = length / (DAY_MS / 1000);
  if (Number.isInteger(days) && days >= 1) return `${String(days)}d`;
  const hours = length / (HOUR_MS / 1000);
  if (Number.isInteger(hours) && hours >= 1) return `${String(hours)}h`;
  return undefined;
}

/**
 * Nothing here can serve a request: every metered window is spent and every
 * unmetered pool is refusing.
 */
export function accountDrained(account: { windows: readonly WindowFacts[]; available?: boolean }, available = account.available ?? true): boolean {
  if (account.windows.length === 0) return false;
  return account.windows.every((quotaWindow) =>
    isUnmeteredWindow(quotaWindow) ? !available || (quotaWindow.remainingPercent ?? 0) <= 0 : (quotaWindow.remainingPercent ?? 0) <= 0);
}

/**
 * The share of the window still to run, or undefined when there is no answer.
 *
 * A reset that has already passed returns undefined, not zero. Zero means "no
 * time left at all", and every caller compares the remaining share against
 * it, so a payload that has merely gone stale would paint every account as
 * about to waste its whole allowance.
 */
export function windowPaceFraction(quotaWindow: WindowFacts, now: Date): number | undefined {
  const length = windowSeconds(quotaWindow);
  if (length === undefined || quotaWindow.resetsAt === null || quotaWindow.resetsAt === undefined) return undefined;
  const left = (new Date(quotaWindow.resetsAt).getTime() - now.getTime()) / 1000;
  if (!Number.isFinite(left) || left <= 0) return undefined;
  return Math.min(1, left / length);
}

/**
 * How far off an even spend a lane may sit, in points of its allowance,
 * before the meters call it a problem. Applied on both sides of pace: a
 * window one minute after its reset, at 99% with 99.99% of its time left, is
 * on pace, not dry.
 */
export const PACE_MARGIN_POINTS = 8;

export type Standing =
  /** No window length, or the reset has passed. No cut, no verdict. */
  | { kind: "unpaced"; pace: undefined }
  /** Nothing left. */
  | { kind: "drained"; pace: number }
  /** Short of pace by more than the margin: runs out before the window turns over. */
  | { kind: "dry"; pace: number }
  /** Past pace by more than the margin: credit will expire unspent. */
  | { kind: "loss"; pace: number }
  | { kind: "ok"; pace: number };

/**
 * Where a metered window stands against an even spend. `pace` is the share of
 * the window still to run, in points.
 *
 * There is deliberately no runway. A runway divides the credit left by the
 * rate it was spent at so far, which is a projection rather than a fact the
 * router stated: two meters on one window showed different runways for the
 * same reset. The clock beside a lane is always the reset.
 */
export function windowStanding(quotaWindow: WindowFacts, now: Date): Standing {
  const fraction = windowPaceFraction(quotaWindow, now);
  if (fraction === undefined) return { kind: "unpaced", pace: undefined };
  const pace = fraction * 100;
  const remaining = Math.max(0, Math.min(100, quotaWindow.remainingPercent ?? 0));
  if (remaining <= 0) return { kind: "drained", pace };
  if (remaining - pace >= PACE_MARGIN_POINTS) return { kind: "loss", pace };
  if (pace - remaining >= PACE_MARGIN_POINTS) return { kind: "dry", pace };
  return { kind: "ok", pace };
}

/** Old enough to doubt: five minutes without a fresh reading. */
export const STALE_AFTER_MS = 5 * MINUTE_MS;
export function isStale(updatedAt: string, now: Date): boolean {
  return now.getTime() - new Date(updatedAt).getTime() >= STALE_AFTER_MS;
}

function windowRank(windowId: string): number {
  const rank = WINDOW_ORDER.indexOf(windowId);
  return rank === -1 ? Number.POSITIVE_INFINITY : rank;
}
