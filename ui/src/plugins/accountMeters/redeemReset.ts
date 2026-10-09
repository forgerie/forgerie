import { z } from "zod";
import type { QuotaPayload } from "./quotaData";

/**
 * Spending one banked reset through the CLIProxyAPI router.
 *
 * The router owns the credentials and picks the grant; the browser names only
 * the account. Its contract (cliproxyapi-nix, docs/quota-router.md): POST
 * `<quota address>/resets/redeem` with the confirmation header, an exact body,
 * and a request id made once per confirmation. Sending the same id again
 * replays the recorded answer and never spends a second reset, so a retry
 * after an uncertain answer always reuses it.
 */

export interface RedeemRequest {
  provider: string;
  email: string;
  requestId: string;
  /** Claude keeps its reset dates (`preserve`); Codex starts them over (`restart`). The router checks it matches the provider. */
  clockPolicy: "preserve" | "restart";
}

/** What one redemption came to. */
export type RedeemOutcome =
  /** A reset is gone: this request spent it, or the provider says it was already used. */
  | { kind: "spent"; message: string }
  /** The router or provider refused. Nothing was spent. */
  | { kind: "refused"; message: string }
  /** No one can say whether a reset was spent. Retrying with the same id asks again and spends nothing more. */
  | { kind: "uncertain"; message: string };

/** Sends one redemption. Injected so tests and parts never spend a reset. */
export type RedeemReset = (endpoint: string, request: RedeemRequest) => Promise<RedeemOutcome>;

const CONFIRMATION = "use-one-reset";
const SPENT = new Set(["reset", "already_used"]);
/** A refusal the router records before any provider call, or one the provider answered for certain. */
const REFUSED = new Set(["invalid_request", "confirmation_required", "origin_rejected", "not_limited", "cooldown", "ineligible", "unavailable",
  "account_not_found", "ambiguous_account", "request_conflict"]);
const answerSchema = z.object({ result: z.string(), message: z.string().optional().catch(undefined) });

/** The redeem address beside a quota address: `…/quota` becomes `…/quota/resets/redeem`. */
export function redeemAddress(endpoint: string): string {
  const url = new URL(endpoint);
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/resets/redeem`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

/** A lowercase UUID v4, which the router requires of a request id. */
export function newRequestId(random: Crypto = crypto): string {
  if (typeof random.randomUUID === "function") return random.randomUUID().toLowerCase();
  const bytes = random.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** What the router's answer means. Anything it did not clearly say is uncertain, never success and never a refusal. */
export function redeemOutcome(status: number, body: unknown): RedeemOutcome {
  const parsed = answerSchema.safeParse(body);
  const result = parsed.success ? parsed.data.result : undefined;
  const said = parsed.success ? parsed.data.message : undefined;
  if (status === 200 && result !== undefined && SPENT.has(result)) {
    return { kind: "spent", message: result === "already_used" ? "The provider says this reset was already used." : said ?? "The reset was used." };
  }
  if (status >= 400 && status < 500 && result !== undefined && REFUSED.has(result)) {
    return { kind: "refused", message: said ?? `The router refused the reset (${result}).` };
  }
  return { kind: "uncertain", message: said ?? `The router answered HTTP ${String(status)}${result ? ` (${result})` : ""}.` };
}

export const redeemReset: RedeemReset = async (endpoint, request) => {
  let response: Response;
  try {
    response = await fetch(redeemAddress(endpoint), {
      method: "POST", cache: "no-store", credentials: "omit", mode: "cors",
      headers: { "Content-Type": "application/json", "X-Quota-Reset-Confirmation": CONFIRMATION },
      body: JSON.stringify({ provider: request.provider, email: request.email, requestId: request.requestId, confirm: true, clockPolicy: request.clockPolicy }),
    });
  } catch {
    // The request may have reached the router before the connection failed.
    return { kind: "uncertain", message: `Cannot reach ${new URL(endpoint).host}.` };
  }
  let body: unknown;
  try { body = await response.json(); } catch { body = undefined; }
  return redeemOutcome(response.status, body);
};

/** Resets this page spent, per account key, with when, so a reading taken before the spend does not offer them again. */
export type SpentResets = Readonly<Record<string, readonly number[]>>;

/**
 * The reading with resets this page spent taken off, until the router reads
 * the provider again. The router refreshes on its own timer, so for a few
 * minutes after a spend its reading still lists the reset that is gone, and a
 * second press would spend another.
 */
export function withoutSpent(payload: QuotaPayload, spent: SpentResets): QuotaPayload {
  const readAt = new Date(payload.updatedAt).getTime();
  return { ...payload, providers: payload.providers.map((provider) => ({ ...provider, accounts: provider.accounts.map((account) => {
    const gone = (spent[`${provider.id}/${account.email}`] ?? []).filter((at) => at > readAt).length;
    if (gone === 0 || !account.resets) return account;
    const expiresAt = account.resets.expiresAt.slice(gone);
    return { ...account, resets: expiresAt.length > 0 ? { ...account.resets, expiresAt } : undefined };
  }) })) };
}
