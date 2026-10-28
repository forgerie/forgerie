import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import { KNOWN_THINKING_LEVELS, parseModelReference, type ThinkingLevel } from "./thinkingLevels.js";

/** IDs may contain slashes and colons (for example local/qwen:32b). */
export const ModelSpecSchema = Type.String({ pattern: "^[^\\s/:]+/[^\\s/:][^\\s/]*(?:/[^\\s/:][^\\s/]*)*$" });
export const ModelChainReferenceSchema = Type.String({ pattern: `^[a-z0-9][a-z0-9-]*(?::(?:${KNOWN_THINKING_LEVELS.join("|")}))?$` });
export const ModelChainsSchema = Type.Record(Type.String({ pattern: "^[a-z0-9][a-z0-9-]*$" }), Type.Array(ModelSpecSchema, { minItems: 1 }), { additionalProperties: false });
export type ModelChains = Static<typeof ModelChainsSchema>;
export interface ModelChoice { model: { provider: string; modelId: string }; thinkingLevel?: ThinkingLevel }
export function parseModelChoice(spec: string): ModelChoice | null {
  if (!Check(ModelSpecSchema, spec)) return null;
  const { model, thinkingLevel } = parseModelReference(spec);
  const slash = model.indexOf("/");
  return { model: { provider: model.slice(0, slash), modelId: model.slice(slash + 1) }, ...(thinkingLevel === undefined ? {} : { thinkingLevel }) };
}
export function resolveModelChain(reference: string, chains: ModelChains, thinking?: ThinkingLevel): string[] {
  const parsed = parseModelReference(reference);
  const entries = reference.includes("/") ? [reference] : Object.hasOwn(chains, parsed.model) ? chains[parsed.model] : undefined;
  if (entries === undefined) throw new Error(`Unknown model chain "${parsed.model}". Known chains: ${Object.keys(chains).sort().join(", ") || "(none)"}.`);
  if (!Check(reference.includes("/") ? ModelSpecSchema : ModelChainReferenceSchema, reference)) throw new Error(`Invalid model reference "${String(reference)}". Use provider/model-id[:thinking] or a model chain name.`);
  return entries.map((entry) => {
    const level = parseModelReference(entry).thinkingLevel ?? parsed.thinkingLevel ?? thinking;
    return parseModelReference(entry).thinkingLevel !== undefined || level === undefined ? entry : `${entry}:${level}`;
  });
}
/** Null is the workflow's explicit agent-file default; it suppresses a requested spawn override. */
export function childModelReference(declared: string | null | undefined, requested: string | undefined,
  profile?: { modelReference?: string; model?: { provider: string; modelId: string } }): string | undefined {
  return (declared === null ? undefined : declared ?? requested) ?? profile?.modelReference
    ?? (profile?.model === undefined ? undefined : `${profile.model.provider}/${profile.model.modelId}`);
}
export const modelKey = (spec: string): string => parseModelReference(spec).model;
export interface ModelCooldown { until: number; reason: string }
export type ModelCooldowns = Record<string, ModelCooldown>;
/** Keep order, except that cooling/failed entries are skipped. Exhaustion chooses the earliest reset. */
export function selectChainModel(models: readonly string[], cooldowns: ModelCooldowns, now: number, failed: readonly string[] = []): { model: string; exhausted: boolean } {
  const available = models.find((spec) => !failed.includes(modelKey(spec)) && (cooldowns[modelKey(spec)]?.until ?? 0) <= now);
  if (available !== undefined) return { model: available, exhausted: false };
  const earliest = [...models].sort((a, b) => (cooldowns[modelKey(a)]?.until ?? now) - (cooldowns[modelKey(b)]?.until ?? now))[0];
  if (earliest === undefined) throw new Error("A model chain must have at least one entry");
  return { model: earliest, exhausted: true };
}
