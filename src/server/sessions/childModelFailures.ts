import { isChildCredentialFailure } from "../../shared/childModelDiagnostic.js";
import { parseModelChoice, modelKey, selectChainModel, type ModelCooldowns } from "../../shared/modelChains.js";
import { MAX_CHILD_ATTEMPT } from "./childRequestIds.js";

export const CHILD_RETRY_DELAYS = [30_000, 120_000, 300_000] as const;
export type ChildModelFailure = "switch-now" | "wait-then-switch" | "fatal";
const LEGACY_TRANSIENT = /overloaded|\b5\d{2}\b|auth_unavailable|server[ _-]?busy|high demand|at capacity|rate[ _-]?limit|too many requests|\b429\b|service[ _-]?unavailable|(?:internal|server)[ _-]?error|websocket.*(?:closed|error)|stream.*(?:disconnect|ended|closed)|connection.*(?:reset|closed|lost|refused)|socket hang up|fetch failed|network.*error|timed? out|timeout|EAI_AGAIN|ECONNRESET|upstream.*(?:connect|error)/i;
const LEGACY_PERMANENT = /invalid.*(?:api[ _-]?key|credentials)|insufficient_quota|quota exceeded|billing|out of budget|usage limit reached|context.*(?:window|limit)|too many tokens/i;
const STATUS = /\b(?:HTTP(?:\/[\d.]+)?|status(?:[ _-]?code)?|error(?:[ _-]?code)?)["']?[\s:=]+["']?(?:429|5\d{2})\b|^\s*(?:429|5\d{2})\b|\((?:429|5\d{2})\)|\b(?:429|5\d{2})\s+(?:Internal\b|Too Many Requests\b|Service Unavailable\b|Overloaded\b|Bad Gateway\b|Gateway Timeout\b)/i;
const BILLING_STATUS = /\b(?:HTTP(?:\/[\d.]+)?|status(?:[ _-]?code)?|error(?:[ _-]?code)?)["']?[\s:=]+["']?402\b|^\s*402\b|\(402\)|\b402\s+Payment Required\b/i;
const TRANSIENT = /\boverloaded(?:_error)?\b|\bauth_unavailable\b|server[ _-]?busy|high demand|at capacity|\brate[ _-]?limit(?:[ _-](?:exceeded|error))?\b|too many requests|service[ _-]?unavailable|(?:internal|server)[ _-]?error|websocket.*(?:closed|error)|stream.*(?:disconnect|ended|closed)|connection.*(?:reset|closed|lost|refused)|socket hang up|fetch failed|network.*error|timed? out|timeout|EAI_AGAIN|ECONNRESET|upstream.*(?:connect|error)/i;
const SWITCH = /\b(?:insufficient_quota|billing_hard_limit_reached|enforced_spend_limit_reached|GoUsageLimitError|FreeUsageLimitError)\b|\b(?:out of|insufficient|exhausted) credits\b|\bcredit balance is too low\b|\bbilling (?:issue|error|problem|details|limit)\b|\bcheck your (?:plan and )?billing\b|\bquota exceeded\b|\bpayment required\b|\bout of budget\b|\bspend(?:ing)?[ -]limit\b|\busage[ _-]limit(?:[ _-]reached)?\b|\btry again in\s*~?\s*[\d.]+\s*min\b|\bmodel.*(?:not[ _-]?found|does not exist|not available|was not found)\b|\bunknown model\b/i;
export function classifyChildModelError(error: string): ChildModelFailure {
  if (/context.*(?:window|limit|length)|too many tokens|maximum.*tokens/i.test(error)) return "fatal";
  const requested = /server requested\s+([\d.]+)s retry delay/i.exec(error);
  if (isChildCredentialFailure(error) || BILLING_STATUS.test(error) || SWITCH.test(error) || (requested !== null && Number(requested[1]) > 60)) return "switch-now";
  return STATUS.test(error) || TRANSIENT.test(error) ? "wait-then-switch" : "fatal";
}
// Serialized with reporter checkpoints so redaction/truncation cannot change a replayed decision.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type ChildFailureAssessment = { kind: ChildModelFailure; retryLegacy: boolean; credentials?: boolean };
export function assessChildModelFailure(error: string): ChildFailureAssessment {
  return { kind: classifyChildModelError(error), credentials: isChildCredentialFailure(error), retryLegacy: !LEGACY_PERMANENT.test(error) && LEGACY_TRANSIENT.test(error) };
}
/** Durable settles missing catalog models as no_model, keeping the actual text only on its task receipt. */
export function unavailableChildModel(error: string): string | undefined {
  const spec = /^Model (\S+) is not available$/.exec(error)?.[1];
  return spec !== undefined && parseModelChoice(spec) !== null ? spec : undefined;
}
/** Absolute Unix milliseconds. Date-form Retry-After is parsed as UTC by Date.parse. */
export function childModelResetTime(error: string, now: number): number | undefined {
  const minutes = /try again in\s*~?\s*([\d.]+)\s*min/i.exec(error);
  const seconds = /server requested\s+([\d.]+)s retry delay/i.exec(error);
  const after = /retry[ -]after[\s:="']+([^\r\n"'}]+)/i.exec(error)?.[1]?.trim();
  const duration = minutes !== null ? Number(minutes[1]) * 60_000 : seconds !== null ? Number(seconds[1]) * 1000
    : after !== undefined && /^\d+(?:\.\d+)?(?:\s*(?:s|sec|seconds))?\b/i.test(after) ? Number.parseFloat(after) * 1000 : undefined;
  if (duration !== undefined && Number.isFinite(duration)) return now + duration;
  const date = after === undefined ? NaN : Date.parse(after);
  return Number.isFinite(date) ? Math.max(now, date) : undefined;
}
export function childModelCooldown(error: string, now: number): number | undefined {
  const kind = classifyChildModelError(error);
  return kind === "fatal" ? undefined : childModelResetTime(error, now) ?? now + (kind === "wait-then-switch" ? 300_000 : 3_600_000);
}

// Durable checkpoints require a JSON-compatible alias rather than an open interface.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type ChainProgress = { failed: string[]; waited: string[]; budget: number; exhausted?: boolean };
export type ChildFailurePlan = { kind: "report" } | { kind: "retry"; delay: number; progress: ChainProgress; retryAttempt: number }
  | { kind: "switch"; to: string; progress: ChainProgress; delay?: number; retryAttempt?: number };
/**
 * One-model chains deliberately retain the old transient-only retry policy. `attempt` is the request attempt that
 * just failed. A chain edited during a run can add models without end, so no attempt past MAX_CHILD_ATTEMPT is
 * admitted: recovery probes only that far, and a later attempt would hide its receipt.
 */
export function planChildModelFailure(input: { models: string[]; current: string; error: string; now: number; cooldowns: ModelCooldowns; progress?: ChainProgress; assessment?: ChildFailureAssessment; attempt?: number }): ChildFailurePlan {
  const { models, current, error, now, cooldowns } = input;
  if ((input.attempt ?? 0) >= MAX_CHILD_ATTEMPT) return { kind: "report" };
  const progress = structuredClone(input.progress ?? { failed: [], waited: [], budget: 0 });
  const assessment = input.assessment ?? assessChildModelFailure(error);
  // This predicate intentionally predates fallback classification, including its historical text matching.
  if (models.length === 1) {
    if (!assessment.retryLegacy) return { kind: "report" };
    const delay = CHILD_RETRY_DELAYS[progress.budget++];
    return delay === undefined ? { kind: "report" } : { kind: "retry", delay, progress, retryAttempt: progress.budget };
  }
  const failure = assessment.kind;
  if (failure === "fatal") return { kind: "report" };
  if (models.length > 1 && progress.exhausted !== true) {
    if (failure === "wait-then-switch" && !progress.waited.includes(modelKey(current))) {
      progress.waited.push(modelKey(current));
      return { kind: "retry", delay: 60_000, progress, retryAttempt: 1 };
    }
    if (!progress.failed.includes(modelKey(current))) progress.failed.push(modelKey(current));
    // Never move back to an earlier entry during a running turn, even when its reset is earlier.
    const position = models.findIndex((spec) => modelKey(spec) === modelKey(current));
    const remaining = position < 0 ? models.filter((spec) => !progress.failed.includes(modelKey(spec))) : models.slice(position + 1);
    const next = remaining.length === 0 ? undefined : selectChainModel(remaining, cooldowns, now, progress.failed);
    if (next !== undefined && !next.exhausted) return { kind: "switch", to: next.model, progress };
    const choice = selectChainModel([current, ...remaining], cooldowns, now, progress.failed);
    progress.exhausted = true;
    const delay = CHILD_RETRY_DELAYS[progress.budget++];
    return delay === undefined ? { kind: "report" } : modelKey(choice.model) === modelKey(current)
      ? { kind: "retry", delay, progress, retryAttempt: progress.budget }
      : { kind: "switch", to: choice.model, delay, progress, retryAttempt: progress.budget };
  }
  const delay = CHILD_RETRY_DELAYS[progress.budget++];
  return delay === undefined ? { kind: "report" } : { kind: "retry", delay, progress, retryAttempt: progress.budget };
}
