import { constants } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Models, Message } from "@earendil-works/pi-ai";
import { convertToLlm, type SessionManager } from "@earendil-works/pi-coding-agent";
import { Harness, defineDoc, type AgentChange, type Conversation, type Cursor, type EntryRecord, type Harness as DurableHarness, type HarnessOptions, type HarnessSettings, type Registry, type Storage } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { MemoryStorage } from "@earendil-works/pi-durable/storage/memory";
import { acquireDurableOwnership, type DurableOwnership } from "./durableOwnership.js";
import { durableJson } from "./durableJson.js";
import { childEntryText, isChildEntryKind } from "./durableChildAgents.js";

const Imported = defineDoc({ kind: "forgerie.import", version: 1, scope: "session", initial: (): { complete: boolean } => ({ complete: false }) });
const DURABLE_ENTRY_PROPERTY = "forgerieDurableEntryId";
const DURABLE_SESSION_PROPERTY = "forgerieDurableSessionId";

/**
 * Whether the session transcript shows this entry's messages. Forgerie's own
 * entries are model copies of something the transcript already holds in its
 * own form, such as a custom message or a shell run, or imports of old
 * history. Child entries are the exception: the transcript shows them.
 */
export function isTranscriptEntry(kind: string): boolean {
  if (isChildEntryKind(kind)) return true;
  return !kind.startsWith("forgerie.") && kind !== "pi.system" && kind !== "pi.compaction" && kind !== "pi.reset";
}

export function durableSessionPaths(sessionFile: string): { directory: string; database: string; original: string } {
  const directory = join(dirname(sessionFile), ".durable", sessionFile.split(/[\\/]/).at(-1) ?? "session");
  return { directory, database: join(directory, "state.sqlite"), original: join(directory, "original.jsonl") };
}

export interface DurableJournalOptions {
  manager: SessionManager;
  models: Models;
  registry: Registry;
  agent: AgentChange;
  settings?: HarnessSettings;
  env?: HarnessOptions["env"];
  onReport?: (error: unknown) => void;
}

/** Owns checkpoints. SDK JSONL remains a recoverable presentation projection and legacy-data store. */
export class DurableSessionJournal {
  readonly harness: DurableHarness;
  readonly conversation: Conversation;
  private readonly projected = new Set<number>();
  private projection: Promise<void> = Promise.resolve();
  private closing: Promise<void> | undefined;
  private projectionFileReady = false;
  private readonly ownerSessionId: string;
  private scanned: EntryRecord["id"] | undefined;

  private constructor(
    harness: DurableHarness,
    conversation: Conversation,
    private readonly manager: SessionManager,
    private readonly ownership: DurableOwnership | undefined,
  ) {
    this.harness = harness;
    this.conversation = conversation;
    this.ownerSessionId = manager.getSessionId();
    for (const entry of manager.getEntries()) {
      // Projected child entries carry their stamp in details.
      if (entry.type === "custom_message" && typeof entry.details === "object" && entry.details !== null && DURABLE_ENTRY_PROPERTY in entry.details
        && typeof entry.details[DURABLE_ENTRY_PROPERTY] === "number" && DURABLE_SESSION_PROPERTY in entry.details && entry.details[DURABLE_SESSION_PROPERTY] === this.ownerSessionId) {
        this.projected.add(entry.details[DURABLE_ENTRY_PROPERTY]);
      }
      if (entry.type !== "message") continue;
      const message = entry.message;
      if (DURABLE_ENTRY_PROPERTY in message && typeof message[DURABLE_ENTRY_PROPERTY] === "number"
        && DURABLE_SESSION_PROPERTY in message && message[DURABLE_SESSION_PROPERTY] === this.ownerSessionId) {
        this.projected.add(message[DURABLE_ENTRY_PROPERTY]);
      }
    }
  }

  static async open(options: DurableJournalOptions): Promise<DurableSessionJournal> {
    const sessionFile = options.manager.getSessionFile();
    let ownership: DurableOwnership | undefined;
    let storage: Storage;
    if (sessionFile === undefined) {
      storage = new MemoryStorage();
    } else {
      const paths = durableSessionPaths(sessionFile);
      await mkdir(paths.directory, { recursive: true, mode: 0o700 });
      ownership = await acquireDurableOwnership(paths.database);
      try {
        storage = await openNodeSqliteStorage(ownership.databasePath);
      } catch (error) { await ownership.release(); throw error; }
    }
    let harness: DurableHarness | undefined;
    try {
      harness = await Harness.open(storage, {
        models: options.models,
        registry: options.registry,
        ...(options.settings === undefined ? {} : { settings: options.settings }),
        ...(options.onReport === undefined ? {} : { onReport: options.onReport }),
        ...(options.env === undefined ? {} : { env: options.env }),
      }, BACKGROUND_CONTEXT);
      const conversation = await harness.root(BACKGROUND_CONTEXT, { agent: options.agent });
      await conversation.commit(async (tx) => {
        const imported = await tx.doc(Imported);
        if (imported.complete) return;
        if (sessionFile !== undefined) {
          // Copy only before first import. A new Durable session has no legacy file to back up.
          await copyFile(sessionFile, durableSessionPaths(sessionFile).original, constants.COPYFILE_EXCL).catch((error: unknown) => {
            if (!isFsError(error, "ENOENT") && !isFsError(error, "EEXIST")) throw error;
          });
        }
        await tx.appendEntry(conversation.id, {
          kind: "forgerie.legacy-context",
          data: durableJson({ leafId: options.manager.getLeafId(), entries: options.manager.getEntries() }),
        });
        // One contribution per entry keeps native compaction cut points useful for long legacy sessions.
        for (const projected of options.manager.buildSessionProjection().entries) {
          const model = convertToLlm(projected.messages);
          if (model.length === 0) continue;
          await tx.appendEntry(conversation.id, { kind: "forgerie.legacy-message", model, data: { sdkEntryId: projected.sourceEntry.id } });
        }
        imported.complete = true;
      }, BACKGROUND_CONTEXT);
      const journal = new DurableSessionJournal(harness, conversation, options.manager, ownership);
      await journal.project();
      return journal;
    } catch (error) {
      if (harness !== undefined) await harness.close(BACKGROUND_CONTEXT);
      else await storage.close(BACKGROUND_CONTEXT);
      await ownership?.release();
      throw error;
    }
  }

