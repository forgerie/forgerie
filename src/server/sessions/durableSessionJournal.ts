import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Models, Message } from "@earendil-works/pi-ai";
import { type SessionManager } from "@earendil-works/pi-coding-agent";
import { UsageDoc, type UsageState, type AgentChange, type Conversation, type Cursor, type EntryId, type EntryRecord, type HarnessOptions, type HarnessSettings, type Registry, type SubmissionRecord, type UserInput } from "@earendil-works/pi-durable";
import { Check } from "typebox/value";
import { DurableUsageStateSchema } from "../../shared/durableUsage.js";
import { hostEntryText, isHostEntryKind } from "./durableHostEntries.js";
import { DurableJournalPool, type InitializeParentDocuments } from "./durableJournalPool.js";
import type { DurableSessionHandle } from "./durableSessionAddress.js";
import { createDurableNativeHistory, NativeEntryAliases } from "./durableNativeHistory.js";
import { importDurableLegacyTree, LegacyTree, LegacyMigration } from "./durableLegacyImport.js";
import { bindSession, boundConversationId } from "./durableSessionBindings.js";

const DURABLE_ENTRY_PROPERTY = "forgerieDurableEntryId";
const DURABLE_SESSION_PROPERTY = "forgerieDurableSessionId";
const DURABLE_JOURNAL_PROPERTY = "forgerieDurableJournalId";
const DURABLE_CONVERSATION_PROPERTY = "forgerieDurableConversationId";
const DURABLE_MESSAGE_PROPERTY = "forgerieDurableMessageIndex";
const CUSTOM_INPUT_REQUEST_PREFIX = "forgerie.custom-message:";

/**
 * Whether the session transcript shows this entry's messages. Forgerie's own
 * entries are model copies of something the transcript already holds in its
 * own form, such as a custom message or a shell run, or imports of old
 * history. Host entries (child questions, steers, workflow stops) are the exception: the transcript shows them.
 */
export function isTranscriptEntry(kind: string): boolean {
  if (isHostEntryKind(kind)) return true;
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
  handle?: DurableSessionHandle;
  pool?: DurableJournalPool;
  initializeParentDocuments?: InitializeParentDocuments;
  /** Composition supplies one conversation-aware router for the whole family. */
  familyOptions?: HarnessOptions;
}

/** Owns checkpoints. SDK JSONL remains a recoverable presentation projection and legacy-data store. */
export class DurableSessionJournal {
  static readonly pool = new DurableJournalPool();
  get harness() { return this.handle.harness; }
  get conversation(): Conversation { return this.handle.conversation; }
  get handle(): DurableSessionHandle { return this.handleValue; }
  get nativeHistory() {
    return createDurableNativeHistory(this.handle, {
      acquire: (address, context) => this.pool.acquireCandidate(address, this.harnessOptions, context),
      ...(this.initializeParentDocuments === undefined ? {} : { initializeParentDocuments: this.initializeParentDocuments }),
    });
  }
  private readonly projected = new Map<string, string>();
  private projection: Promise<void> = Promise.resolve();
  private closing: Promise<void> | undefined;
  private projectionFileReady = false;
  private readonly ownerSessionId: string;
  private scanned: EntryRecord["id"] | undefined;
  private readonly customInputEntries = new Set<EntryRecord["id"]>();
  private readonly unsubscribe: () => void;
  private usageValue: UsageState = { models: {}, tools: {} };

  /** Synchronous readers see only the latest committed parent ledger, never child spend. */
  get usage(): Readonly<UsageState> { return this.usageValue; }

