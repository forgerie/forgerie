import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, ProviderDoc, UsageDoc } from "@earendil-works/pi-durable";
import { expect, it, vi } from "vitest";
import { DurableJournalPool } from "./durableJournalPool.js";
import { createDurableNativeHistory, durableEntryPresentationId } from "./durableNativeHistory.js";
import { readSessionBindings } from "./durableSessionBindings.js";
import { durableChildExtensions, listChildren } from "./durableChildAgents.js";
import { finishWorkflow, proposeWorkflow, startWorkflowProposal, workflowExtension, workflowRuns } from "./durableWorkflowRuns.js";

it("forks native boundaries, keeps historical agents and identities, rejects invalid and mid-entry cuts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-native-fork-"));
  const pool = new DurableJournalPool();
  const options = { models: createModels(), registry: createRegistry() };
  try {
    const parent = await pool.acquire({ databasePath: join(directory, "state.sqlite"), sessionId: "parent", create: { instructions: "old agent" } }, options, context);
    const first = await parent.conversation.commit((tx) => tx.appendEntry(parent.conversation.id, { kind: "pi.user", model: [{ role: "user", content: "draft", timestamp: 1 }] }), context);
    await parent.conversation.configure({ instructions: "new agent" }, context);
    const multiple = await parent.conversation.commit((tx) => tx.appendEntry(parent.conversation.id, { kind: "test.multi", model: [{ role: "user", content: "one", timestamp: 2 }, { role: "user", content: "two", timestamp: 3 }] }), context);
    const history = createDurableNativeHistory(parent, { acquire: (address, ctx) => pool.acquireCandidate(address, options, ctx) });
    const firstId = durableEntryPresentationId(parent.address.journalId, first, 0);
    await expect(history.resolve("unknown", context)).rejects.toThrow();
    const empty = await history.fork(firstId, "before", "empty", context);
    expect(empty.selectedText).toBe("draft");
    expect((await empty.handle.conversation.context(context)).messages).toEqual([]);
    expect((await empty.handle.conversation.agent(context)).instructions).toBe("old agent");
    const at = await history.fork(firstId, "at", "at", context);
    expect((await at.handle.conversation.context(context)).messages).toHaveLength(1);
    expect((await at.handle.conversation.agent(context)).instructions).toBe("old agent");
    expect(await at.handle.harness.snapshot(UsageDoc, at.handle.conversation.id, context)).toEqual({ models: {}, tools: {} });
    expect(await at.handle.harness.snapshot(ProviderDoc, at.handle.conversation.id, context)).not.toEqual(await parent.harness.snapshot(ProviderDoc, parent.conversation.id, context));
    const inherited = createDurableNativeHistory(at.handle, { acquire: (address, ctx) => pool.acquireCandidate(address, options, ctx) });
    expect(await inherited.resolve(firstId, context)).toMatchObject({ conversationId: first.conversationId, entryId: first.id });
    await expect(inherited.resolve(durableEntryPresentationId(parent.address.journalId, multiple, 0), context)).rejects.toThrow();
    await expect(history.fork(durableEntryPresentationId(parent.address.journalId, multiple, 1), "before", "middle", context)).rejects.toThrow("mid-entry");
    const clone = await history.fork(durableEntryPresentationId(parent.address.journalId, multiple, 1), "at", "clone", context);
    expect((await clone.handle.conversation.context(context)).messages).toHaveLength(3);
    expect((await clone.handle.conversation.agent(context)).instructions).toBe("new agent");
    const before = await readSessionBindings(parent.harness, context);
    const cancelled = createDurableNativeHistory(parent, { acquire: (address, ctx) => pool.acquireCandidate(address, options, ctx), summarize: () => Promise.resolve({ cancelled: true }) });
    expect((await cancelled.select(firstId, { summarize: true }, context)).cancelled).toBe(true);
    expect(await readSessionBindings(parent.harness, context)).toEqual(before);
    const failed = createDurableNativeHistory(parent, { acquire: (address, ctx) => pool.acquireCandidate(address, options, ctx), validateCandidate: () => Promise.reject(new Error("candidate failed")) });
    await expect(failed.select(firstId, {}, context)).rejects.toThrow("candidate failed");
    expect((await readSessionBindings(parent.harness, context)).sessions["parent"]?.conversationId).toBe(parent.conversation.id);
    const selected = await history.select(firstId, {}, context);
    expect(selected.cancelled).toBe(false);
    expect((await selected.handle.conversation.context(context)).messages).toEqual([]);
    expect((await history.tree(context)).nodes.some((node) => node.id === firstId)).toBe(true);
    await Promise.all([empty.handle, at.handle, clone.handle, selected.handle, parent].map((handle) => handle.release(context)));
  } finally { await pool.close(context); await rm(directory, { recursive: true, force: true }); }
});

