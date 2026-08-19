import { normalizeMessages, normalizeMessagesCooperatively, type ChatNormalizationOptions } from "./chatMessages";
import { applyTranscriptEvent, reconcileStreamingPartial, seedStreamingPartial } from "./chatTranscript";
import { mergeChatHistory, readChatHistoryCache, removeChatHistoryCache, writeChatHistoryCache, type RawMessagePage } from "./chatHistoryCache";
import type { ChatLine } from "./components/shared";
import type { SessionUiEvent } from "./sessionSocket";

export interface ChatTranscriptView {
  messages: ChatLine[];
  messagePageStart: number;
  // End offset in the raw transcript. Normalization may coalesce multiple raw
  // entries into one displayed chat message, especially tool calls/results.
  messagePageEnd: number;
  messagePageTotal: number;
}

export type ChatTranscriptMergeResult =
  | { readonly kind: "merged"; readonly view: ChatTranscriptView }
  | { readonly kind: "superseded" };

export interface ChatHistoryCacheAdapter {
  read(sessionId: string): RawMessagePage | undefined;
  write(sessionId: string, page: RawMessagePage): void;
  remove?(sessionId: string): void;
}

export interface ChatTranscriptPersistScheduler {
  requestAnimationFrame(callback: () => void): number;
  cancelAnimationFrame(id: number): void;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(id: number): void;
}

export interface ChatTranscriptStoreOptions {
  capacity?: number | undefined;
  scheduler?: ChatTranscriptPersistScheduler | undefined;
  normalization?: ChatNormalizationOptions | undefined;
}

interface HotTranscriptEntry {
  raw: RawMessagePage;
  view: ChatTranscriptView;
  generation: number;
}

interface PendingPersist {
  frameId: number | undefined;
  timerId: number | undefined;
  generation: number;
  raw: RawMessagePage;
  useHotEntry: boolean;
}

export const DEFAULT_CHAT_TRANSCRIPT_HOT_CAPACITY = 5;

const browserChatHistoryCache: ChatHistoryCacheAdapter = {
  read: readChatHistoryCache,
  write: writeChatHistoryCache,
  remove: removeChatHistoryCache,
};

const browserPersistScheduler: ChatTranscriptPersistScheduler = {
  requestAnimationFrame(callback: () => void): number {
    return globalThis.requestAnimationFrame(callback);
  },
  cancelAnimationFrame(id: number): void {
    globalThis.cancelAnimationFrame(id);
  },
  setTimeout(callback: () => void, delayMs: number): number {
    return Number(globalThis.setTimeout(callback, delayMs));
  },
  clearTimeout(id: number): void {
    globalThis.clearTimeout(id);
  },
};

export class ChatTranscriptStore {
  private readonly hotEntries = new Map<string, HotTranscriptEntry>();
  private readonly pendingPersists = new Map<string, PendingPersist>();
  private readonly cooperativeMergeQueues = new Map<string, Promise<void>>();
  private readonly mergeTokens = new Map<string, object>();
  private lifecycleGeneration = 0;
  private readonly capacity: number;
  private readonly scheduler: ChatTranscriptPersistScheduler;
  private readonly normalization: ChatNormalizationOptions;

  constructor(
    private readonly cache: ChatHistoryCacheAdapter = browserChatHistoryCache,
    options: ChatTranscriptStoreOptions = {},
  ) {
    this.capacity = validCapacity(options.capacity) ? options.capacity : DEFAULT_CHAT_TRANSCRIPT_HOT_CAPACITY;
    this.scheduler = options.scheduler ?? browserPersistScheduler;
    this.normalization = options.normalization ?? {};
  }

  cachedView(sessionId: string): ChatTranscriptView {
    const entry = this.hotEntry(sessionId);
    return entry?.view ?? transcriptViewFromHistory(undefined);
  }

  boundedCachedView(sessionId: string, maxRawMessages: number): ChatTranscriptView | undefined {
    const existing = this.hotEntries.get(sessionId);
    if (existing !== undefined && existing.raw.messages.length <= maxRawMessages) {
      this.touch(sessionId, existing);
      return existing.view;
    }
    if (existing !== undefined) {
      this.hotEntries.delete(sessionId);
      this.removeUnusedMergeToken(sessionId);
    }

    const pending = this.pendingPersists.get(sessionId);
    if (pending !== undefined && pending.raw.messages.length <= maxRawMessages) {
      return this.storeHotEntry(sessionId, pending.raw, pending.generation).view;
    }
    if (pending !== undefined) {
      this.clearScheduledPersist(sessionId);
      this.removeUnusedMergeToken(sessionId);
    }

    let cached: RawMessagePage | undefined;
    try {
      cached = this.cache.read(sessionId);
    } catch {
      return undefined;
    }
    if (cached === undefined) return undefined;
    if (cached.messages.length > maxRawMessages) {
      this.removePersistedCache(sessionId);
      return undefined;
    }
    return this.storeHotEntry(sessionId, cached, 0).view;
  }