  private constructor(
    private handleValue: DurableSessionHandle,
    private readonly manager: SessionManager,
    private readonly pool: DurableJournalPool,
    private readonly harnessOptions: HarnessOptions,
    private readonly initializeParentDocuments: InitializeParentDocuments | undefined,
    private readonly onReport: DurableJournalOptions["onReport"],
  ) {
    this.ownerSessionId = manager.getSessionId();
    this.unsubscribe = this.harness.subscribeCommits((publication) => {
      for (const change of publication.changes) {
        if (change.type === "submission") this.noteCustomInput(change.value);
        if (change.type === "document" && change.conversationId === this.conversation.id && change.record.kind === "pi.usage") {
          this.adoptUsage(change.value);
        }
      }
    });
    for (const entry of manager.getEntries()) {
      const stamp = entry.type === "message" ? entry.message : entry.type === "custom_message" ? entry.details : undefined;
      if (typeof stamp !== "object" || stamp === null || !(DURABLE_JOURNAL_PROPERTY in stamp) || stamp[DURABLE_JOURNAL_PROPERTY] !== this.handle.address.journalId
        || !(DURABLE_ENTRY_PROPERTY in stamp) || typeof stamp[DURABLE_ENTRY_PROPERTY] !== "number"
        || !(DURABLE_CONVERSATION_PROPERTY in stamp) || typeof stamp[DURABLE_CONVERSATION_PROPERTY] !== "number"
        || !(DURABLE_MESSAGE_PROPERTY in stamp) || typeof stamp[DURABLE_MESSAGE_PROPERTY] !== "number") continue;
      this.projected.set(`${String(stamp[DURABLE_CONVERSATION_PROPERTY])}:${String(stamp[DURABLE_ENTRY_PROPERTY])}:${String(stamp[DURABLE_MESSAGE_PROPERTY])}`, entry.id);
    }
  }

  static async open(options: DurableJournalOptions): Promise<DurableSessionJournal> {
    const sessionFile = options.manager.getSessionFile();
    const pool = options.pool ?? DurableSessionJournal.pool;
    const harnessOptions: HarnessOptions = options.familyOptions ?? {
      models: options.models, registry: options.registry,
      ...(options.settings === undefined ? {} : { settings: options.settings }),
      ...(options.onReport === undefined ? {} : { onReport: options.onReport }),
      ...(options.env === undefined ? {} : { env: options.env }),
    };
    let handle = options.handle;
    try {
      if (handle === undefined) {
        handle = sessionFile === undefined
          ? await pool.openMemory(options.manager.getSessionId(), harnessOptions, options.agent, BACKGROUND_CONTEXT, options.initializeParentDocuments)
          : await pool.acquire({ databasePath: durableSessionPaths(sessionFile).database, sessionId: options.manager.getSessionId(), create: options.agent,
            ...(options.initializeParentDocuments === undefined ? {} : { initializeParentDocuments: options.initializeParentDocuments }) }, harnessOptions, BACKGROUND_CONTEXT);
        if (sessionFile !== undefined) {
          await copyFile(sessionFile, durableSessionPaths(sessionFile).original, constants.COPYFILE_EXCL).catch((error: unknown) => {
            if (!isFsError(error, "ENOENT") && !isFsError(error, "EEXIST")) throw error;
          });
        }
        if ((await handle.harness.snapshot(LegacyMigration, BACKGROUND_CONTEXT))?.complete !== true) await importDurableLegacyTree(handle, options.manager, BACKGROUND_CONTEXT, options.initializeParentDocuments);
        // Import may select a historical continuation. Never reopen the reserved root instead.
        const selected = await pool.acquire({ databasePath: handle.address.databasePath, sessionId: handle.address.sessionId }, harnessOptions, BACKGROUND_CONTEXT);
        await handle.release(BACKGROUND_CONTEXT);
        handle = selected;
      }
      const journal = new DurableSessionJournal(handle, options.manager, pool, harnessOptions, options.initializeParentDocuments, options.onReport);
      journal.adoptUsage(await handle.harness.snapshot(UsageDoc, handle.conversation.id, BACKGROUND_CONTEXT) ?? { models: {}, tools: {} });
      for (const submission of await pool.submissions(handle.address, BACKGROUND_CONTEXT)) journal.noteCustomInput(submission);
      await journal.project();
      return journal;
    } catch (error) { await handle?.release(BACKGROUND_CONTEXT); throw error; }
  }

