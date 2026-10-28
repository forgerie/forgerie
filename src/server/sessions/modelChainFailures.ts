import { childModelDiagnostic } from "../../shared/childModelDiagnostic.js";
import { modelKey, type ModelChains, type ModelCooldowns } from "../../shared/modelChains.js";
import { assessChildModelFailure, childModelCooldown } from "./childModelFailures.js";
import type { ModelCooldownRegistry } from "./modelCooldownRegistry.js";

export interface ModelChainRuntime {
  defaultModelChain?: () => string | undefined;
  modelChains?: () => ModelChains;
  modelCooldowns?: Pick<ModelCooldownRegistry, "snapshot" | "mark">;
}
/** Classify before sanitizing. A failed registry write keeps the local deadline without hiding the provider outcome. */
export async function recordModelChainFailure(options: ModelChainRuntime, current: string | undefined, error: string, now: number,
  report: (error: unknown) => void): Promise<{ assessment: ReturnType<typeof assessChildModelFailure>; diagnostic: string; cooldowns: ModelCooldowns }> {
  const assessment = assessChildModelFailure(error);
  const diagnostic = childModelDiagnostic(error, assessment.credentials);
  const until = childModelCooldown(error, now);
  let marked = false;
  if (current !== undefined && until !== undefined && options.modelCooldowns !== undefined) {
    try { await options.modelCooldowns.mark(modelKey(current), until, diagnostic); marked = true; }
    catch (cause) { report(cause); }
  }
  const cooldowns = await options.modelCooldowns?.snapshot() ?? {};
  if (!marked && current !== undefined && until !== undefined) {
    const previous = cooldowns[modelKey(current)];
    cooldowns[modelKey(current)] = { until: Math.max(previous?.until ?? 0, until), reason: previous !== undefined && previous.until > until ? childModelDiagnostic(previous.reason) : diagnostic };
  }
  return { assessment, diagnostic, cooldowns };
}
