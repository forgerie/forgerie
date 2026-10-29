import { expect, it } from "vitest";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { Harness, MemoryStorage, configure, createRegistry } from "@earendil-works/pi-durable";
import { missingModelRun } from "./modelChainRecovery.js";

it("keeps a missing-model admission tied to its failed generation after a later generation also fails", async () => {
  const harness = await Harness.open(new MemoryStorage(), { models: createModels(), registry: createRegistry() }, context);
  try {
    const conversation = await harness.createConversation({ ownership: { kind: "ownerless" }, agent: { model: { provider: "missing", modelId: "a" } } }, context);
    const first = await (await conversation.submit({ type: "input", content: "First input", whenBusy: "reject" }, context)).wait(context);
    await conversation.commit(tx => configure(tx, conversation.id, { model: { provider: "missing", modelId: "b" } }), context);
    const second = await (await conversation.submit({ type: "input", content: "Second input", whenBusy: "reject" }, context)).wait(context);
    const a = await harness.commit(tx => missingModelRun(tx, conversation.id, first), context);
    const b = await harness.commit(tx => missingModelRun(tx, conversation.id, second), context);
    expect(a).toMatchObject({ model: "missing/a", error: "Model missing/a is not available" });
    expect(b).toMatchObject({ model: "missing/b", error: "Model missing/b is not available" });
    expect(a?.generation).not.toBe(b?.generation);
  } finally { await harness.close(context); }
});