  mergeHistory(sessionId: string, page: RawMessagePage): ChatTranscriptView {
    this.invalidateCooperativeMerges(sessionId);
    const existing = this.hotEntry(sessionId);
    const history = mergeChatHistory(existing?.raw, page);
    if (existing !== undefined && rawMessagePagesEqual(existing.raw, history)) {
      this.touch(sessionId, existing);
      return existing.view;
    }

    const pending = this.pendingPersists.get(sessionId);
    const entry = this.storeHotEntry(sessionId, history, Math.max(existing?.generation ?? 0, pending?.generation ?? 0) + 1);
    return entry.view;
  }

  async mergeHistoryCooperatively(sessionId: string, page: RawMessagePage): Promise<ChatTranscriptMergeResult> {
    const token = this.mergeToken(sessionId);
    const lifecycleGeneration = this.lifecycleGeneration;
    const previous = this.cooperativeMergeQueues.get(sessionId) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async (): Promise<ChatTranscriptMergeResult> => {
      if (!this.isCooperativeMergeCurrent(sessionId, token, lifecycleGeneration)) return { kind: "superseded" };
      const existing = this.hotEntry(sessionId);
      const history = mergeChatHistory(existing?.raw, page);
      if (existing !== undefined && rawMessagePagesEqual(existing.raw, history)) {
        this.touch(sessionId, existing);
        return { kind: "merged", view: existing.view };
      }

      const normalized = await normalizeMessagesCooperatively(history.messages, {
        ...this.normalization,
        shouldContinue: () => this.isCooperativeMergeCurrent(sessionId, token, lifecycleGeneration),
      });
      if (normalized.kind === "superseded") return normalized;
      const view = transcriptView(normalized.messages, history.start, history.messages.length, history.total);
      const pending = this.pendingPersists.get(sessionId);
      const entry = this.storeHotEntry(sessionId, history, Math.max(existing?.generation ?? 0, pending?.generation ?? 0) + 1, view);
      return { kind: "merged", view: entry.view };
    });
    const tail = operation.then(() => undefined, () => undefined);
    this.cooperativeMergeQueues.set(sessionId, tail);
    try {
      return await operation;
    } finally {
      if (this.cooperativeMergeQueues.get(sessionId) === tail) this.cooperativeMergeQueues.delete(sessionId);
      this.removeUnusedMergeToken(sessionId);
    }
  }

  cancelCooperativeMerges(): void {
    this.lifecycleGeneration += 1;
    this.mergeTokens.clear();
  }

  schedulePersist(sessionId: string): void {
    const entry = this.hotEntries.get(sessionId);
    if (entry === undefined) return;
    this.schedulePersistPage(sessionId, entry.raw, entry.generation, true);
  }

  schedulePersistedPage(sessionId: string, page: RawMessagePage): void {
    const current = this.hotEntries.get(sessionId);
    const pending = this.pendingPersists.get(sessionId);
    this.schedulePersistPage(sessionId, page, Math.max(current?.generation ?? 0, pending?.generation ?? 0), false);
  }

  private schedulePersistPage(sessionId: string, raw: RawMessagePage, generation: number, useHotEntry: boolean): void {
    this.clearScheduledPersist(sessionId);
    const pending: PendingPersist = {
      frameId: undefined,
      timerId: undefined,
      generation,
      raw: cloneRawMessagePage(raw),
      useHotEntry,
    };
    pending.frameId = this.scheduler.requestAnimationFrame(() => {
      pending.frameId = undefined;
      if (this.pendingPersists.get(sessionId) !== pending) return;
      pending.timerId = this.scheduler.setTimeout(() => {
        pending.timerId = undefined;
        this.runScheduledPersist(sessionId, pending);
      }, 0);
    });
    this.pendingPersists.set(sessionId, pending);
  }

  applyLiveEvent(messages: ChatLine[], event: SessionUiEvent): ChatLine[] | undefined {
    return applyTranscriptEvent(messages, event);
  }

  /**
   * Seed the join-time in-flight partial assistant message on top of the
   * committed history view. Returns a new in-memory message list; the raw
   * history cache is deliberately untouched so the partial never persists.
   */
  seedStreamingPartial(messages: ChatLine[], partial: unknown): ChatLine[] {
    return seedStreamingPartial(messages, partial);
  }

  reconcileStreamingPartial(messages: ChatLine[], partial: unknown): ChatLine[] {
    return reconcileStreamingPartial(messages, partial);
  }

  discard(sessionId: string): void {
    this.invalidateCooperativeMerges(sessionId);
    this.clearScheduledPersist(sessionId);
    this.hotEntries.delete(sessionId);
    this.removeUnusedMergeToken(sessionId);
    this.removePersistedCache(sessionId);
  }

  dispose(): void {
    this.cancelCooperativeMerges();
    this.cooperativeMergeQueues.clear();
    for (const sessionId of [...this.pendingPersists.keys()]) this.clearScheduledPersist(sessionId);
    this.hotEntries.clear();
  }

  rawHistoryPage(sessionId: string): RawMessagePage | undefined {
    return this.hotEntry(sessionId)?.raw;
  }

  private removePersistedCache(sessionId: string): void {
    try {
      this.cache.remove?.(sessionId);
    } catch {
      // Removing browser cache is best effort for the same reason writes are.
    }
  }

  private mergeToken(sessionId: string): object {
    const existing = this.mergeTokens.get(sessionId);
    if (existing !== undefined) return existing;
    const token = {};
    this.mergeTokens.set(sessionId, token);
    return token;
  }

  private invalidateCooperativeMerges(sessionId: string): void {
    this.mergeTokens.set(sessionId, {});
  }

  private isCooperativeMergeCurrent(sessionId: string, token: object, lifecycleGeneration: number): boolean {
    return lifecycleGeneration === this.lifecycleGeneration && this.mergeTokens.get(sessionId) === token;
  }

  private removeUnusedMergeToken(sessionId: string): void {
    if (this.hotEntries.has(sessionId) || this.cooperativeMergeQueues.has(sessionId)) return;
    this.mergeTokens.delete(sessionId);
  }

  private hotEntry(sessionId: string): HotTranscriptEntry | undefined {
    const existing = this.hotEntries.get(sessionId);
    if (existing !== undefined) {
      this.touch(sessionId, existing);
      return existing;
    }

    const pending = this.pendingPersists.get(sessionId);
    if (pending !== undefined) return this.storeHotEntry(sessionId, pending.raw, pending.generation);

    let cached: RawMessagePage | undefined;
    try {
      cached = this.cache.read(sessionId);
    } catch {
      return undefined;
    }
    if (cached === undefined) return undefined;
    return this.storeHotEntry(sessionId, cached, 0);
  }

  private storeHotEntry(sessionId: string, raw: RawMessagePage, generation: number, view: ChatTranscriptView = transcriptViewFromHistory(raw)): HotTranscriptEntry {
    const entry: HotTranscriptEntry = {
      raw,
      view,
      generation,
    };
    this.hotEntries.delete(sessionId);
    this.hotEntries.set(sessionId, entry);
    this.evictOverflow();
    return entry;
  }

  private touch(sessionId: string, entry: HotTranscriptEntry): void {
    this.hotEntries.delete(sessionId);
    this.hotEntries.set(sessionId, entry);
  }

  private evictOverflow(): void {
    while (this.hotEntries.size > this.capacity) {
      const oldest = this.hotEntries.keys().next().value;
      if (typeof oldest !== "string") return;
      this.clearScheduledPersist(oldest);
      this.hotEntries.delete(oldest);
      this.removeUnusedMergeToken(oldest);
    }
  }

  private runScheduledPersist(sessionId: string, pending: PendingPersist): void {
    if (this.pendingPersists.get(sessionId) !== pending) return;
    this.pendingPersists.delete(sessionId);
    const current = this.hotEntries.get(sessionId);
    if (pending.useHotEntry && current !== undefined && current.generation !== pending.generation) return;
    try {
      this.cache.write(sessionId, pending.useHotEntry ? (current?.raw ?? pending.raw) : pending.raw);
    } catch {
      // Persisted transcript history is best effort. The in-memory hot view
      // remains authoritative for this tab when storage is full or blocked.
    }
  }

  private clearScheduledPersist(sessionId: string): void {
    const pending = this.pendingPersists.get(sessionId);
    if (pending === undefined) return;
    if (pending.frameId !== undefined) this.scheduler.cancelAnimationFrame(pending.frameId);
    if (pending.timerId !== undefined) this.scheduler.clearTimeout(pending.timerId);
    this.pendingPersists.delete(sessionId);
  }
}

export function transcriptViewFromHistory(history: RawMessagePage | undefined): ChatTranscriptView {
  return transcriptView(
    normalizeMessages(history?.messages ?? []),
    history?.start ?? 0,
    history?.messages.length ?? 0,
    history?.total ?? 0,
  );
}

function transcriptView(messages: ChatLine[], start: number, rawMessageCount: number, total: number): ChatTranscriptView {
  return {
    messages,
    messagePageStart: start,
    messagePageEnd: start + rawMessageCount,
    messagePageTotal: total,
  };
}

function validCapacity(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value > 0;
}

function rawMessagePagesEqual(left: RawMessagePage, right: RawMessagePage): boolean {
  return left.start === right.start
    && left.total === right.total
    && left.messages.length === right.messages.length
    && left.messages.every((message, index) => Object.is(message, right.messages[index]));
}

function cloneRawMessagePage(page: RawMessagePage): RawMessagePage {
  return { start: page.start, total: page.total, messages: [...page.messages] };
}