  private adoptUsage(value: unknown): void {
    if (Check(DurableUsageStateSchema, value)) { this.usageValue = value; return; }
    const error = new Error(`Invalid parent pi.usage document for conversation ${String(this.conversation.id)}; keeping last good usage`);
    // A post-adoption listener cannot reject a commit that is already durable or stop later observers.
    try {
      if (this.onReport === undefined) process.emitWarning(error);
      else this.onReport(error);
    } catch (cause) {
      process.emitWarning(new Error(`${error.message}; usage reporter failed`, { cause }));
    }
  }

  assertOwned(): void {
    if (this.closing !== undefined) throw new Error("Durable journal is closed");
    this.pool.assertOwned(this.handle.address);
  }

  private isClosing(): boolean { return this.closing !== undefined; }

  private noteCustomInput(submission: SubmissionRecord): void {
    if (submission.conversationId === this.conversation.id && submission.type === "input"
      && submission.requestId?.startsWith(CUSTOM_INPUT_REQUEST_PREFIX) === true && submission.entry !== undefined) {
      this.customInputEntries.add(submission.entry);
    }
  }

  isTranscriptEntry(entry: EntryRecord): boolean {
    return isTranscriptEntry(entry.kind) && !this.customInputEntries.has(entry.id);
  }

  /** Use native admission and queue boundaries, but project the notification only in its SDK custom form. */
  submitCustomMessage(content: UserInput, whenBusy: "steer" | "followUp") {
    this.assertOwned();
    return this.conversation.submit({ type: "input", content, whenBusy, requestId: `${CUSTOM_INPUT_REQUEST_PREFIX}${randomUUID()}` }, BACKGROUND_CONTEXT);
  }

  /** Called before tools and after committed events, so extension hooks see committed assistant calls. */
  project(): Promise<void> {
    if (this.closing !== undefined) return this.projection;
    this.projection = this.projection.then(async () => {
      if (this.isClosing()) return;
      this.pool.assertOwned(this.handle.address);
      let cursor: Cursor | undefined;
      const query = { order: "ascending" as const, ...(this.scanned === undefined ? {} : { minEntryId: this.scanned }) };
      do {
        const page = await this.conversation.entries(query, 256, cursor, BACKGROUND_CONTEXT);
        const aliases: { id: string; entry: EntryRecord; index: number }[] = [];
        for (const entry of page.items) {
          aliases.push(...this.projectEntry(entry));
          this.scanned = entry.id;
        }
        if (this.isClosing()) return;
        if (aliases.length > 0) await this.harness.commit(async (tx) => {
          const document = await tx.doc(NativeEntryAliases);
          for (const alias of aliases) document.aliases[alias.id] = { conversationId: alias.entry.conversationId, entryId: alias.entry.id, messageIndex: alias.index };
        }, BACKGROUND_CONTEXT);
        cursor = page.next;
      } while (cursor !== undefined);
      await this.ensureCatalogProjection();
    });
    return this.projection;
  }

