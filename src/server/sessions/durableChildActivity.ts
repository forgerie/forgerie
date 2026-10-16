import type { Context, JsonValue } from "@earendil-works/chord";
import { AssistantEntry, UsageDoc, type ConversationId, type EntryId, type EntryRecord, type Harness, type Storage, type TaskRecord } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { Check } from "typebox/value";
import type { ChildActivity } from "../../shared/childAgents.js";
import { DurableUsageStateSchema } from "../../shared/durableUsage.js";
import { readChildDocument } from "./durableChildStorageReads.js";

const toolInput = Type.Object({ assistant: Type.Unsafe<EntryId>(Type.Integer({ minimum: 1 })), callId: Type.String() });
const timestamp = (value: number | undefined): number | null => value !== undefined && Number.isFinite(value) && value >= 0 ? value : null;
type ToolTaskRecord = TaskRecord<JsonValue, JsonValue, JsonValue>;

/** Read-only: one ledger and one newest tool task, never a transcript scan or run-history sum. */
export async function readChildActivity(harness: Harness, child: ConversationId, context: Context): Promise<ChildActivity> {
  const usage = await harness.snapshot(UsageDoc, child, context);
  const lastTool = await harness.commit(async tx => projectLastTool(
    (await tx.scanTasks({ conversationId: child, kind: "pi.tool", order: "descending" }, 1)).items[0],
    id => tx.entry(AssistantEntry, id),
  ), context);
  return { costUsd: projectCost(usage), lastTool };
}

export async function readStoredChildActivity(storage: Storage, child: ConversationId, context: Context): Promise<ChildActivity> {
  const usage = await readChildDocument(storage, "pi.usage", child, context);
  const lastTool = await projectLastTool((await storage.scanTasks({ conversationId: child, kind: "pi.tool", order: "descending" }, 1, undefined, context)).items[0],
    async id => (await storage.entry(child, id, context))?.entry);
  return { costUsd: projectCost(usage), lastTool };
}

function projectCost(usage: unknown): number | null {
  if (usage === undefined) return null;
  if (!Check(DurableUsageStateSchema, usage)) throw new Error("Invalid child pi.usage");
  return [...Object.values(usage.models), ...Object.values(usage.tools)].reduce((sum, bucket) => sum + bucket.cost.total, 0);
}

async function projectLastTool(task: ToolTaskRecord | undefined, entry: (id: EntryId) => Promise<EntryRecord | undefined>): Promise<ChildActivity["lastTool"]> {
  if (task === undefined) return null;
  if (!Check(toolInput, task.input)) throw new Error(`Invalid child tool task ${String(task.id)}`);
  const input = task.input;
  const assistant = await entry(input.assistant);
  const message = assistant?.kind === AssistantEntry.kind ? assistant.model?.[0] : undefined;
  if (message?.role !== "assistant") return null;
  const call = message.content.find(part => part.type === "toolCall" && part.id === input.callId);
  if (call?.type !== "toolCall") return null;
  // Existing transcript summaries copy commands/paths/questions. Row summaries deliberately do not.
  const name = /^[A-Za-z0-9_.:-]+$/u.test(call.name) ? call.name.slice(0, 80) : "tool";
  return { name: name || "tool", at: timestamp(message.timestamp) };
}
