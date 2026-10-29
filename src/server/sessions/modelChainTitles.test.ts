import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import { ModelCooldownRegistry } from "./modelCooldownRegistry.js";
import { firstUsableChainModel, generateChainSessionName } from "./modelChainTitles.js";

it("picks the first chain entry for a recap that is in the catalog and not cooling, without recording failures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-recap-chain-"));
  try {
    const models = await ModelRuntime.create({ authPath: join(directory, "auth.json"), modelsPath: join(directory, "models.json") });
    const provider = fauxProvider({ models: [{ id: "b" }, { id: "c" }], tokensPerSecond: 100000 });
    models.registerNativeProvider(provider.provider); await models.refresh({ allowNetwork: false });
    const cooldowns = new ModelCooldownRegistry(join(directory, "cooldowns.json"), error => { throw error; });
    const options = { modelChains: () => ({ worker: ["faux/missing", "faux/b", "faux/c"] }), modelCooldowns: cooldowns };
    expect((await firstUsableChainModel("worker", options, models, () => 1000))?.id).toBe("b");
    await cooldowns.mark("faux/b", 5000, "quota");
    expect((await firstUsableChainModel("worker", options, models, () => 1000))?.id).toBe("c");
    expect((await firstUsableChainModel("worker", options, models, () => 6000))?.id).toBe("b");
    await cooldowns.mark("faux/c", 5000, "quota");
    expect(await firstUsableChainModel("worker", options, models, () => 1000)).toBeUndefined();
    expect(Object.keys(await cooldowns.snapshot()).sort()).toEqual(["faux/b", "faux/c"]);
    await expect(firstUsableChainModel("unknown", options, models)).rejects.toThrow("Unknown model chain");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
it("tries title entries in order, persists quota failures, and skips cooling entries for the next title", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-title-chain-"));
  try {
    const models = await ModelRuntime.create({ authPath: join(directory, "auth.json"), modelsPath: join(directory, "models.json") });
    const provider = fauxProvider({ models: [{ id: "a" }, { id: "b" }], tokensPerSecond: 100000 });
    models.registerNativeProvider(provider.provider); await models.refresh({ allowNetwork: false });
    provider.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "insufficient_quota token=sk-secret" }), fauxAssistantMessage("Good Title"), fauxAssistantMessage("Next Title")]);
    const cooldowns = new ModelCooldownRegistry(join(directory, "cooldowns.json"), error => { throw error; });
    const calls: string[] = [];
    const options = { modelChains: () => ({ titles: ["faux/a", "faux/b"] }), modelCooldowns: cooldowns };
    const stream: typeof models.streamSimple = (model, request, opts) => { calls.push(model.id); return models.streamSimple(model, request, opts); };
    const generate = () => generateChainSessionName("titles", options, models, stream, "Original request", new AbortController().signal, error => { throw error; }, () => 1000);
    expect(await generate()).toBe("Good Title");
    expect(await generate()).toBe("Next Title");
    expect(calls).toEqual(["a", "b", "b"]);
    expect((await cooldowns.snapshot())["faux/a"]).toEqual({ until: 3_601_000, reason: "insufficient_quota token=[redacted]" });
    await cooldowns.mark("faux/b", 5000, "quota");
    expect(await generate()).toBeUndefined();
    expect(calls).toEqual(["a", "b", "b"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
