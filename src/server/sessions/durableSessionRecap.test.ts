import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { Harness, MemoryStorage, createRegistry, UsageDoc, LiveDoc, GenerationTask } from "@earendil-works/pi-durable";
import { expect, it } from "vitest";
import { RECAP_ENTRY_KIND, type RecapData } from "../../shared/sessionRecap.js";
import { DurableParentReadModel } from "./durableParentReadModel.js";
import { commitSessionRecap, readRecapHistory, type RecapBranchEntry } from "./durableSessionRecap.js";
import { buildRecapPrompt } from "./sessionRecapGenerator.js";
import type { DurableSessionHandle } from "./durableSessionAddress.js";
import { responseFromBranch } from "./sessionResponse.js";

const data: RecapData = { summary: "Shipping a fix. It is implemented, not deployed.", trigger: "manual",
  model: "faux/faux-1", messageCount: 2, coversThroughEntryId: "2", runEndedAt: "2026-01-01T00:00:00.000Z", generatedAt: "2026-01-01T00:10:00.000Z" };
const message = (role: "user" | "assistant" | "bashExecution", content: string): RecapBranchEntry => ({ type: "message", message: { role, content: [{ type: "text", text: content }] } });
const recapCard: RecapBranchEntry = { type: "custom_message", customType: RECAP_ENTRY_KIND };
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
    const history = await readRecapHistory(f.handle, () => Promise.resolve([message("user", "Please fix it"), message("assistant", "Implemented, not deployed"), recapCard]));
    if (history === undefined) throw new Error("The leaf did not move");
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
it("reads only user and assistant messages from the projected branch, and counts new turns after the last recap", async () => {
  const f = await fixture();
  try {
    const branch: RecapBranchEntry[] = [
      message("user", "Imported request"), message("assistant", "Imported answer"),
      { type: "custom_message", customType: "note", message: { role: "user", content: "hidden extension note" } },
      message("bashExecution", "secret.txt"), message("assistant", "Listed the files"),
      { type: "branch_summary", message: { role: "user", content: "imported branch summary" } },
      { type: "compaction", message: { role: "user", content: "compacted history" } },
      recapCard,
      message("user", "Validate it"), message("assistant", "Tested"),
      { type: "custom_message", customType: "notice", message: { role: "user", content: "HIDDEN NATIVE NOTIFICATION" } },
      message("user", "Deploy it"), message("assistant", "Deployed"),
    ];
    const history = await readRecapHistory(f.handle, () => Promise.resolve(branch));
    if (history === undefined) throw new Error("The leaf did not move");
    const prompt = buildRecapPrompt(history.messages)?.prompt ?? "";
    for (const hidden of ["hidden extension note", "secret.txt", "imported branch summary", "compacted history", "HIDDEN NATIVE NOTIFICATION"]) expect(prompt).not.toContain(hidden);
    expect(prompt).toContain("Imported answer");
    expect(history).toMatchObject({ completedTurns: 3, newTurns: 2, hasExchange: true });
  } finally { await f.harness.close(context); }
});
it("returns nothing when a turn lands while the branch is read, so a stale prompt cannot claim the newer leaf", async () => {
  const f = await fixture();
  try {
    await f.user(); await f.answer();
    const history = await readRecapHistory(f.handle, async () => {
      const branch = [message("user", "Please fix it"), message("assistant", "Implemented, not deployed")];
      await f.user(); await f.answer();
      return branch;
    });
    expect(history).toBeUndefined();
  } finally { await f.harness.close(context); }
});
