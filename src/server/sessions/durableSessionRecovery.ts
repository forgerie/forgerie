import { stat } from "node:fs/promises";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { ROOT_CONVERSATION_ID, type Storage } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { Check } from "typebox/value";
import { acquireDurableOwnership } from "./durableOwnership.js";
import { durableSessionPaths } from "./durableSessionJournal.js";
import { WORKFLOW_DOC_KIND, WorkflowActiveSchema } from "./durableWorkflowRuns.js";

interface SessionRef { id: string; cwd: string }
interface RecoverySession extends SessionRef { path: string }
export interface DurableRecoveryReport { resumed: string[]; failed: { id: string; error: string }[] }
export interface DurableRecoveryOptions {
  catalog(): Promise<readonly RecoverySession[]>;
  /** Unfinished external accounting records need repair even if their Durable work has settled. */
  repair?: readonly SessionRef[];
  available(ref: SessionRef): Promise<boolean>;
  reopen(ref: SessionRef): Promise<void>;
  stopped(): boolean;
  needsRecovery?: (sessionFile: string) => Promise<boolean>;
}

/** Recover from checkpoints, not a best-effort live index or browser attachment. Bound resource-heavy runtime opens. */
export async function recoverDurableSessions(options: DurableRecoveryOptions): Promise<DurableRecoveryReport> {
  const report: DurableRecoveryReport = { resumed: [], failed: [] };
  if (options.stopped()) return report;
  const catalog = await options.catalog();
  const key = (ref: SessionRef) => JSON.stringify([ref.cwd, ref.id]);
  const repair = new Set((options.repair ?? []).map(key));
  const candidates = new Map<string, SessionRef & { path?: string }>(catalog.map((session) => [key(session), session]));
  for (const ref of options.repair ?? []) if (!candidates.has(key(ref))) candidates.set(key(ref), ref);
  const queue = [...candidates.values()];
  let next = 0;
  const worker = async () => {
    while (!options.stopped()) {
      const ref = queue[next++];
      if (ref === undefined) return;
      try {
        if (!await options.available(ref) || options.stopped()) continue;
        const needed = repair.has(key(ref)) || (ref.path !== undefined && await (options.needsRecovery ?? durableSessionNeedsRecovery)(ref.path));
        if (!needed || options.stopped()) continue;
        await options.reopen(ref);
        if (!options.stopped()) report.resumed.push(ref.id);
      } catch (error) {
        if (!options.stopped()) report.failed.push({ id: ref.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  return report;
}

/** Inspect through Durable's public storage contract under the same ownership lock as execution. Never schedule work. */
export async function durableSessionNeedsRecovery(sessionFile: string): Promise<boolean> {
  const { database } = durableSessionPaths(sessionFile);
  if (!await exists(database)) return false;
  const ownership = await acquireDurableOwnership(database);
  let storage: Storage | undefined;
  try {
    // Deletion can race discovery. Do not turn a removed journal into a new empty database.
    if (!await exists(ownership.databasePath)) return false;
    storage = await openNodeSqliteStorage(ownership.databasePath);
    for (const status of ["pending", "running", "waiting", "completing"] as const) {
      if ((await storage.scanTasks({ status }, 1, undefined, context)).items.length > 0) return true;
    }
    for (const status of ["queued", "placed"] as const) {
      if ((await storage.scanSubmissions({ status }, 1, undefined, context)).items.length > 0) return true;
    }
    // A workflow can be between turns or waiting at a user stop with no live task.
    const record = await storage.findDocument({ kind: WORKFLOW_DOC_KIND, scope: { kind: "conversation", conversationId: ROOT_CONVERSATION_ID } }, "current", context);
    if (record === undefined) return false;
    const document = await storage.document(record.id, "current", context);
    if (!Check(WorkflowActiveSchema, document?.value)) throw new Error("Invalid Durable workflow recovery state");
    return document.value.active !== null;
  } finally {
    try { await storage?.close(context); }
    finally { await ownership.release(); }
  }
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; }
  catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}
