import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createRegistry } from "@earendil-works/pi-durable";
import { expect, it } from "vitest";
import { DurableJournalPool } from "./durableJournalPool.js";
import { importDurableLegacyTree, LegacyTree } from "./durableLegacyImport.js";
import { createDurableNativeHistory } from "./durableNativeHistory.js";
import { readSessionBindings } from "./durableSessionBindings.js";

it("imports and reopens the whole branched SDK graph without calling a provider or duplicating prefixes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-legacy-tree-"));
  const pool = new DurableJournalPool();
  try {
    const manager = SessionManager.inMemory(directory);
    const user = manager.appendMessage({ role: "user", content: "common input", timestamp: 1 });
    const left = manager.appendMessage(fauxAssistantMessage("left"));
    manager.branch(user);
    const right = manager.appendMessage(fauxAssistantMessage("right"));
    manager.appendCustomEntry("extension.test", { preserved: [1, 2, 3] });
    const models = createModels();
    const provider = fauxProvider();
    models.setProvider(provider.provider);
    const options = { models, registry: createRegistry() };
    const initial = await pool.acquire({ databasePath: join(directory, "state.sqlite"), sessionId: manager.getSessionId(), create: {} }, options, context);
    await importDurableLegacyTree(initial, manager, context);
    await importDurableLegacyTree(initial, manager, context);
    const binding = (await readSessionBindings(initial.harness, context)).sessions[manager.getSessionId()];
    expect(binding?.retained.length).toBeGreaterThan(1);
    const selected = await pool.acquire({ databasePath: initial.address.databasePath, sessionId: manager.getSessionId() }, options, context);
    expect((await selected.conversation.context(context)).messages).toEqual(manager.buildSessionContext().messages);
    const history = createDurableNativeHistory(selected, { acquire: (address, ctx) => pool.acquireCandidate(address, options, ctx) });
    const graph = await history.tree(context);
    expect(graph.nodes.filter((node) => node.kind === "user")).toHaveLength(1);
    expect(graph.nodes.find((node) => node.id === left)?.parentId).toBe(user);
    expect(graph.nodes.find((node) => node.id === right)?.parentId).toBe(user);
    await expect(history.resolve(left, context)).rejects.toThrow("invisible");
    const target = await history.select(left, {}, context);
    expect((await target.handle.conversation.context(context)).messages).toHaveLength(2);
    expect(provider.state.callCount).toBe(0);
    const imported = await target.handle.harness.snapshot(LegacyTree, context);
    expect(imported?.entries).toHaveLength(manager.getEntries().length);
    await Promise.all([initial, selected, target.handle].map((handle) => handle.release(context)));
    // The stale catalog address must follow the committed binding, not select the old branch.
    const reopened = await pool.acquire({ databasePath: initial.address.databasePath, sessionId: manager.getSessionId() }, options, context);
    expect(reopened.conversation.id).toBe(target.handle.conversation.id);
    expect(provider.state.callCount).toBe(0);
    await reopened.release(context);
  } finally { await pool.close(context); await rm(directory, { recursive: true, force: true }); }
});

it("resumes graph import from a receipt without adding a second prefix or trusting an unverified checkpoint", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-import-resume-"));
  const pool = new DurableJournalPool();
  try {
    const manager = SessionManager.inMemory(directory);
    manager.appendMessage({ role: "user", content: "first", timestamp: 1 });
    manager.appendMessage(fauxAssistantMessage("answer"));
    manager.appendCustomEntry("saved-extension", { value: "kept" });
    const options = { models: createModels(), registry: createRegistry() };
    const parent = await pool.acquire({ databasePath: join(directory, "state.sqlite"), sessionId: manager.getSessionId(), create: {} }, options, context);
    let commits = 0;
    await expect(importDurableLegacyTree(parent, manager, context, () => {
      commits++;
      return commits === 2 ? Promise.reject(new Error("backfill failed")) : Promise.resolve();
    })).rejects.toThrow("backfill failed");
    const before = (await parent.conversation.entries({ order: "ascending" }, 256, undefined, context)).items;
    expect(before).toHaveLength(2);
    await parent.release(context);
    const reopened = await pool.acquire(parent.address, options, context);
    await importDurableLegacyTree(reopened, manager, context);
    const after = (await reopened.conversation.entries({ order: "ascending" }, 256, undefined, context)).items;
    expect(after).toHaveLength(4);
    expect(after[1]?.id).toBe(before[1]?.id);
    expect((await reopened.conversation.context(context)).messages).toEqual(manager.buildSessionContext().messages);
    await reopened.release(context);
  } finally { await pool.close(context); await rm(directory, { recursive: true, force: true }); }
});
