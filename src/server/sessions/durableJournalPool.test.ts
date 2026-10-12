import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, ProviderDoc, UsageDoc } from "@earendil-works/pi-durable";
import { expect, it } from "vitest";
import { DurableJournalPool } from "./durableJournalPool.js";
import { acquireDurableOwnership } from "./durableOwnership.js";
import { SessionBindings } from "./durableSessionBindings.js";

it("shares one owner across logical sessions, releases leases independently, and reopens bindings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-family-"));
  const pool = new DurableJournalPool();
  const options = { models: createModels(), registry: createRegistry() };
  const databasePath = join(directory, "state.sqlite");
  try {
    const parent = await pool.acquire({ databasePath, sessionId: "parent", create: { instructions: "historical" } }, options, context);
    const anchor = (await parent.conversation.entries({ order: "ascending" }, 1, undefined, context)).items[0];
    if (anchor === undefined) throw new Error("Missing origin");
    const fork = await parent.conversation.fork(anchor.id, { ownership: { kind: "ownerless" }, init: async (tx, id) => {
      const bindings = await tx.doc(SessionBindings);
      bindings.sessions["fork"] = { conversationId: id, retained: [id], parentSessionId: "parent" };
    } }, context);
    const sibling = await pool.acquire({ ...parent.address, sessionId: "fork", conversationId: fork.id }, options, context);
    expect(sibling.harness).toBe(parent.harness);
    await expect(acquireDurableOwnership(databasePath)).rejects.toThrow("ownership lost or already held");
    const parentProvider = await parent.harness.snapshot(ProviderDoc, parent.conversation.id, context);
    const forkProvider = await sibling.harness.snapshot(ProviderDoc, sibling.conversation.id, context);
    expect(forkProvider?.sessionId).not.toBe(parentProvider?.sessionId);
    expect(await sibling.harness.snapshot(UsageDoc, sibling.conversation.id, context)).toEqual({ models: {}, tools: {} });
    await parent.release(context);
    await parent.release(context);
    await sibling.conversation.commit((tx) => tx.appendEntry(sibling.conversation.id, { kind: "test.note", data: "still open" }), context);
    await sibling.release(context);
    const reopenedParent = await pool.acquire(parent.address, options, context);
    const reopenedSibling = await pool.acquire(sibling.address, options, context);
    expect(reopenedParent.harness).toBe(reopenedSibling.harness);
    expect(await reopenedSibling.harness.snapshot(ProviderDoc, reopenedSibling.conversation.id, context)).toEqual(forkProvider);
    expect(await reopenedParent.conversation.agent(context)).toMatchObject({ instructions: "historical" });
    await reopenedParent.release(context);
    await reopenedSibling.release(context);
  } finally { await pool.close(context); await rm(directory, { recursive: true, force: true }); }
});
