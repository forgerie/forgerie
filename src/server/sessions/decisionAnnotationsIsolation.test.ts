import { createDurableParentState } from "./durableParentState.js";
import { initializeParentDocuments } from "./durableParentDocuments.js";
import { decisionAnnotations } from "../decisions/optionalDecisionAnnotations.js";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { Harness, MemoryStorage, createRegistry } from "@earendil-works/pi-durable";
import { expect, it, vi } from "vitest";
import { appendAttentionHint } from "./durableAttentionHints.js";

it.each([false, true])("a rejected optional attention write cannot poison the next required commit (tombstone=%s)", async tombstone => {
  const storage = new MemoryStorage();
  const harness = await Harness.open(storage, { models: createModels(), registry: createRegistry(), conversationCreated: initializeParentDocuments }, context);
  try {
    const conversation = await harness.root(context, { agent: {} });
    const handle = { harness, conversation, address: { journalId: "isolation", databasePath: "/memory/isolation", sessionId: "parent", conversationId: conversation.id }, release: () => Promise.resolve() };
    const requiredWrites = vi.spyOn(storage, "commit");
    vi.spyOn(decisionAnnotations(harness), "write").mockRejectedValueOnce(new Error("optional write rejected"));
    await expect(appendAttentionHint(handle, tombstone ? { version: 1, invalidated: true } : { version: 1 })).rejects.toThrow("optional write rejected");
    expect(requiredWrites).not.toHaveBeenCalled();
    const parent = createDurableParentState(handle, { resolve: () => Promise.reject(new Error("No history target needed")) });
    await parent.declareResponse("reply", context);
    expect(await parent.response(context)).toEqual({ kind: "needs-response", reason: "reply" });
    await expect(conversation.commit(tx => tx.appendEntry(conversation.id, { kind: "required-result", data: "committed" }), context)).resolves.toMatchObject({ kind: "required-result" });
  } finally { await harness.close(context); }
});
