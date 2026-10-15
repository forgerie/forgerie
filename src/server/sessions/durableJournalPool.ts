import { randomUUID } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Harness, MemoryStorage, ROOT_CONVERSATION_ID, type AgentChange, type ConversationRecord, type HarnessOptions, type Tx, type Storage, type SubmissionRecord, type Cursor } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { acquireDurableOwnership, type DurableOwnership } from "./durableOwnership.js";
import type { DurableSessionAddress, DurableSessionHandle } from "./durableSessionAddress.js";
import { bindSession, boundConversationId, readSessionBindings, SessionBindings } from "./durableSessionBindings.js";

export type InitializeParentDocuments = (tx: Tx, conversation: ConversationRecord) => Promise<void>;
interface AcquireOptions {
  databasePath: string;
  sessionId: string;
  journalId?: string;
  conversationId?: DurableSessionAddress["conversationId"];
  /** Only explicit creation/import may create a missing journal or root. */
  create?: AgentChange;
  initializeParentDocuments?: InitializeParentDocuments;
  candidate?: boolean;
  existingOnly?: boolean;
}
interface Family { storage: Storage; harness: Harness; ownership: DurableOwnership | undefined; leases: number; readLeases: number }

/** Daemon-owned storage. A runtime lease never aborts or closes a sibling's work. */
export class DurableJournalPool {
  private readonly families = new Map<string, Family>();
  private line: Promise<unknown> = Promise.resolve();
  private stopped = false;

  acquire(request: AcquireOptions, options: HarnessOptions, context: Context): Promise<DurableSessionHandle> {
    return this.acquireWithOptions(request, options, context);
  }

  /** Borrow an execution owner's family. Never reopen it with read-time execution options. */
  acquireRead(address: DurableSessionAddress, context: Context): Promise<DurableSessionHandle> {
    return this.acquireWithOptions({ ...address, existingOnly: true }, undefined, context);
  }

  private acquireWithOptions(request: AcquireOptions, options: HarnessOptions | undefined, context: Context): Promise<DurableSessionHandle> {
    return this.serialize(async () => {
      if (this.stopped) throw new Error("Durable journal pool is closed");
      const pooledPath = this.families.has(request.databasePath) ? request.databasePath : undefined;
      if (request.existingOnly === true && pooledPath === undefined) throw new Error("Active Durable read owner closed; retry session routing");
      const directory = dirname(resolve(request.databasePath));
      if (request.create !== undefined) await mkdir(directory, { recursive: true, mode: 0o700 });
      const canonicalDirectory = pooledPath === undefined ? await realpath(directory) : directory;
      const path = pooledPath ?? await realpath(request.databasePath).catch((error: unknown) => {
        if (request.create === undefined || !isMissing(error)) throw error;
        return join(canonicalDirectory, basename(request.databasePath));
      });
      let family = this.families.get(path);
      const opened = family === undefined;
      if (family === undefined) {
        if (options === undefined) throw new Error("Durable execution options are required to open a family");
        const ownership = await acquireDurableOwnership(path);
        let storage: Storage | undefined;
        try {
          storage = await openNodeSqliteStorage(ownership.databasePath);
          family = { storage, harness: await Harness.open(storage, options, context), ownership, leases: 0, readLeases: 0 };
          this.families.set(path, family);
        } catch (error) { await storage?.close(BACKGROUND_CONTEXT); await ownership.release(); throw error; }
      }
      try {
        family.ownership?.assertOwned();
        if (request.existingOnly === true && family.leases === family.readLeases) throw new Error("Active Durable read owner closed; retry session routing");
        const bindings = await family.harness.snapshot(SessionBindings, context);
        if (bindings === undefined && request.create !== undefined) {
          const journalId = request.journalId ?? randomUUID();
          const existingRoot = await family.harness.conversation(ROOT_CONVERSATION_ID, context);
          if (existingRoot === undefined) {
            await family.harness.root(context, { agent: request.create, init: async (tx, id) => {
              await bindSession(tx, journalId, request.sessionId, id);
              await request.initializeParentDocuments?.(tx, { id });
              await tx.appendEntry(id, { kind: "forgerie.origin" });
            } });
          } else {
            await existingRoot.commit(async (tx) => {
              const first = (await tx.scanEntries({ conversationId: existingRoot.id, order: "ascending" }, 1)).items[0];
              await bindSession(tx, journalId, request.sessionId, existingRoot.id);
              await request.initializeParentDocuments?.(tx, { id: existingRoot.id });
              if (first === undefined) await tx.appendEntry(existingRoot.id, { kind: "forgerie.origin" });
            }, context);
          }
        }
        const state = await readSessionBindings(family.harness, context);
        if (request.journalId !== undefined && request.journalId !== state.journalId) throw new Error("Foreign Durable journal identity");
        const binding = state.sessions[request.sessionId];
        if (binding === undefined) throw new Error("Unknown logical Durable session");
        const id = boundConversationId(request.candidate === true ? request.conversationId ?? binding.conversationId : binding.conversationId);
        if (!binding.retained.includes(id)) throw new Error("Conversation does not belong to the logical session");
        const conversation = await family.harness.conversation(id, context);
        if (conversation === undefined) throw new Error("Missing bound Durable conversation");
        family.leases++;
        if (request.existingOnly === true) family.readLeases++;
        const address: DurableSessionAddress = { databasePath: family.ownership?.databasePath ?? path, journalId: state.journalId, sessionId: request.sessionId, conversationId: id };
        let released = false;
        return { address, harness: family.harness, conversation, release: (cleanupContext) => this.serialize(async () => {
          if (released) return;
          released = true;
          const current = this.families.get(path);
          if (current === undefined) return;
          if (request.existingOnly === true) current.readLeases--;
          if (--current.leases === 0) await this.closeFamily(path, current, cleanupContext);
        }) };
      } catch (error) {
        if (opened && family.leases === 0) await this.closeFamily(path, family, BACKGROUND_CONTEXT);
        throw error;
      }
    });
  }

