import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createRegistry } from "@earendil-works/pi-durable";
import { afterEach, describe, expect, it } from "vitest";
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

describe("Durable session journal", () => {
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
  it("selects another legacy tree branch without replaying its tools", async () => {
    const options = await fixture();
    const journal = await DurableSessionJournal.open(options);
    journals.push(journal);
    const user = options.manager.getEntries().find((entry) => entry.type === "message" && entry.message.role === "user");
    if (user === undefined) throw new Error("Fixture must contain a user entry");
    options.manager.branch(user.id);
    await journal.selectBranch();
    expect((await journal.conversation.context(context)).messages).toEqual([{ role: "user", content: "old input", timestamp: 1 }]);
    expect(options.provider.state.callCount).toBe(0);
  });
});
