import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { modelKey, parseModelChoice, resolveModelChain } from "../../shared/modelChains.js";
import { recordModelChainFailure, type ModelChainRuntime } from "./modelChainFailures.js";
import { generateShortSessionName } from "./sessionNameGenerator.js";

/** A title has no conversation to continue. Try each entry once, in order, without waiting. */
export async function generateChainSessionName(reference: string, options: ModelChainRuntime, models: ModelRuntime, stream: StreamFn,
  input: string, signal: AbortSignal, report: (error: unknown) => void, now = Date.now): Promise<string | undefined> {
  const cancelled = () => signal.aborted;
  const entries = resolveModelChain(reference, options.modelChains?.() ?? {});
  for (const entry of entries) {
    if (cancelled()) return undefined;
    if (((await options.modelCooldowns?.snapshot())?.[modelKey(entry)]?.until ?? 0) > now()) continue;
    const choice = parseModelChoice(entry);
    if (choice === null) throw new Error("Invalid title chain entry");
    const model = models.getAvailableSnapshot().find(candidate => candidate.provider === choice.model.provider && candidate.id === choice.model.modelId);
    let error = `Model ${modelKey(entry)} is not available`;
    if (model !== undefined) {
      const name = await generateShortSessionName(stream, model, input, signal, (kind, diagnostic) => { error = diagnostic ?? `Title model returned ${kind}`; });
      if (name !== undefined) return name;
    }
    if (cancelled()) return undefined;
    await recordModelChainFailure(options, entry, error, now(), report);
  }
  return undefined;
}