  /** Ephemeral SDK sessions use the same lease semantics without a filesystem locator. */
  async openMemory(sessionId: string, options: HarnessOptions, agent: AgentChange, context: Context, initializeParentDocuments?: InitializeParentDocuments): Promise<DurableSessionHandle> {
    const journalId = randomUUID();
    const databasePath = `/memory/${journalId}`;
    const storage = new MemoryStorage();
    const harness = await Harness.open(storage, options, context);
    try {
      await harness.root(context, { agent, init: async (tx, id) => {
        await bindSession(tx, journalId, sessionId, id);
        await initializeParentDocuments?.(tx, { id });
        await tx.appendEntry(id, { kind: "forgerie.origin" });
      } });
      await this.serialize(() => {
        if (this.stopped) throw new Error("Durable journal pool is closed");
        this.families.set(databasePath, { storage, harness, ownership: undefined, leases: 0, readLeases: 0 });
        return Promise.resolve();
      });
      return await this.acquire({ databasePath, sessionId, journalId }, options, context);
    } catch (error) { await harness.close(BACKGROUND_CONTEXT); throw error; }
  }

  /** Candidates are retained but not selected until the host validates them. */
  acquireCandidate(address: DurableSessionAddress, options: HarnessOptions, context: Context): Promise<DurableSessionHandle> {
    return this.acquire({ ...address, candidate: true }, options, context);
  }

  assertOwned(address: DurableSessionAddress): void {
    const family = this.families.get(address.databasePath);
    if (family === undefined) throw new Error("Durable journal is not leased from this pool");
    family.ownership?.assertOwned();
  }

  /** Definition-free receipt reads under the existing lease, without a second storage owner. */
  submissions(address: DurableSessionAddress, context: Context): Promise<SubmissionRecord[]> {
    const family = this.families.get(address.databasePath);
    if (family === undefined) return Promise.reject(new Error("Durable journal is not leased from this pool"));
    this.assertOwned(address);
    return family.harness.commit(async () => {
      const records: SubmissionRecord[] = [];
      let cursor: Cursor | undefined;
      do {
        const page = await family.storage.scanSubmissions({ conversationId: address.conversationId }, 256, cursor, context);
        records.push(...page.items);
        cursor = page.next;
      } while (cursor !== undefined);
      return records;
    }, context);
  }

  /** Recovery borrows the existing owner. Last-lease close waits for this read. */
  inspectStorage<T>(databasePath: string, inspect: (storage: Storage) => Promise<T>, context: Context): Promise<{ found: true; value: T } | { found: false }> {
    return this.serialize(async () => {
      const family = this.families.get(databasePath);
      if (family === undefined) return { found: false };
      family.ownership?.assertOwned();
      return { found: true, value: await family.harness.commit(() => inspect(family.storage), context) };
    });
  }

  /** Shutdown closes execution, never records an explicit Stop. */
  close(context: Context): Promise<void> {
    return this.serialize(async () => {
      this.stopped = true;
      for (const [path, family] of this.families) await this.closeFamily(path, family, context);
    });
  }
  private async closeFamily(path: string, family: Family, context: Context): Promise<void> {
    try { await family.harness.close(context); }
    finally { this.families.delete(path); await family.ownership?.release(); }
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.line.then(operation);
    this.line = result.catch(() => undefined);
    return result;
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