it("retains real child and workflow ownership and terminal tasks through fork and restart without copying their receipts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-native-owned-work-"));
  const pool = new DurableJournalPool();
  const provider = fauxProvider();
  const models = createModels();
  models.setProvider(provider.provider);
  const registry = createRegistry();
  const children = durableChildExtensions();
  for (const extension of [...children.parent, ...children.childOnly, workflowExtension()]) registry.install(extension);
  provider.setResponses([
    fauxAssistantMessage([fauxToolCall("child_agent", { action: "spawn", name: "worker", message: "Child task", isolation: "shared" })], { stopReason: "toolUse" }),
    ...Array.from({ length: 12 }, () => fauxAssistantMessage("Finished.")),
  ]);
  const options = { models, registry };
  try {
    const parent = await pool.acquire({ databasePath: join(directory, "state.sqlite"), sessionId: "parent", create: { model: { provider: "faux", modelId: "faux-1" } } }, options, context);
    await (await parent.conversation.submit({ type: "input", content: "Spawn a worker" }, context)).wait(context);
    await vi.waitFor(async () => {
      expect(await listChildren(parent.harness, parent.conversation.id, context)).toHaveLength(1);
      const work = await parent.harness.inspect(context);
      expect(work.tasks).toHaveLength(0);
      expect(work.submissions).toHaveLength(0);
    });
    const originalChildren = await listChildren(parent.harness, parent.conversation.id, context);
    const proposal = await parent.conversation.commit((tx) => proposeWorkflow(tx, parent.conversation.id, "proposal:once", {
      name: "one-task", summary: "Keep this workflow record", text: "---\nworkflow: {version: 1}\n---\nWait for review.\n", basis: { kind: "new" as const, reason: "No saved workflow fits." },
    }), context);
    const workflow = await startWorkflowProposal(parent.harness, parent.conversation, directory, "parent", proposal.id, {}, "launch-once", context);
    await vi.waitFor(async () => { expect((await parent.harness.inspect(context)).tasks).toHaveLength(0); });
    const history = createDurableNativeHistory(parent, { acquire: (address, ctx) => pool.acquireCandidate(address, options, ctx) });
    const leaf = (await parent.conversation.entries({}, 1, undefined, context)).items[0];
    if (leaf === undefined) throw new Error("Missing native leaf");
    const leafId = durableEntryPresentationId(parent.address.journalId, leaf, 0);
    await expect(history.fork(leafId, "at", "blocked-workflow", context)).rejects.toThrow("workflow remain active");
    await parent.conversation.commit((tx) => finishWorkflow(tx, parent.conversation.id, workflow.id, "completed", "Finished"), context);
    const originalWorkflows = await workflowRuns(parent.harness, parent.conversation.id, context);
    const tasks = await pool.inspectStorage(parent.address.databasePath, (storage) => storage.scanTasks({}, 256, undefined, context), context);
    expect(tasks.found).toBe(true);
    if (!tasks.found) throw new Error("Missing leased family");
    expect(tasks.value.items.some((task) => task.kind === "forgerie.workflow-launch")).toBe(true);
    expect(tasks.value.items.some((task) => task.kind === "forgerie.child-reporter")).toBe(true);
    const fork = (await history.fork(leafId, "at", "fork", context)).handle;
    expect(await listChildren(fork.harness, fork.conversation.id, context)).toEqual([]);
    expect(await workflowRuns(fork.harness, fork.conversation.id, context)).toEqual([]);
    expect(await pool.inspectStorage(fork.address.databasePath, (storage) => storage.scanTasks({}, 256, undefined, context), context)).toEqual(tasks);
    await parent.release(context);
    await fork.release(context);
    const reopenedParent = await pool.acquire(parent.address, options, context);
    const reopenedFork = await pool.acquire(fork.address, options, context);
    expect((await reopenedParent.harness.inspect(context)).scheduling).toBe("paused");
    expect(await listChildren(reopenedParent.harness, reopenedParent.conversation.id, context)).toEqual(originalChildren);
    expect(await workflowRuns(reopenedParent.harness, reopenedParent.conversation.id, context)).toEqual(originalWorkflows);
    expect(await listChildren(reopenedFork.harness, reopenedFork.conversation.id, context)).toEqual([]);
    expect(await workflowRuns(reopenedFork.harness, reopenedFork.conversation.id, context)).toEqual([]);
    expect(await pool.inspectStorage(reopenedFork.address.databasePath, (storage) => storage.scanTasks({}, 256, undefined, context), context)).toEqual(tasks);
    await reopenedParent.release(context);
    await reopenedFork.release(context);
  } finally { await pool.close(context); await rm(directory, { recursive: true, force: true }); }
});
