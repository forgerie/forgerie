import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { AssistantEntry, Harness, MemoryStorage, ToolTask, UsageDoc, ResetEntry, createRegistry, type ConversationId } from "@earendil-works/pi-durable";
import { describe, expect, it } from "vitest";
import { readChildActivity, readStoredChildActivity } from "./durableChildActivity.js";

async function fixture() {
  const storage = new MemoryStorage();
  const harness = await Harness.open(storage, { models: createModels(), registry: createRegistry() }, context);
  const parent = await harness.root(context);
  const child = await harness.commit(tx => tx.createConversation({ ownership: { kind: "ownerless" } }), context);
  const tool = (conversationId: ConversationId, name: string, at: number) => harness.commit(async tx => {
    const message = fauxAssistantMessage([fauxToolCall(name, { command: "secret-token", content: "private file contents" })], { timestamp: at, stopReason: "toolUse" });
    const entry = await tx.appendEntry(AssistantEntry, conversationId, { model: [message] });
    const call = message.content.find(part => part.type === "toolCall");
    if (call?.type !== "toolCall") throw new Error("Missing fixture call");
    return tx.createTask(ToolTask, { assistant: entry.id, callId: call.id }, { conversationId, ownership: { kind: "conversation" } });
  }, context);
  return { storage, harness, parent, child, tool };
}
const usage = (total: number) => ({ input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3,
  cost: { input: total, output: 0, cacheRead: 0, cacheWrite: 0, total } });

describe("child row accounting and last tool", () => {
  it("keeps missing usage and tools unknown without initializing a ledger", async () => {
    const f = await fixture();
    try {
      await f.harness.commit(tx => tx.retireDoc(UsageDoc, f.child.id), context);
      expect(await readChildActivity(f.harness, f.child.id, context)).toEqual({ costUsd: null, lastTool: null });
      expect(await f.harness.snapshot(UsageDoc, f.child.id, context)).toBeUndefined();
      expect(await readStoredChildActivity(f.storage, f.child.id, context)).toEqual({ costUsd: null, lastTool: null });
      expect((await f.harness.inspect(context)).scheduling).toBe("paused");
    } finally { await f.harness.close(context); }
  });

  it("reads cumulative committed model and tool cost only for the selected conversation", async () => {
    const f = await fixture();
    try {
      await f.harness.commit(async tx => {
        Object.assign(await tx.doc(UsageDoc, f.parent.id), { models: { parent: usage(99) }, tools: {} });
        Object.assign(await tx.doc(UsageDoc, f.child.id), { models: { child: usage(0.3) }, tools: { work: usage(0.2) } });
      }, context);
      expect((await readChildActivity(f.harness, f.child.id, context)).costUsd).toBe(0.5);
      // A second run adds to the same ledger. No transcript/run-history reconstruction or double count.
      await f.harness.commit(async tx => { (await tx.doc(UsageDoc, f.child.id)).tools["work"] = usage(0.7); }, context);
      expect((await readChildActivity(f.harness, f.child.id, context)).costUsd).toBe(1);
      expect((await readStoredChildActivity(f.storage, f.child.id, context)).costUsd).toBe(1);
      await f.harness.commit(async tx => { Object.assign(await tx.doc(UsageDoc, f.child.id), { models: {}, tools: {} }); }, context);
      expect((await readChildActivity(f.harness, f.child.id, context)).costUsd).toBe(0);
    } finally { await f.harness.close(context); }
  });

  it("selects the newest tool task, survives later text, and never exposes arguments or results", async () => {
    const f = await fixture();
    try {
      await f.tool(f.child.id, "read", 10);
      await f.tool(f.child.id, "write", 20);
      await f.tool(f.parent.id, "bash", 30);
      await f.harness.commit(tx => tx.appendEntry(AssistantEntry, f.child.id, { model: [fauxAssistantMessage("private answer")] }), context);
      const activity = await readChildActivity(f.harness, f.child.id, context);
      expect(activity.lastTool).toEqual({ name: "write", at: 20 });
      await f.harness.commit(tx => tx.appendEntry(ResetEntry, f.child.id, { head: "self" }), context);
      expect(await readStoredChildActivity(f.storage, f.child.id, context)).toEqual(activity);
      expect(JSON.stringify(activity)).not.toMatch(/secret-token|private/);
      expect((await f.harness.inspect(context)).scheduling).toBe("paused");
    } finally { await f.harness.close(context); }
  });

  it("rejects invalid committed usage instead of fabricating a zero estimate", async () => {
    const f = await fixture();
    try {
      await f.harness.commit(async tx => { (await tx.doc(UsageDoc, f.child.id)).models["bad"] = usage(-1); }, context);
      await expect(readChildActivity(f.harness, f.child.id, context)).rejects.toThrow("Invalid child pi.usage");
      await expect(readStoredChildActivity(f.storage, f.child.id, context)).rejects.toThrow("Invalid child pi.usage");
    } finally { await f.harness.close(context); }
  });

  it("bounds and sanitizes untrusted tool names", async () => {
    const f = await fixture();
    try {
      await f.tool(f.child.id, "read\nsecret-token", 10);
      expect((await readChildActivity(f.harness, f.child.id, context)).lastTool?.name).toBe("tool");
      await f.tool(f.child.id, "x".repeat(1000), 20);
      expect((await readChildActivity(f.harness, f.child.id, context)).lastTool?.name.length).toBeLessThanOrEqual(80);
    } finally { await f.harness.close(context); }
  });
});
