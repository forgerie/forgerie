import { stat } from "node:fs/promises";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { type Storage, type ConversationRecord, type Cursor } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { Check } from "typebox/value";
import { acquireDurableOwnership } from "./durableOwnership.js";
import { DurableSessionJournal, durableSessionPaths } from "./durableSessionJournal.js";
import { WORKFLOW_DOC_KIND, WorkflowActiveSchema } from "./durableWorkflowRuns.js";
import type { DurableJournalPool } from "./durableJournalPool.js";
import { SessionBindingsSchema } from "./durableSessionBindings.js";
import { parseDurableSessionAddress, type DurableSessionAddress } from "./durableSessionAddress.js";

interface SessionRef { id: string; cwd: string }
interface RecoverySession extends SessionRef { path: string; address?: DurableSessionAddress }
export interface DurableRecoveryReport { resumed: string[]; failed: { id: string; error: string }[] }
export interface DurableRecoveryOptions {
  catalog(): Promise<readonly RecoverySession[]>;
  pool?: DurableJournalPool;
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
  const inspections = new Map<string, Promise<FamilyRecovery>>();
  const candidates = new Map<string, SessionRef & { path?: string; address?: DurableSessionAddress }>(catalog.map((session) => [key(session), session]));
  for (const ref of options.repair ?? []) if (!candidates.has(key(ref))) candidates.set(key(ref), ref);
  const queue = [...candidates.values()];
  let next = 0;
  const worker = async () => {
    while (!options.stopped()) {
      const ref = queue[next++];
      if (ref === undefined) return;
      try {
        if (!await options.available(ref) || options.stopped()) continue;
        let needed = repair.has(key(ref));
        if (!needed && ref.path !== undefined) {
          if (options.needsRecovery !== undefined) needed = await options.needsRecovery(ref.path);
          else {
            const path = ref.address?.databasePath ?? durableSessionPaths(ref.path).database;
            let inspection = inspections.get(path);
            if (inspection === undefined) { inspection = inspectFamily(ref.address ?? ref.path, options.pool); inspections.set(path, inspection); }
            const state = await inspection;
            needed = state.legacy ? state.any : state.sessions.has(ref.id);
          }
        }
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
export async function durableSessionNeedsRecovery(session: string | DurableSessionAddress, pool?: DurableJournalPool): Promise<boolean> {
  const result = await inspectFamily(session, pool);
  return typeof session === "string" ? result.any : result.sessions.has(session.sessionId);
}
interface FamilyRecovery { legacy: boolean; any: boolean; sessions: Set<string> }
async function inspectFamily(session: string | DurableSessionAddress, pool = DurableSessionJournal.pool): Promise<FamilyRecovery> {
  const address = typeof session === "string" ? undefined : parseDurableSessionAddress(session);
  const database = address?.databasePath ?? durableSessionPaths(typeof session === "string" ? session : "").database;
  const result: FamilyRecovery = { legacy: true, any: false, sessions: new Set() };
  if (!await exists(database)) return result;
  const borrowed = await pool.inspectStorage(database, (storage) => inspectStorage(storage, address), context);
  if (borrowed.found) return borrowed.value;
  const ownership = await acquireDurableOwnership(database);
  let storage: Storage | undefined;
  try {
    if (!await exists(ownership.databasePath)) return result;
    storage = await openNodeSqliteStorage(ownership.databasePath);
    return await inspectStorage(storage, address);
  } finally {
    try { await storage?.close(context); }
    finally { await ownership.release(); }
  }
}

async function inspectStorage(storage: Storage, address: DurableSessionAddress | undefined): Promise<FamilyRecovery> {
  const result: FamilyRecovery = { legacy: true, any: false, sessions: new Set() };
    const bindingRecord = await storage.findDocument({ kind: "forgerie.session-bindings", scope: { kind: "session" } }, "current", context);
    const bindingDocument = bindingRecord === undefined ? undefined : await storage.document(bindingRecord.id, "current", context);
    const bindings = bindingDocument?.value;
    if (bindings !== undefined && !Check(SessionBindingsSchema, bindings)) throw new Error("Invalid Durable recovery bindings");
    if (address !== undefined && (!Check(SessionBindingsSchema, bindings) || bindings.journalId !== address.journalId || bindings.sessions[address.sessionId] === undefined)) throw new Error("Recovery locator has no matching binding");
    const owners = new Map<number, Set<string>>();
    if (Check(SessionBindingsSchema, bindings)) {
      result.legacy = false;
      for (const [id, binding] of Object.entries(bindings.sessions)) {
        for (const conversationId of new Set([binding.conversationId, ...binding.retained])) {
          const refs = owners.get(conversationId) ?? new Set<string>();
          refs.add(id);
          owners.set(conversationId, refs);
        }
      }
    }
    const conversations = new Map<number, ConversationRecord>();
    let cursor: Cursor | undefined;
    do { const page = await storage.scanConversations({}, 256, cursor, context); for (const record of page.items) conversations.set(record.id, record); cursor = page.next; } while (cursor !== undefined);
    const mark = (conversationId: number) => {
      result.any = true;
      const visited = new Set<number>();
      let current: number | undefined = conversationId;
      while (current !== undefined) {
        if (visited.has(current)) throw new Error("Cyclic Durable recovery ownership");
        visited.add(current);
        for (const id of owners.get(current) ?? []) result.sessions.add(id);
        current = conversations.get(current)?.owner?.conversationId;
      }
    };
    for (const status of ["pending", "running", "waiting", "completing"] as const) {
      cursor = undefined;
      do { const page = await storage.scanTasks({ status }, 256, cursor, context); for (const task of page.items) mark(task.conversationId); cursor = page.next; } while (cursor !== undefined);
    }
    for (const status of ["queued", "placed"] as const) {
      cursor = undefined;
      do { const page = await storage.scanSubmissions({ status }, 256, cursor, context); for (const submission of page.items) mark(submission.conversationId); cursor = page.next; } while (cursor !== undefined);
    }
    // Workflows can wait at a user stop with no task. Inspect selected AND retained owners,
    // not the reserved root. Child/task ownership is never moved to a fork.
    for (const conversation of conversations.values()) {
      const record = await storage.findDocument({ kind: WORKFLOW_DOC_KIND, scope: { kind: "conversation", conversationId: conversation.id } }, "current", context);
      if (record === undefined) continue;
      const document = await storage.document(record.id, "current", context);
      if (!Check(WorkflowActiveSchema, document?.value)) throw new Error("Invalid Durable workflow recovery state");
      if (document.value.active !== null) mark(conversation.id);
    }
    return result;
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; }
  catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}
