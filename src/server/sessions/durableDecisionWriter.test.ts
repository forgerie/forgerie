import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry } from "@earendil-works/pi-durable";
import { expect, it } from "vitest";
import { DurableDecisionWriter } from "./durableDecisionWriter.js";
import { DurableJournalPool } from "./durableJournalPool.js";
import { decisions } from "./durableDecisions.js";

const record = { repo: "owner/repo", number: 7, title: "Fix recovery", url: "https://github.com/owner/repo/issues/7", duplicates: ["Fix recovery"] };
it.each(["archived chat", "removed worktree"])("logs a decision for an inactive %s without a runtime or a model", async kind => {
  const root = await mkdtemp(join(tmpdir(), "decision-writer-")); const pool = new DurableJournalPool();
  const options = { models: createModels(), registry: createRegistry() };
  try {
    const checkout = join(root, "checkout"); await mkdir(checkout);
    const handle = await pool.acquire({ databasePath: join(root, "saved/state.sqlite"), sessionId: "chat", create: {} }, options, context);
    const address = handle.address; await handle.release(context);
    if (kind === "removed worktree") await rm(checkout, { recursive: true });
    const writer = new DurableDecisionWriter(() => Promise.resolve(address));
    await writer.logIssueDecision("chat", record); await writer.logIssueDecision("chat", record);
    const reopened = await pool.acquire(address, options, context);
    try { expect(await decisions(reopened.harness, reopened.conversation.id, context)).toMatchObject([{ id: "issue:owner/repo:7", question: "Fix recovery", kind: "issue" }]); }
    finally { await reopened.release(context); }
  } finally { await pool.close(context); await rm(root, { recursive: true, force: true }); }
});
it("refuses an inactive write when an execution owner acquired the journal concurrently", async () => {
  const root = await mkdtemp(join(tmpdir(), "decision-writer-race-")); const pool = new DurableJournalPool();
  try {
    const handle = await pool.acquire({ databasePath: join(root, "state.sqlite"), sessionId: "chat", create: {} }, { models: createModels(), registry: createRegistry() }, context);
    const writer = new DurableDecisionWriter(() => Promise.resolve(handle.address));
    await expect(writer.logIssueDecision("chat", record)).rejects.toThrow("ownership lost or already held");
    expect(await decisions(handle.harness, handle.conversation.id, context)).toEqual([]);
    await handle.release(context);
    await writer.logIssueDecision("chat", record);
  } finally { await pool.close(context); await rm(root, { recursive: true, force: true }); }
});
