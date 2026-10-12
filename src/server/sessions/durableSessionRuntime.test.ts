import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry } from "@earendil-works/pi-durable";
import { expect, it } from "vitest";
import { DurableJournalPool } from "./durableJournalPool.js";
import { createDurableNativeHistory, durableEntryPresentationId } from "./durableNativeHistory.js";
import { createNativeForkCandidate } from "./durableSessionRuntime.js";
import { durableFamilyAddresses } from "./durableSessionAddress.js";

it("releases a failed candidate lease without closing the parent, and repairs a missed catalog publication from bindings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-native-candidate-"));
  const pool = new DurableJournalPool();
  const options = { models: createModels(), registry: createRegistry() };
  try {
    const parent = await pool.acquire({ databasePath: join(directory, "state.sqlite"), sessionId: "parent", create: {} }, options, context);
    const anchor = (await parent.conversation.entries({}, 1, undefined, context)).items[0];
    if (anchor === undefined) throw new Error("Missing origin");
    const history = createDurableNativeHistory(parent, { acquire: (address, ctx) => pool.acquireCandidate(address, options, ctx) });
    await expect(createNativeForkCandidate(history, durableEntryPresentationId(parent.address.journalId, anchor, 0), "at", "failed-candidate", context,
      () => Promise.reject(new Error("provider resources unavailable")))).rejects.toThrow("provider resources unavailable");
    await parent.conversation.commit((tx) => tx.appendEntry(parent.conversation.id, { kind: "test.still-usable" }), context);
    const unpublished = createDurableNativeHistory(parent, { acquire: (address, ctx) => pool.acquireCandidate(address, options, ctx), publishCatalog: () => Promise.reject(new Error("catalog unavailable")) });
    await expect(unpublished.fork(durableEntryPresentationId(parent.address.journalId, anchor, 0), "at", "unpublished", context)).rejects.toThrow("catalog unavailable");
    const catalog = await durableFamilyAddresses(parent, context);
    const repaired = catalog.find((address) => address.sessionId === "unpublished");
    if (repaired === undefined) throw new Error("Binding lost a committed logical fork");
    const recovered = await pool.acquire(repaired, options, context);
    expect(recovered.harness).toBe(parent.harness);
    expect((await recovered.conversation.context(context)).messages).toEqual([]);
    await recovered.release(context);
    await parent.release(context);
    // All failed and recovered candidates released their leases; the family can reopen.
    const reopened = await pool.acquire(parent.address, options, context);
    expect(reopened.conversation.id).toBe(parent.conversation.id);
    await reopened.release(context);
  } finally { await pool.close(context); await rm(directory, { recursive: true, force: true }); }
});
