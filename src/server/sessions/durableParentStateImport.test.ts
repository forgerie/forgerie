import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { expect, it } from "vitest";
import { importParentEntry } from "./durableParentStateImport.js";
import { ExtensionEntries, ImportedUsage, ParentAsks, ParentResponse, SessionName, initializeParentDocuments } from "./durableParentDocuments.js";
import { SESSION_RESPONSE_CUSTOM_TYPE } from "./sessionResponse.js";

it("seeds legacy spend once, excludes stamped native responses, and backfills metadata at marker cuts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-parent-import-"));
  const harness = await Harness.open(await openNodeSqliteStorage(join(directory, "state.sqlite")), {
    models: createModels(), registry: createRegistry(), conversationCreated: initializeParentDocuments,
  }, context);
  try {
    const parent = await harness.root(context);
    const manager = SessionManager.inMemory(directory);
    const legacy = fauxAssistantMessage("earlier paid answer");
    legacy.usage.input = 10;
    legacy.usage.output = 5;
    legacy.usage.totalTokens = 15;
    legacy.usage.cost.total = 0.75;
    manager.appendMessage(legacy);
    const stamped = { ...legacy, forgerieDurableEntryId: 123, forgerieDurableSessionId: "native" };
    manager.appendMessage(stamped);
    manager.appendSessionInfo("Earlier title");
    manager.appendCustomEntry("extension", { counter: 1 });
    manager.appendCustomEntry(SESSION_RESPONSE_CUSTOM_TYPE, { version: 1, kind: "asked", ask: { askId: "legacy-ask", askedAt: "2026-10-12T00:00:00Z", questions: [{ id: "q", question: "Continue?", options: [] }] } });
    const entries = manager.getEntries();
    const ids = [];
    for (const entry of entries) {
      ids.push(await parent.commit(async tx => {
        const marker = await tx.appendEntry(parent.id, { kind: "forgerie.import-marker", data: { sdkEntryId: entry.id } });
        await importParentEntry(tx, { id: parent.id }, marker.id, entry);
        // Retry the same source entry does not double either its spend or custom state.
        await importParentEntry(tx, { id: parent.id }, marker.id, entry);
        return marker.id;
      }, context));
    }
    const usage = await harness.snapshot(ImportedUsage, parent.id, context);
    expect(usage?.sourceEntryIds).toEqual([entries[0]?.id]);
    expect(usage?.usage.models[`${legacy.provider}/${legacy.model}`]).toMatchObject({ input: 10, output: 5, totalTokens: 15, cost: { total: 0.75 } });
    expect((await harness.snapshot(SessionName, parent.id, context))?.name).toBe("Earlier title");
    expect((await harness.snapshot(ExtensionEntries, parent.id, "extension", context))?.entries).toHaveLength(1);
    expect((await harness.snapshot(ParentAsks, parent.id, context))?.pending?.askId).toBe("legacy-ask");
    expect((await harness.snapshot(ParentResponse, parent.id, context))?.intent).toBe("questions");
    const first = ids[0];
    if (first === undefined) throw new Error("Expected import boundary");
    expect((await harness.snapshotAsOf(ImportedUsage, parent.id, first, context))?.usage.models[`${legacy.provider}/${legacy.model}`]?.cost.total).toBe(0.75);
    await parent.commit(async tx => {
      (await tx.doc(SessionName, parent.id)).name = "Present title";
      delete (await tx.doc(ParentAsks, parent.id)).pending;
      (await tx.doc(ParentResponse, parent.id)).intent = "nothing";
    }, context);
    for (const [index, entry] of entries.entries()) {
      const nativeId = ids[index];
      if (nativeId === undefined) throw new Error("Missing import marker");
      await parent.commit(tx => importParentEntry(tx, { id: parent.id }, nativeId, entry), context);
    }
    expect((await harness.snapshot(SessionName, parent.id, context))?.name).toBe("Present title");
    expect((await harness.snapshot(ParentAsks, parent.id, context))?.pending).toBeUndefined();
    expect((await harness.snapshot(ImportedUsage, parent.id, context))?.usage).toEqual(usage?.usage);
  } finally { await harness.close(context); await rm(directory, { recursive: true, force: true }); }
});