  private projectEntry(entry: EntryRecord): { id: string; entry: EntryRecord; index: number }[] {
    const projectedKey = (index: number) => `${String(entry.conversationId)}:${String(entry.id)}:${String(index)}`;
    const stamp = (index: number) => ({ [DURABLE_SESSION_PROPERTY]: this.ownerSessionId, [DURABLE_ENTRY_PROPERTY]: entry.id,
      [DURABLE_JOURNAL_PROPERTY]: this.handle.address.journalId, [DURABLE_CONVERSATION_PROPERTY]: entry.conversationId, [DURABLE_MESSAGE_PROPERTY]: index });
    if (!this.projected.has(projectedKey(0)) && isHostEntryKind(entry.kind)) {
      const data = typeof entry.data === "object" && entry.data !== null && !Array.isArray(entry.data) ? entry.data : {};
      const id = this.manager.appendCustomMessageEntry(entry.kind, hostEntryText(entry.kind, entry.data), true, { ...data, ...stamp(0) });
      this.projected.set(projectedKey(0), id);
      return [{ id, entry, index: 0 }];
    }
    if (isHostEntryKind(entry.kind)) {
      const id = this.projected.get(projectedKey(0));
      return id === undefined ? [] : [{ id, entry, index: 0 }];
    }
    if (!this.isTranscriptEntry(entry)) return [];
    const aliases: { id: string; entry: EntryRecord; index: number }[] = [];
    for (const [index, message] of (entry.model ?? []).entries()) {
      if (message.role === "system") continue;
      const existing = this.projected.get(projectedKey(index));
      if (existing !== undefined) { aliases.push({ id: existing, entry, index }); continue; }
      // Complete family identity and message position make interrupted multi-message export restartable.
      const id = this.manager.appendMessage({ ...message, ...stamp(index) });
      aliases.push({ id, entry, index });
      this.projected.set(projectedKey(index), id);
    }
    return aliases;
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

  /** Legacy facade bridge: select a native cut, never append the selected prefix. */
  async selectBranch(): Promise<void> {
    this.assertOwned();
    const leaf = this.manager.getLeafId();
    const imported = await this.harness.snapshot(LegacyTree, BACKGROUND_CONTEXT);
    const mapped = leaf === null ? undefined : imported?.aliases[leaf];
    let source = this.conversation;
    let cut = mapped?.entryId;
    if (mapped !== undefined) {
      const conversation = await this.harness.conversation(boundConversationId(mapped.conversationId), BACKGROUND_CONTEXT);
      if (conversation === undefined) throw new Error("Missing imported branch");
      source = conversation;
    } else if (leaf === null) {
      const origin = (await source.entries({ order: "ascending" }, 1, undefined, BACKGROUND_CONTEXT)).items[0];
      if (origin?.kind !== "forgerie.origin") throw new Error("Missing empty historical anchor");
      cut = origin.id;
    }
    if (cut === undefined) throw new Error("SDK branch target has no native alias");
    const entry = (await source.entries({}, 1, undefined, BACKGROUND_CONTEXT)).items[0];
    if (entry === undefined) throw new Error("Imported source is empty");
    const nativeCut = await source.commit((tx) => tx.entry(entry.id === cut ? entry.id : importedEntryId(cut)), BACKGROUND_CONTEXT);
    if (nativeCut === undefined) throw new Error("Missing native branch cut");
    const candidate = await source.fork(nativeCut.id, { ownership: { kind: "ownerless" }, init: async (tx, id) => {
      await this.initializeParentDocuments?.(tx, { id, parent: { conversationId: source.id, at: nativeCut.id } });
      await bindSession(tx, this.handle.address.journalId, this.handle.address.sessionId, id);
    } }, BACKGROUND_CONTEXT);
    const acquired = await this.pool.acquire({ ...this.handle.address, conversationId: candidate.id }, this.harnessOptions, BACKGROUND_CONTEXT);
    const outgoing = this.handleValue;
    this.handleValue = acquired;
    this.scanned = undefined;
    this.adoptUsage(await this.harness.snapshot(UsageDoc, this.conversation.id, BACKGROUND_CONTEXT) ?? { models: {}, tools: {} });
    await outgoing.release(BACKGROUND_CONTEXT);
  }

  /** Closing one lease never interrupts its sibling's invocation or records Stop. */
  close(): Promise<void> {
    this.closing ??= (async () => {
      this.unsubscribe();
      // Release immediately: the last lease must interrupt unsafe tool invocations,
      // not give them time to finish while an export drains.
      const released = this.handle.release(BACKGROUND_CONTEXT);
      try { await this.projection; }
      finally { await released; }
    })();
    return this.closing;
  }

}

function isFsError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function importedEntryId(value: number): EntryId {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid imported entry ID");
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return value as EntryId;
}
