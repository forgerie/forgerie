import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { Harness, MemoryStorage, createRegistry, UsageDoc, LiveDoc, GenerationTask } from "@earendil-works/pi-durable";
import { expect, it } from "vitest";
import { RECAP_ENTRY_KIND, type RecapData } from "../../shared/sessionRecap.js";
import { DurableParentReadModel } from "./durableParentReadModel.js";
import { commitSessionRecap, readRecapHistory } from "./durableSessionRecap.js";
import { Presentation } from "./durableParentDocuments.js";
import { buildRecapPrompt } from "./sessionRecapGenerator.js";
import type { DurableSessionHandle } from "./durableSessionAddress.js";
import { responseFromBranch } from "./sessionResponse.js";

const data: RecapData = { goal: "Ship a fix", done: ["Implemented"], left: ["Not deployed"], next: null, trigger: "manual",
  model: "faux/faux-1", messageCount: 2, coversThroughEntryId: "2", runEndedAt: "2026-01-01T00:00:00.000Z", generatedAt: "2026-01-01T00:10:00.000Z" };
async function fixture() {
  const harness = await Harness.open(new MemoryStorage(), { models: createModels(), registry: createRegistry() }, context);
  const conversation = await harness.root(context);
  const handle: DurableSessionHandle = { harness, conversation, address: { databasePath: "/tmp/recap-test", journalId: "recap", sessionId: "test", conversationId: conversation.id }, release: () => Promise.resolve() };
  const reader = new DurableParentReadModel({ handle, messageId: entry => `entry:${String(entry.id)}` });
  const user = () => conversation.commit(tx => tx.appendEntry(conversation.id, { kind: "pi.user", model: [{ role: "user", content: "Please fix it", timestamp: 1 }] }), context);
  const answer = () => conversation.commit(tx => tx.appendEntry(conversation.id, { kind: "pi.assistant", model: [fauxAssistantMessage("Implemented, not deployed")] }), context);
  return { harness, conversation, handle, reader, user, answer };
}
it("appends a data-only recap that reaches browser history without entering context or counting as an assistant reply", async () => {
  const f = await fixture();
  try {
    await f.user(); const answer = await f.answer();
    const before = await f.conversation.context(context);
    const usage = { ...fauxAssistantMessage("usage").usage, input: 30, output: 20, totalTokens: 50 };
    expect(await commitSessionRecap(f.handle, answer.id, data, usage, data.model)).toBe(true);
    const entries = (await f.conversation.entries({ order: "ascending" }, 256, undefined, context)).items;
    const recap = entries.at(-1);
    expect(recap).toMatchObject({ kind: RECAP_ENTRY_KIND, data }); expect(recap?.model).toBeUndefined();
    expect((await f.conversation.context(context)).messages).toEqual(before.messages);
    const messages = await f.reader.messages(context);
    expect(messages.at(-1)).toMatchObject({ role: "custom", customType: RECAP_ENTRY_KIND, details: data });
    expect((await f.reader.statistics(context)).assistantMessages).toBe(1);
    expect((await f.harness.snapshot(UsageDoc, f.conversation.id, context))?.models[data.model]?.totalTokens).toBe(50);
    const history = await readRecapHistory(f.handle);
    expect(history).toMatchObject({ completedTurns: 1, newTurns: 0, lastRecap: data, newestEntryId: String(answer.id) });
    expect(history.messages).toHaveLength(2);
    expect(responseFromBranch([{ type: "custom_message", customType: RECAP_ENTRY_KIND, content: "While you were away", details: data }]).response.kind).toBe("none");
  } finally { await f.harness.close(context); }
});
it("discards stale recap after transcript advances and still charges its request usage", async () => {
  const f = await fixture();
  try {
    await f.user(); const answer = await f.answer(); await f.user();
    const usage = { ...fauxAssistantMessage("usage").usage, totalTokens: 9 };
    expect(await commitSessionRecap(f.handle, answer.id, data, usage, data.model)).toBe(false);
    expect((await f.reader.messages(context)).some(message => message.customType === RECAP_ENTRY_KIND)).toBe(false);
    expect((await f.harness.snapshot(UsageDoc, f.conversation.id, context))?.models[data.model]?.totalTokens).toBe(9);
  } finally { await f.harness.close(context); }
});
it("discards when a new run starts before its first transcript entry", async () => {
  const f = await fixture();
  try {
    await f.user(); const answer = await f.answer();
    await f.conversation.commit(async tx => {
      const taskId = await tx.createTask(GenerationTask, {}, { ownership: { kind: "conversation" } });
      (await tx.doc(LiveDoc, f.conversation.id)).run = { taskId, inputs: [] };
    }, context);
    expect(await commitSessionRecap(f.handle, answer.id, data, undefined, data.model)).toBe(false);
  } finally { await f.harness.close(context); }
});
it("reads imported legacy history as conversation turns", async () => {
  const f = await fixture();
  try {
    for (let turn = 0; turn < 3; turn++) {
      await f.conversation.commit(tx => tx.appendEntry(f.conversation.id, { kind: "forgerie.legacy-message", model: [{ role: "user", content: `Imported request ${String(turn)}`, timestamp: turn }], data: { sdkEntryId: `u${String(turn)}` } }), context);
      await f.conversation.commit(tx => tx.appendEntry(f.conversation.id, { kind: "forgerie.legacy-message", model: [fauxAssistantMessage(`Imported answer ${String(turn)}`)], data: { sdkEntryId: `a${String(turn)}` } }), context);
    }
    const history = await readRecapHistory(f.handle);
    expect(history).toMatchObject({ completedTurns: 3, hasExchange: true });
    expect(history.messages).toHaveLength(6);
  } finally { await f.harness.close(context); }
});
it("skips custom messages and shell runs that are stored as user messages, imported or native", async () => {
  const f = await fixture();
  try {
    await f.user(); await f.answer();
    const presented = (kind: string, content: string, envelope: { type: "custom" | "bashExecution"; customType?: string; display?: boolean; command?: string }) =>
      f.conversation.commit(async tx => {
        const entry = await tx.appendEntry(f.conversation.id, { kind, model: [{ role: "user", content, timestamp: 2 }], data: { sdkEntryId: content } });
        (await tx.doc(Presentation, f.conversation.id, String(entry.id), null)).envelope = envelope;
      }, context);
    await presented("forgerie.legacy-message", "hidden extension note", { type: "custom", customType: "note", display: false });
    await f.answer();
    await presented("forgerie.legacy-message", "Ran `ls`\n```\nsecret.txt\n```", { type: "bashExecution", command: "ls" });
    await f.answer();
    await presented("pi.user", "visible extension card", { type: "custom", customType: "card", display: true });
    await f.answer();
    await f.conversation.commit(tx => tx.appendEntry(f.conversation.id, { kind: "forgerie.legacy-message", model: [{ role: "system", content: "imported system prompt", timestamp: 3 }], data: { sdkEntryId: "s" } }), context);
    const history = await readRecapHistory(f.handle);
    const text = JSON.stringify(history.messages);
    expect(text).not.toContain("hidden extension note"); expect(text).not.toContain("secret.txt");
    expect(text).not.toContain("visible extension card");
    expect(buildRecapPrompt(history.messages)?.prompt).not.toContain("imported system prompt");
    expect(history.completedTurns).toBe(1);
  } finally { await f.harness.close(context); }
});