  assertOwned(): void { this.ownership?.assertOwned(); }

  /** Called before tools and after committed events, so extension hooks see committed assistant calls. */
  project(): Promise<void> {
    this.projection = this.projection.then(async () => {
      this.assertOwned();
      let cursor: Cursor | undefined;
      const query = { order: "ascending" as const, ...(this.scanned === undefined ? {} : { minEntryId: this.scanned }) };
      do {
        const page = await this.conversation.entries(query, 256, cursor, BACKGROUND_CONTEXT);
        for (const entry of page.items) {
          this.projectEntry(entry);
          this.scanned = entry.id;
        }
        cursor = page.next;
      } while (cursor !== undefined);
      await this.ensureCatalogProjection();
    });
    return this.projection;
  }

  private projectEntry(entry: EntryRecord): void {
    if (!this.projected.has(entry.id) && isChildEntryKind(entry.kind)) {
      const data = typeof entry.data === "object" && entry.data !== null && !Array.isArray(entry.data) ? entry.data : {};
      this.manager.appendCustomMessageEntry(entry.kind, childEntryText(entry.kind, entry.data), true,
        { ...data, [DURABLE_SESSION_PROPERTY]: this.ownerSessionId, [DURABLE_ENTRY_PROPERTY]: entry.id });
      this.projected.add(entry.id);
      return;
    }
    if (this.projected.has(entry.id) || !isTranscriptEntry(entry.kind)) return;
    for (const message of entry.model ?? []) {
      if (message.role === "system") continue;
      // The stamp and message are one JSONL record. Reopen can recover an interrupted projection without duplicates.
      const projected: Message & { forgerieDurableSessionId: string; forgerieDurableEntryId: number } = {
        ...message, forgerieDurableSessionId: this.ownerSessionId, forgerieDurableEntryId: entry.id,
      };
      this.manager.appendMessage(projected);
    }
    this.projected.add(entry.id);
  }

  private async ensureCatalogProjection(): Promise<void> {
    const file = this.manager.getSessionFile();
    const header = this.manager.getHeader();
    if (this.projectionFileReady || file === undefined || header === null) return;
    const entries = this.manager.getEntries();
    if (!entries.some((entry) => entry.type === "message")) return;
    // SDK persistence normally waits for an assistant. Save the first input now so a crash cannot hide its database from discovery.
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, [header, ...entries].map((entry) => JSON.stringify(entry)).join("\n") + "\n", { flag: "wx", mode: 0o600 }).catch((error: unknown) => {
      if (!isFsError(error, "EEXIST")) throw error;
    });
    this.projectionFileReady = true;
  }

  async appendMessage(message: Message): Promise<void> {
    this.assertOwned();
    await this.conversation.submit({ type: "write", entry: { kind: "forgerie.message", model: [message] } }, BACKGROUND_CONTEXT);
  }

  /** Import the selected SDK branch after tree navigation, without rerunning historical tools. */
  async selectBranch(): Promise<void> {
    this.assertOwned();
    await this.conversation.waitForIdle(BACKGROUND_CONTEXT);
    await this.conversation.commit(async (tx) => {
      await tx.appendEntry(this.conversation.id, {
        kind: "forgerie.branch-context", head: "self",
        data: durableJson({ leafId: this.manager.getLeafId() }),
      });
      for (const projected of this.manager.buildSessionProjection().entries) {
        const model = convertToLlm(projected.messages);
        if (model.length === 0) continue;
        await tx.appendEntry(this.conversation.id, { kind: "forgerie.legacy-message", model, data: { sdkEntryId: projected.sourceEntry.id } });
      }
    }, BACKGROUND_CONTEXT);
  }

  /** Close interrupts invocations without recording cancellation. Explicit Stop calls conversation.abort instead. */
  close(): Promise<void> {
    this.closing ??= (async () => {
      try { await this.harness.close(BACKGROUND_CONTEXT); }
      finally { await this.ownership?.release(); }
    })();
    return this.closing;
  }
}

function isFsError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
