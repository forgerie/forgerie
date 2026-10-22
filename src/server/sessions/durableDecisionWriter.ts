import { stat } from "node:fs/promises";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry } from "@earendil-works/pi-durable";
import type { Decision } from "../../shared/decisions.js";
import type { DurableSessionAddress } from "./durableSessionAddress.js";
import { DurableJournalPool } from "./durableJournalPool.js";
import { decisionExtension, logDecision } from "./durableDecisions.js";

export interface IssueDecisionRecord { repo: string; number: number; title: string; url: string; duplicates: string[] }
export function issueDecision(record: IssueDecisionRecord): Omit<Decision, "at" | "runId" | "state"> {
  return { id: `issue:${record.repo.toLowerCase()}:${String(record.number)}`, kind: "issue", by: "parent", question: record.title, choice: `#${String(record.number)} ${record.url}`, reason: `Searches run: ${record.duplicates.join("; ")}`, flagged: false };
}

/** Explicit inactive-journal writer. Its independent lease uses the existing kernel ownership lock. */
export class DurableDecisionWriter {
  constructor(private readonly locate: (sessionId: string) => Promise<DurableSessionAddress | undefined>) {}
  async logIssueDecision(sessionId: string, record: IssueDecisionRecord): Promise<void> {
    const address = await this.locate(sessionId);
    if (address?.sessionId !== sessionId) throw new Error("Issue decision journal is unavailable");
    await stat(address.databasePath); // Never create a missing database.
    const registry = createRegistry(); registry.install(decisionExtension());
    const pool = new DurableJournalPool();
    try {
      // No resume(), root(), prompt(), or live model. A simultaneous execution owner wins or loses the same lock.
      const handle = await pool.acquire(address, { models: createModels(), registry }, context);
      try { await handle.conversation.commit(tx => logDecision(tx, handle.conversation.id, issueDecision(record)), context); }
      finally { await handle.release(context); }
    } finally { await pool.close(context); }
  }
}
