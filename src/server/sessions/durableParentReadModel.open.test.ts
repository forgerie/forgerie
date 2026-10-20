import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { Harness, InboxDoc, LiveDoc, UsageDoc, createRegistry } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { afterEach, expect, it, vi } from "vitest";
import { SessionEventHub } from "../realtime/sessionEventHub.js";
import { initializeParentDocuments, Presentation } from "./durableParentDocuments.js";
import { DurableParentReadModel } from "./durableParentReadModel.js";
import { bindSession } from "./durableSessionBindings.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-native-open-scan-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, "state.sqlite");
  const storage = await openNodeSqliteStorage(databasePath);
  const harness = await Harness.open(storage, { models: createModels(), registry: createRegistry() }, context);
  cleanups.push(() => harness.close(context));
  const conversation = await harness.root(context);
  await conversation.commit(async tx => {
    await initializeParentDocuments(tx, { id: conversation.id });
    await tx.doc(LiveDoc, conversation.id); await tx.doc(InboxDoc, conversation.id); await tx.doc(UsageDoc, conversation.id);
    await bindSession(tx, "family", "logical", conversation.id);
    for (let index = 0; index < 300; index++) await tx.appendEntry(conversation.id, { kind: "pi.user", model: [{ role: "user", content: String(index), timestamp: index }] });
  }, context);
  const handle = { harness, conversation, address: { databasePath, journalId: "family", sessionId: "logical", conversationId: conversation.id }, release: () => Promise.resolve() };
  const reader = new DurableParentReadModel({ handle, messageId: entry => String(entry.id) });
  const hub = new SessionEventHub();
  return { storage, harness, conversation, reader, hub, databasePath };
}

it("decodes each entry page only once for a cold committed open without writing or retaining a history cache", async () => {
  const { storage, harness, reader, hub } = await fixture();
  const scans = vi.spyOn(storage, "scanEntries");
  const commits = vi.fn();
  const stop = harness.subscribeCommits(commits);
  try {
    const first = await reader.open("/fixture", { limit: 50 }, hub, context);
    expect(first.page.total).toBe(300);
    expect(first.page.messages.at(-1)?.content).toBe("299");
    expect(scans).toHaveBeenCalledTimes(2);
    scans.mockClear();
    expect(await reader.open("/fixture", { limit: 50 }, hub, context)).toEqual(first);
    expect(scans).toHaveBeenCalledTimes(2);
    expect(commits).not.toHaveBeenCalled();
    expect((await harness.inspect(context)).scheduling).toBe("paused");
  } finally { stop(); }
});

it("retries the prepared entry pages when a commit appends during presentation membership reads", async () => {
  const { storage, harness, conversation, reader, hub } = await fixture();
  const snapshot = harness.snapshot.bind(harness);
  let appended = false;
  vi.spyOn(harness, "snapshot").mockImplementation(async (...args: Parameters<typeof harness.snapshot>) => {
    const value = await snapshot(...args);
    if (!appended && args[0].definition.kind === Presentation.definition.kind) {
      appended = true;
      await conversation.commit(async tx => {
        const entry = await tx.appendEntry(conversation.id, { kind: "pi.user", model: [{ role: "user", content: "committed during preparation", timestamp: 301 }] });
        (await tx.doc(Presentation, conversation.id, String(entry.id), null)).envelope = { type: "custom", customType: "notice", display: true };
      }, context);
    }
    return value;
  });
  const scans = vi.spyOn(storage, "scanEntries");
  const cut = await reader.open("/fixture", { limit: 50 }, hub, context);
  expect(cut.page.total).toBe(301);
  expect(cut.page.messages.at(-1)).toMatchObject({ role: "custom", customType: "notice", content: "committed during preparation" });
  expect(scans).toHaveBeenCalledTimes(4);
});

it("never returns preparation from a failed storage read and succeeds on a fresh retry", async () => {
  const { storage, reader, hub } = await fixture();
  vi.spyOn(storage, "scanEntries").mockRejectedValueOnce(new Error("storage unavailable"));
  await expect(reader.open("/fixture", { limit: 50 }, hub, context)).rejects.toThrow("storage unavailable");
  expect((await reader.open("/fixture", { limit: 50 }, hub, context)).page.total).toBe(300);
});

it("refuses reads after a failed durable commit and never exposes the failed entry after reopening", async () => {
  const { storage, harness: poisoned, conversation, reader, hub, databasePath } = await fixture();
  const stop = reader.observeHistory();
  const append = (target: typeof conversation, content: string) => target.commit(tx => tx.appendEntry(target.id, { kind: "pi.user", model: [{ role: "user", content, timestamp: 301 }] }), context);
  try {
    expect((await reader.open("/fixture", { limit: 50 }, hub, context)).page.total).toBe(300);
    vi.spyOn(storage, "commit").mockRejectedValueOnce(new Error("disk write failed"));
    await expect(append(conversation, "failed write")).rejects.toThrow("disk write failed");
    // The observed history cannot serve a cut after the failure; the harness refuses reads until reopened.
    await expect(reader.open("/fixture", { limit: 50 }, hub, context)).rejects.toThrow("poisoned");
  } finally { stop(); }
  // Restart semantics: the poisoned owner closes before a new owner reads the file.
  await poisoned.close(context);
  const harness = await Harness.open(await openNodeSqliteStorage(databasePath), { models: createModels(), registry: createRegistry() }, context);
  try {
    const reopened = await harness.conversation(conversation.id, context);
    if (reopened === undefined) throw new Error("Persisted conversation missing");
    const handle = { harness, conversation: reopened, address: { databasePath, journalId: "family", sessionId: "logical", conversationId: reopened.id }, release: () => Promise.resolve() };
    const fresh = new DurableParentReadModel({ handle, messageId: entry => String(entry.id) });
    const recovered = await fresh.open("/fixture", { limit: 50 }, hub, context);
    expect(recovered.page.total).toBe(300);
    expect(JSON.stringify(recovered.page.messages)).not.toContain("failed write");
    await append(reopened, "durable retry");
    const after = await fresh.open("/fixture", { limit: 50 }, hub, context);
    expect(after.page.total).toBe(301);
    expect(after.page.messages.at(-1)?.content).toBe("durable retry");
  } finally { await harness.close(context); }
});

it("records optional preparation and projection phases without changing the cut or masking errors", async () => {
  const { createStackLatencyContext } = await import("../realtime/stackLatency.js");
  const { storage, reader, hub } = await fixture();
  const phases: string[] = [];
  const trace = createStackLatencyContext({ traceId: "1".repeat(32), clock: "sessiond", operation: "session-open", sink: { record(span) { phases.push(span.phase); throw new Error("diagnostic sink failed"); } } });
  try {
    const untraced = await reader.open("/fixture", { limit: 50 }, hub, context);
    expect(await reader.open("/fixture", { limit: 50 }, hub, context, undefined, trace)).toEqual(untraced);
    expect(phases).toEqual(["storage-read", "projection"]);
    vi.spyOn(storage, "scanEntries").mockRejectedValueOnce(new Error("read failed"));
    await expect(reader.open("/fixture", { limit: 50 }, hub, context, undefined, trace)).rejects.toThrow("read failed");
    expect(trace.diagnostics().errors).toBe(3);
  } finally { trace.dispose(); }
});
