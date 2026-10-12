import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { Harness, createRegistry, defineDoc } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { describe, expect, it } from "vitest";
import { ExtensionEntries, Handoff, ImportedUsage, Labels, Migration, NoticeReceipts, ParentAsks, ParentResponse, Presentation, SessionName, initializeParentDocuments } from "./durableParentDocuments.js";

describe("parent document policies on SQLite", () => {
  it("preserves the original import receipt when introducing session-scoped migration state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgerie-parent-migration-"));
    const harness = await Harness.open(await openNodeSqliteStorage(join(directory, "state.sqlite")), { models: createModels(), registry: createRegistry() }, context);
    const original = defineDoc<{ complete: boolean }>({ kind: "forgerie.import", version: 1, scope: "session", initial: () => ({ complete: false }) });
    try {
      const parent = await harness.root(context);
      await parent.commit(async tx => {
        (await tx.doc(original)).complete = true;
        await initializeParentDocuments(tx, { id: parent.id });
      }, context);
      expect(await harness.snapshot(original, context)).toEqual({ complete: true });
      expect(await harness.snapshot(Migration, context)).toMatchObject({ legacyImportComplete: true });
      expect(Migration.definition).not.toHaveProperty("history");
      expect(Migration.definition).not.toHaveProperty("fork");
    } finally { await harness.close(context); await rm(directory, { recursive: true, force: true }); }
  });
  it("rewinds execution and extension state, copies current visible metadata, and clears live work", async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgerie-parent-docs-"));
    const harness = await Harness.open(await openNodeSqliteStorage(join(directory, "state.sqlite")), {
      models: createModels(), registry: createRegistry(), conversationCreated: initializeParentDocuments,
    }, context);
    try {
      const parent = await harness.root(context);
      const cut = await parent.commit(async (tx) => {
        const entry = await tx.appendEntry(parent.id, { kind: "forgerie.test-cut", data: null });
        (await tx.doc(ParentResponse, parent.id)).intent = "reply";
        (await tx.doc(ExtensionEntries, parent.id, "example", null)).entries.push({ id: "custom-before", nativeEntryId: entry.id, timestamp: "2026-10-12T00:00:00Z", data: { count: 1 } });
        (await tx.doc(Presentation, parent.id, String(entry.id), null)).envelope = { type: "custom", customType: "example", display: true };
        (await tx.doc(ImportedUsage, parent.id)).sourceEntryIds.push("legacy-before");
        return entry.id;
      }, context);
      const future = await parent.commit(async (tx) => {
        const entry = await tx.appendEntry(parent.id, { kind: "forgerie.test-future", data: null });
        (await tx.doc(ParentResponse, parent.id)).intent = "nothing";
        (await tx.doc(ExtensionEntries, parent.id, "example", null)).entries.push({ id: "custom-after", nativeEntryId: entry.id, timestamp: "2026-10-12T00:00:01Z", data: { count: 2 } });
        (await tx.doc(ImportedUsage, parent.id)).sourceEntryIds.push("legacy-after");
        const labels = await tx.doc(Labels, parent.id);
        labels.entries["before"] = { nativeEntryId: cut, label: "current annotation" };
        labels.entries["after"] = { nativeEntryId: entry.id, label: "future annotation" };
        (await tx.doc(SessionName, parent.id)).name = "Current title";
        (await tx.doc(ParentAsks, parent.id)).pending = { askId: "open", askedAt: "2026-10-12T00:00:01Z", questions: [{ id: "q", question: "Continue?", options: [] }] };
        (await tx.doc(Handoff, parent.id)).operation = { sourceSessionId: "source", destinationSessionId: "destination", documentPath: "/tmp/handoff.md", phase: "delivering" };
        (await tx.doc(NoticeReceipts, parent.id)).receipts["notice"] = true;
        return entry.id;
      }, context);
      expect((await harness.snapshotAsOf(ParentResponse, parent.id, cut, context))?.intent).toBe("reply");
      expect((await harness.snapshotAsOf(ParentResponse, parent.id, future, context))?.intent).toBe("nothing");
      const fork = await parent.fork(cut, { ownership: { kind: "ownerless" } }, context);
      expect(await harness.snapshot(ParentResponse, fork.id, context)).toMatchObject({ intent: "reply" });
      expect((await harness.snapshot(ExtensionEntries, fork.id, "example", context))?.entries.map(entry => entry.id)).toEqual(["custom-before"]);
      expect((await harness.snapshot(Presentation, fork.id, String(cut), context))?.envelope).toMatchObject({ customType: "example" });
      expect((await harness.snapshot(ImportedUsage, fork.id, context))?.sourceEntryIds).toEqual(["legacy-before"]);
      expect((await harness.snapshot(Labels, fork.id, context))?.entries).toEqual({ before: { nativeEntryId: cut, label: "current annotation" } });
      expect((await harness.snapshot(SessionName, fork.id, context))?.name).toBe("Current title");
      expect((await harness.snapshot(ParentAsks, fork.id, context))?.pending).toBeUndefined();
      expect((await harness.snapshot(Handoff, fork.id, context))?.operation).toBeUndefined();
      expect((await harness.snapshot(NoticeReceipts, fork.id, context))?.receipts).toEqual({});
      await parent.commit(async tx => { (await tx.doc(SessionName, parent.id)).name = "Later title"; }, context);
      expect((await harness.snapshot(SessionName, fork.id, context))?.name).toBe("Current title");
    } finally { await harness.close(context); await rm(directory, { recursive: true, force: true }); }
  });
});
