import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createRegistry, UsageDoc, watchEvents } from "@earendil-works/pi-durable";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DurableSessionJournal, durableSessionPaths } from "./durableSessionJournal.js";

const directories: string[] = [];
const journals: DurableSessionJournal[] = [];
afterEach(async () => {
  await Promise.all(journals.splice(0).map((journal) => journal.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-durable-journal-"));
  directories.push(directory);
  const manager = SessionManager.create(directory, directory);
  manager.appendMessage({ role: "user", content: "old input", timestamp: 1 });
  manager.appendMessage(fauxAssistantMessage("old answer"));
  manager.appendCustomEntry("forgerie:test", { response: "reply", preserved: true });
  const models = createModels();
  const provider = fauxProvider();
  models.setProvider(provider.provider);
  provider.setResponses([fauxAssistantMessage("new answer"), fauxAssistantMessage("another answer")]);
  return { manager, models, registry: createRegistry(), agent: { model: { provider: "faux", modelId: "faux-1" } }, provider };
}

function expectReport(reports: readonly unknown[], message = "Invalid parent pi.usage"): void {
  expect(reports).toHaveLength(1);
  const report = reports[0];
  expect(report).toBeInstanceOf(Error);
  if (!(report instanceof Error)) throw new Error("Diagnostic must be an Error");
  expect(report.message).toContain(message);
}

describe("Durable session journal", () => {
  it.each(["fractional tokens", "negative cost"])("reports %s without losing the committed frame or last good usage", async malformed => {
    const options = await fixture();
    const reports: unknown[] = [];
    const journal = await DurableSessionJournal.open({ ...options, onReport: error => { reports.push(error); } });
    journals.push(journal);
    const good = { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5,
      cost: { input: 0.2, output: 0.3, cacheRead: 0, cacheWrite: 0, total: 0.5 } };
    await journal.conversation.commit(async tx => { (await tx.doc(UsageDoc, journal.conversation.id)).models = { paid: good }; }, context);
    const baseline = structuredClone(journal.usage);
    const laterFrames: unknown[] = [];
    const unsubscribe = journal.harness.subscribeCommits(frame => { laterFrames.push(frame); });
    const stream = await watchEvents(journal.harness, journal.conversation.id, context);
    const usages: unknown[] = [];
    stream.start(events => { for (const event of events) if (event.type === "usage_changed") usages.push(event.usage); return Promise.resolve(); });
    try {
      await expect(journal.conversation.commit(async tx => {
        const ledger = await tx.doc(UsageDoc, journal.conversation.id);
        const paid = ledger.models["paid"];
        if (paid === undefined) throw new Error("Fixture must contain paid usage");
        if (malformed === "fractional tokens") paid.input = 0.5;
        else paid.cost.total = -1;
      }, context)).resolves.toBeUndefined();
      expect(laterFrames).toHaveLength(1);
      await vi.waitFor(() => { expect(usages).toHaveLength(1); });
      expectReport(reports);
      expect(journal.usage).toEqual(baseline);
      // A later valid revision resumes accounting; invalid data remains in Durable rather than being rewritten.
      await journal.conversation.commit(async tx => { (await tx.doc(UsageDoc, journal.conversation.id)).models = { next: good }; }, context);
      expect(journal.usage).toEqual({ models: { next: good }, tools: {} });
    } finally { unsubscribe(); await stream.stop(); }
  });
  it("does not let a failing diagnostic callback reject a durable commit", async () => {
    const options = await fixture();
    const journal = await DurableSessionJournal.open({ ...options, onReport: () => { throw new Error("Reporter failure"); } });
    journals.push(journal);
    let frames = 0;
    const unsubscribe = journal.harness.subscribeCommits(() => { frames++; });
    const warning = vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
    try {
      await expect(journal.conversation.commit(async tx => {
        (await tx.doc(UsageDoc, journal.conversation.id)).models = { invalid: { input: -1, output: 0, cacheRead: 0, cacheWrite: 0,
          totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      }, context)).resolves.toBeUndefined();
      expect(frames).toBe(1);
      expectReport(warning.mock.calls.map(([error]) => error), "usage reporter failed");
      expect(journal.usage).toEqual({ models: {}, tools: {} });
    } finally { warning.mockRestore(); unsubscribe(); }
  });
  it("validates a malformed usage snapshot on reopen", async () => {
    const options = await fixture();
    const initialReports: unknown[] = [];
    const journal = await DurableSessionJournal.open({ ...options, onReport: error => { initialReports.push(error); } });
    journals.push(journal);
    await journal.conversation.commit(async tx => {
      (await tx.doc(UsageDoc, journal.conversation.id)).models = { invalid: { input: -1, output: 0, cacheRead: 0, cacheWrite: 0,
        totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    }, context);
    expect(initialReports).toHaveLength(1);
    await journal.close();
    const file = options.manager.getSessionFile();
    if (file === undefined) throw new Error("Fixture must persist");
    const reports: unknown[] = [];
    const reopened = await DurableSessionJournal.open({ ...options, manager: SessionManager.open(file), onReport: error => { reports.push(error); } });
    journals.push(reopened);
    expect(reopened.usage).toEqual({ models: {}, tools: {} });
    expectReport(reports);
  });
  it("imports history without executing it, preserves the original, and projects new messages once", async () => {
    const options = await fixture();
    const sessionFile = options.manager.getSessionFile();
    if (sessionFile === undefined) throw new Error("Fixture must persist");
    const original = await readFile(sessionFile, "utf8");
    const journal = await DurableSessionJournal.open(options);
    journals.push(journal);
    expect(options.provider.state.callCount).toBe(0);
    expect((await journal.conversation.context(context)).messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(await readFile(durableSessionPaths(sessionFile).original, "utf8")).toBe(original);
    const submission = await journal.conversation.submit({ type: "input", content: "new input", requestId: "stable" }, context);
    expect((await submission.wait(context)).status).toBe("done");
    await journal.project();
    await journal.project();
    expect(options.manager.getEntries().filter((entry) => entry.type === "message")).toHaveLength(4);
    expect(await readFile(durableSessionPaths(sessionFile).original, "utf8")).toBe(original);
    await journal.close();
    const reopenedOptions = { ...options, manager: SessionManager.open(sessionFile) };
    const reopened = await DurableSessionJournal.open(reopenedOptions);
    journals.push(reopened);
    expect(reopenedOptions.manager.getEntries().filter((entry) => entry.type === "message")).toHaveLength(4);
    expect((await reopened.conversation.submit({ type: "input", content: "new input", requestId: "stable" }, context)).id).toBe(submission.id);
    expect(options.provider.state.callCount).toBe(1);
    expect(reopenedOptions.manager.getEntries().some((entry) => entry.type === "custom" && entry.customType === "forgerie:test")).toBe(true);
  });
  it("repairs a missed JSONL projection after reopening", async () => {
    const options = await fixture();
    const journal = await DurableSessionJournal.open(options);
    journals.push(journal);
    await (await journal.conversation.submit({ type: "input", content: "missed projection" }, context)).wait(context);
    await journal.close();
    const sessionFile = options.manager.getSessionFile();
    if (sessionFile === undefined) throw new Error("Fixture must persist");
    const manager = SessionManager.open(sessionFile);
    expect(manager.getEntries().filter((entry) => entry.type === "message")).toHaveLength(2);
    const reopened = await DurableSessionJournal.open({ ...options, manager });
    journals.push(reopened);
    expect(manager.getEntries().filter((entry) => entry.type === "message")).toHaveLength(4);
  });
  it("does not recover a notification's native input as a user message after a missed projection", async () => {
    const options = await fixture();
    const journal = await DurableSessionJournal.open(options);
    journals.push(journal);
    options.manager.appendCustomMessageEntry("test:notification", "Background work finished.", true);
    const submission = await journal.submitCustomMessage("Background work finished.", "followUp");
    await submission.wait(context);
    await journal.close();
    const file = options.manager.getSessionFile();
    if (file === undefined) throw new Error("Fixture must persist");
    const manager = SessionManager.open(file);
    const reopened = await DurableSessionJournal.open({ ...options, manager });
    journals.push(reopened);
    expect(manager.buildSessionContext().messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(manager.buildSessionContext().messages.filter((message) => message.role === "custom")).toHaveLength(1);
    expect(manager.buildSessionContext().messages.filter((message) => message.role === "assistant")).toHaveLength(2);
  });
  it("makes the first user-only projection discoverable before an assistant completes", async () => {
    const options = await fixture();
    const manager = SessionManager.create(options.manager.getCwd(), options.manager.getSessionDir());
    const journal = await DurableSessionJournal.open({ ...options, manager });
    journals.push(journal);
    await journal.conversation.commit(async (tx) => {
      await tx.appendEntry(journal.conversation.id, { kind: "pi.input", model: [{ role: "user", content: "pending first request", timestamp: 1 }] });
    }, context);
    await journal.project();
    const listed = await SessionManager.list(manager.getCwd(), manager.getSessionDir());
    expect(listed.some((session) => session.id === manager.getSessionId())).toBe(true);
    expect(options.provider.state.callCount).toBe(0);
    const file = manager.getSessionFile();
    if (file === undefined) throw new Error("Fixture must persist");
    expect(SessionManager.open(file).buildSessionContext().messages).toHaveLength(1);
  });
  it("does not let an inherited parent stamp hide a new fork message with the same native ID", async () => {
    const options = await fixture();
    const manager = SessionManager.create(options.manager.getCwd(), options.manager.getSessionDir());
    manager.appendMessage({ role: "user", content: "parent input", timestamp: 1 });
    const parentMessage = { ...fauxAssistantMessage("parent answer"), forgerieDurableSessionId: "parent-session", forgerieDurableEntryId: 0 };
    manager.appendMessage(parentMessage);
    const journal = await DurableSessionJournal.open({ ...options, manager });
    journals.push(journal);
    const generatedId = await journal.conversation.commit(async (tx) => {
      const entry = await tx.appendEntry(journal.conversation.id, { kind: "pi.assistant", model: [fauxAssistantMessage("fork answer")] });
      return entry.id;
    }, context);
    await journal.close();
    const file = manager.getSessionFile();
    if (file === undefined) throw new Error("Fixture must persist");
    // Give the inherited frame the actual colliding ID without depending on the native allocator's implementation.
    const entries = manager.getEntries();
    for (const entry of entries) if (entry.type === "message" && "forgerieDurableEntryId" in entry.message) entry.message.forgerieDurableEntryId = generatedId;
    await writeFile(file, [manager.getHeader(), ...entries].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    const reopenedManager = SessionManager.open(file);
    const reopened = await DurableSessionJournal.open({ ...options, manager: reopenedManager });
    journals.push(reopened);
    expect(reopenedManager.buildSessionContext().messages.filter((message) => message.role === "assistant")).toHaveLength(2);
  });
  it("repairs an interrupted multi-message export by full family identity and message index", async () => {
    const options = await fixture();
    const journal = await DurableSessionJournal.open(options);
    journals.push(journal);
    const native = await journal.conversation.commit((tx) => tx.appendEntry(journal.conversation.id, {
      kind: "pi.user", model: [{ role: "user", content: "first contribution", timestamp: 2 }, { role: "user", content: "second contribution", timestamp: 3 }],
    }), context);
    await journal.project();
    const exported = options.manager.getEntries().filter((entry) => entry.type === "message" && "forgerieDurableEntryId" in entry.message && entry.message.forgerieDurableEntryId === native.id);
    expect(exported).toHaveLength(2);
    const first = exported[0];
    const second = exported[1];
    if (first === undefined || second === undefined) throw new Error("Missing exported contributions");
    await journal.close();
    const file = options.manager.getSessionFile();
    if (file === undefined) throw new Error("Fixture must persist");
    await writeFile(file, [options.manager.getHeader(), ...options.manager.getEntries().filter((entry) => entry.id !== second.id)].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    const manager = SessionManager.open(file);
    const reopened = await DurableSessionJournal.open({ ...options, manager });
    journals.push(reopened);
    expect(manager.getEntries().some((entry) => entry.id === first.id)).toBe(true);
    expect(manager.getEntries().filter((entry) => entry.type === "message" && "forgerieDurableEntryId" in entry.message && entry.message.forgerieDurableEntryId === native.id)).toHaveLength(2);
    expect(await reopened.nativeHistory.resolve(first.id, context)).toMatchObject({ entryId: native.id, messageIndex: 0 });
    expect(await reopened.nativeHistory.resolve(second.id, context)).toMatchObject({ entryId: native.id, messageIndex: 1 });
    expect(options.provider.state.callCount).toBe(0);
  });
  it("selects another legacy tree branch without replaying its tools", async () => {
    const options = await fixture();
    const journal = await DurableSessionJournal.open(options);
    journals.push(journal);
    const user = options.manager.getEntries().find((entry) => entry.type === "message" && entry.message.role === "user");
    if (user === undefined) throw new Error("Fixture must contain a user entry");
    const selected = await journal.nativeHistory.select(user.id, {}, context);
    await journal.selectHandle(selected.handle);
    expect(selected.editorText).toBe("old input");
    expect((await journal.conversation.context(context)).messages).toEqual([]);
    expect(options.provider.state.callCount).toBe(0);
  });
});
