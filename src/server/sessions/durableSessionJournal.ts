import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Models, Message } from "@earendil-works/pi-ai";
import { type SessionManager } from "@earendil-works/pi-coding-agent";
import { UsageDoc, type UsageState, type AgentChange, type Conversation, type Cursor, type EntryRecord, type HarnessOptions, type HarnessSettings, type Registry, type SubmissionRecord, type UserInput } from "@earendil-works/pi-durable";
import { Check } from "typebox/value";
import { DurableUsageStateSchema } from "../../shared/durableUsage.js";
import { readDurableSessionLocator, writeDurableSessionLocator } from "./durableSessionLocator.js";
import { hostEntryText, isHostEntryKind } from "./durableHostEntries.js";
import { DurableJournalPool, type InitializeParentDocuments } from "./durableJournalPool.js";
import type { DurableSessionHandle } from "./durableSessionAddress.js";
import { createDurableNativeHistory, NativeEntryAliases } from "./durableNativeHistory.js";
import { importDurableLegacyTree, prepareLegacyImportReceipt, LegacyImportError, LegacyMigration, LegacyTree } from "./durableLegacyImport.js";

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
  summarize?: Parameters<typeof createDurableNativeHistory>[1]["summarize"];
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
      ...(this.summarize === undefined ? {} : { summarize: this.summarize }),
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
    private readonly summarize: DurableJournalOptions["summarize"],
    readonly legacyImportError: LegacyImportError | undefined,
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
      const stamp = entry.type === "message" ? entry.message : entry.type === "custom_message" || entry.type === "branch_summary" ? entry.details : undefined;
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
    let legacyImportError: LegacyImportError | undefined;
    try {
      if (handle === undefined && sessionFile !== undefined) {
        const locator = await readDurableSessionLocator(durableSessionPaths(sessionFile).directory);
        if (locator !== undefined) {
          if (locator.sessionId !== options.manager.getSessionId()) throw new Error("Foreign logical session locator");
          handle = await pool.acquire(locator, harnessOptions, BACKGROUND_CONTEXT);
        }
      }
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
        await prepareLegacyImportReceipt(handle, pool, BACKGROUND_CONTEXT);
        try {
          if ((await handle.harness.snapshot(LegacyMigration, BACKGROUND_CONTEXT))?.complete !== true) await importDurableLegacyTree(handle, options.manager, BACKGROUND_CONTEXT, options.initializeParentDocuments);
        } catch (error) {
          if (!(error instanceof LegacyImportError)) throw error;
          legacyImportError = error;
          await handle.harness.commit(async (tx) => { (await tx.doc(LegacyMigration)).failure = error.message; }, BACKGROUND_CONTEXT);
          options.onReport?.(error);
        }
        // Import may select a historical continuation. Never reopen the reserved root instead.
        const selected = await pool.acquire({ databasePath: handle.address.databasePath, sessionId: handle.address.sessionId }, harnessOptions, BACKGROUND_CONTEXT);
        await handle.release(BACKGROUND_CONTEXT);
        handle = selected;
      }
      await prepareLegacyImportReceipt(handle, pool, BACKGROUND_CONTEXT);
      const journal = new DurableSessionJournal(handle, options.manager, pool, harnessOptions, options.initializeParentDocuments, options.onReport, options.summarize, legacyImportError);
      journal.adoptUsage(await handle.harness.snapshot(UsageDoc, handle.conversation.id, BACKGROUND_CONTEXT) ?? { models: {}, tools: {} });
      for (const submission of await pool.submissions(handle.address, BACKGROUND_CONTEXT)) journal.noteCustomInput(submission);
      if (sessionFile !== undefined && legacyImportError === undefined) await writeDurableSessionLocator(durableSessionPaths(sessionFile).directory, handle.address);
      if (legacyImportError === undefined) {
        await journal.project();
        await journal.restoreExportLeaf();
      }
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
    if (this.legacyImportError !== undefined) throw new Error(`Session remains on legacy reads: ${this.legacyImportError.message}`);
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
    if (this.legacyImportError !== undefined) return Promise.resolve();
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
    if (entry.kind === "forgerie.branch-summary") {
      let id = this.projected.get(projectedKey(0));
      if (id === undefined) {
        if (typeof entry.data !== "string") throw new Error("Invalid native branch summary");
        id = this.manager.branchWithSummary(this.manager.getLeafId(), entry.data, stamp(0));
        this.projected.set(projectedKey(0), id);
      }
      return [{ id, entry, index: 0 }];
    }
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

  /** Derived SDK IDs are compatibility aliases, not native mutation targets. */
  sdkEntryId(entry: EntryRecord, index = Math.max(0, (entry.model?.length ?? 1) - 1)): string | undefined {
    const key = `${String(entry.conversationId)}:${String(entry.id)}:${String(index)}`;
    const projected = this.projected.get(key);
    if (projected !== undefined) return projected;
    const sdk = typeof entry.data === "object" && entry.data !== null && !Array.isArray(entry.data) ? entry.data["sdkEntryId"] : undefined;
    // An imported bookmark belongs to the parent graph. It is an export alias
    // only when this manager actually contains it; a fresh fork does not.
    if (index === 0 && typeof sdk === "string" && this.manager.getEntry(sdk) !== undefined) {
      this.projected.set(key, sdk);
      return sdk;
    }
    return undefined;
  }

  /** JSONL has no durable leaf selector. Restore it from the selected native history, not the file tail. */
  private async restoreExportLeaf(): Promise<void> {
    const visible = new Set<string>();
    let leaf: string | undefined;
    let cursor: Cursor | undefined;
    do {
      const page = await this.conversation.entries({ order: "ascending" }, 256, cursor, BACKGROUND_CONTEXT);
      for (const entry of page.items) {
        for (let index = 0; index < Math.max(1, entry.model?.length ?? 0); index++) {
          const id = this.sdkEntryId(entry, index);
          if (id !== undefined) { visible.add(id); leaf = id; }
        }
      }
      cursor = page.next;
    } while (cursor !== undefined);
    const branch = this.manager.getBranch();
    const imported = await this.harness.snapshot(LegacyTree, BACKGROUND_CONTEXT);
    const known = new Set([...this.projected.values(), ...Object.keys(imported?.aliases ?? {})]);
    const content = branch.slice().reverse().find((entry) => known.has(entry.id));
    // Keep export-only envelopes and extension records after a selected native alias.
    // An abandoned native alias in the file tail must never select the branch.
    if ((content === undefined || visible.has(content.id)) && (leaf === undefined || branch.some((entry) => entry.id === leaf))) return;
    if (leaf === undefined) this.manager.resetLeaf();
    else this.manager.branch(leaf);
  }

  /** Adopt the committed selection and move only the export's leaf. Never write a prefix back to Durable. */
  async selectHandle(handle: DurableSessionHandle): Promise<void> {
    this.assertOwned();
    if (handle.harness !== this.harness || handle.address.sessionId !== this.handle.address.sessionId) throw new Error("Foreign selected handle");
    await this.projection;
    const entries: EntryRecord[] = [];
    let cursor: Cursor | undefined;
    do {
      const page = await handle.conversation.entries({ order: "ascending" }, 256, cursor, BACKGROUND_CONTEXT);
      entries.push(...page.items); cursor = page.next;
    } while (cursor !== undefined);
    const leaf = entries.slice().reverse().map((entry) => this.sdkEntryId(entry)).find((id) => id !== undefined);
    if (leaf === undefined) this.manager.resetLeaf();
    else this.manager.branch(leaf);
    const outgoing = this.handleValue;
    this.handleValue = handle;
    this.scanned = undefined;
    this.customInputEntries.clear();
    for (const submission of await this.pool.submissions(handle.address, BACKGROUND_CONTEXT)) this.noteCustomInput(submission);
    this.adoptUsage(await this.harness.snapshot(UsageDoc, this.conversation.id, BACKGROUND_CONTEXT) ?? { models: {}, tools: {} });
    const file = this.manager.getSessionFile();
    if (file !== undefined) await writeDurableSessionLocator(durableSessionPaths(file).directory, handle.address);
    await this.project();
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
