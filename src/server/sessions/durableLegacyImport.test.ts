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
