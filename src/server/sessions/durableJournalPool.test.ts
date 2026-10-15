import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, ProviderDoc, UsageDoc } from "@earendil-works/pi-durable";
import { expect, it } from "vitest";
import { DurableJournalPool } from "./durableJournalPool.js";
import { acquireDurableOwnership } from "./durableOwnership.js";
import { SessionBindings } from "./durableSessionBindings.js";
import { createDurableNativeHistory, durableEntryPresentationId } from "./durableNativeHistory.js";

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

it("keeps a sibling's provider run alive when the parent lease closes and never charges inherited spend", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-family-running-"));
  const pool = new DurableJournalPool();
  const provider = fauxProvider();
  const models = createModels();
  models.setProvider(provider.provider);
  const options = { models, registry: createRegistry() };
  let finish: (value: ReturnType<typeof fauxAssistantMessage>) => void = () => { throw new Error("Provider has not started"); };
  let started: () => void = () => { throw new Error("Missing provider gate"); };
  const running = new Promise<void>((resolve) => { started = resolve; });
  provider.setResponses([fauxAssistantMessage("paid parent answer"), () => new Promise((resolve) => { finish = resolve; started(); })]);
  try {
    const parent = await pool.acquire({ databasePath: join(directory, "state.sqlite"), sessionId: "parent", create: { model: { provider: "faux", modelId: "faux-1" } } }, options, context);
    await (await parent.conversation.submit({ type: "input", content: "parent turn" }, context)).wait(context);
    const tip = (await parent.conversation.entries({}, 1, undefined, context)).items[0];
    if (tip === undefined) throw new Error("Missing parent tip");
    const parentUsage = await parent.harness.snapshot(UsageDoc, parent.conversation.id, context);
    expect(Object.keys(parentUsage?.models ?? {})).not.toHaveLength(0);
    const history = createDurableNativeHistory(parent, { acquire: (address, ctx) => pool.acquireCandidate(address, options, ctx) });
    const fork = (await history.fork(durableEntryPresentationId(parent.address.journalId, tip, 0), "at", "fork", context)).handle;
    expect(await fork.harness.snapshot(UsageDoc, fork.conversation.id, context)).toEqual({ models: {}, tools: {} });
    const answer = await fork.conversation.submit({ type: "input", content: "sibling turn" }, context);
    await running;
    await parent.release(context);
    finish(fauxAssistantMessage("sibling survived"));
    expect((await answer.wait(context)).status).toBe("done");
    expect(provider.state.callCount).toBe(2);
    await fork.release(context);
    const reopened = await pool.acquire(fork.address, options, context);
    expect((await reopened.conversation.context(context)).messages.at(-1)).toMatchObject({ role: "assistant", content: [{ type: "text", text: "sibling survived" }] });
    await reopened.release(context);
  } finally { await pool.close(context); await rm(directory, { recursive: true, force: true }); }
});


it("borrows only a live execution owner and cannot reopen it after it stops, even while another read lease remains", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-family-read-"));
  const pool = new DurableJournalPool();
  try {
    const owner = await pool.acquire({ databasePath: join(directory, "state.sqlite"), sessionId: "parent", create: {} }, { models: createModels(), registry: createRegistry() }, context);
    const reader = await pool.acquireRead(owner.address, context);
    expect(reader.harness).toBe(owner.harness);
    await owner.release(context);
    await expect(pool.acquireRead(owner.address, context)).rejects.toThrow("Active Durable read owner closed");
    await reader.release(context);
    await expect(pool.acquireRead(owner.address, context)).rejects.toThrow("Active Durable read owner closed");
  } finally { await pool.close(context); await rm(directory, { recursive: true, force: true }); }
});
