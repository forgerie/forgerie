import { normalizeMessages } from "./chatMessages";
import { applyTranscriptEvent, seedStreamingPartial } from "./chatTranscript";
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
  private readonly capacity: number;
  private readonly scheduler: ChatTranscriptPersistScheduler;

  constructor(
    private readonly cache: ChatHistoryCacheAdapter = browserChatHistoryCache,
    options: ChatTranscriptStoreOptions = {},
  ) {
    this.capacity = validCapacity(options.capacity) ? options.capacity : DEFAULT_CHAT_TRANSCRIPT_HOT_CAPACITY;
    this.scheduler = options.scheduler ?? browserPersistScheduler;
  }

  cachedView(sessionId: string): ChatTranscriptView {
    const entry = this.hotEntry(sessionId);
    return entry?.view ?? transcriptViewFromHistory(undefined);
  }

  mergeHistory(sessionId: string, page: RawMessagePage): ChatTranscriptView {
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

  schedulePersist(sessionId: string): void {
    const entry = this.hotEntries.get(sessionId);
    if (entry === undefined) return;

    this.clearScheduledPersist(sessionId);
    const pending: PendingPersist = {
      frameId: undefined,
      timerId: undefined,
      generation: entry.generation,
      raw: cloneRawMessagePage(entry.raw),
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

  discard(sessionId: string): void {
    this.clearScheduledPersist(sessionId);
    this.hotEntries.delete(sessionId);
    try {
      this.cache.remove?.(sessionId);
    } catch {
      // Removing browser cache is best effort for the same reason writes are.
    }
  }

  dispose(): void {
    for (const sessionId of [...this.pendingPersists.keys()]) this.clearScheduledPersist(sessionId);
    this.hotEntries.clear();
  }

  rawHistoryPage(sessionId: string): RawMessagePage | undefined {
    return this.hotEntry(sessionId)?.raw;
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

  private storeHotEntry(sessionId: string, raw: RawMessagePage, generation: number): HotTranscriptEntry {
    const entry: HotTranscriptEntry = {
      raw,
      view: transcriptViewFromHistory(raw),
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
    }
  }

  private runScheduledPersist(sessionId: string, pending: PendingPersist): void {
    if (this.pendingPersists.get(sessionId) !== pending) return;
    this.pendingPersists.delete(sessionId);
    const current = this.hotEntries.get(sessionId);
    if (current !== undefined && current.generation !== pending.generation) return;
    try {
      this.cache.write(sessionId, current?.raw ?? pending.raw);
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
  const start = history?.start ?? 0;
  return {
    messages: normalizeMessages(history?.messages ?? []),
    messagePageStart: start,
    messagePageEnd: start + (history?.messages.length ?? 0),
    messagePageTotal: history?.total ?? 0,
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
