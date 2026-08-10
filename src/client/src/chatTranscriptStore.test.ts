import { describe, expect, it } from "vitest";
import { ChatTranscriptStore, type ChatHistoryCacheAdapter, type ChatTranscriptPersistScheduler } from "./chatTranscriptStore";
import type { RawMessagePage } from "./chatHistoryCache";

class MemoryChatHistoryCache implements ChatHistoryCacheAdapter {
  readonly pages = new Map<string, RawMessagePage>();
  readonly writes: { sessionId: string; page: RawMessagePage }[] = [];
  readonly removals: string[] = [];

  read(sessionId: string): RawMessagePage | undefined {
    return this.pages.get(sessionId);
  }

  write(sessionId: string, page: RawMessagePage): void {
    this.writes.push({ sessionId, page });
    this.pages.set(sessionId, page);
  }

  remove(sessionId: string): void {
    this.removals.push(sessionId);
    this.pages.delete(sessionId);
  }
}

class ThrowingWriteChatHistoryCache extends MemoryChatHistoryCache {
  override write(sessionId: string, page: RawMessagePage): void {
    this.writes.push({ sessionId, page });
    throw new Error("quota exceeded");
  }
}

class ManualPersistScheduler implements ChatTranscriptPersistScheduler {
  private nextId = 1;
  readonly frames = new Map<number, () => void>();
  readonly timers = new Map<number, () => void>();
  readonly cancelledFrames: number[] = [];
  readonly clearedTimers: number[] = [];

  requestAnimationFrame(callback: () => void): number {
    const id = this.nextId;
    this.nextId += 1;
    this.frames.set(id, callback);
    return id;
  }

  cancelAnimationFrame(id: number): void {
    this.cancelledFrames.push(id);
    this.frames.delete(id);
  }

  setTimeout(callback: () => void): number {
    const id = this.nextId;
    this.nextId += 1;
    this.timers.set(id, callback);
    return id;
  }

  clearTimeout(id: number): void {
    this.clearedTimers.push(id);
    this.timers.delete(id);
  }

  flushFrames(): void {
    const callbacks = [...this.frames.entries()];
    this.frames.clear();
    for (const [, callback] of callbacks) callback();
  }

  flushTimers(): void {
    const callbacks = [...this.timers.entries()];
    this.timers.clear();
    for (const [, callback] of callbacks) callback();
  }

  flush(): void {
    this.flushFrames();
    this.flushTimers();
  }
}

class NonCancellingManualPersistScheduler extends ManualPersistScheduler {
  override cancelAnimationFrame(id: number): void {
    this.cancelledFrames.push(id);
  }

  override clearTimeout(id: number): void {
    this.clearedTimers.push(id);
  }
}

function page(start: number, total: number, messages: unknown[]): RawMessagePage {
  return { start, total, messages };
}

describe("ChatTranscriptStore", () => {
  it("returns stable normalized view and message references for unchanged committed history", () => {
    const store = new ChatTranscriptStore(new MemoryChatHistoryCache());
    const raw = page(0, 2, [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }]);

    const merged = store.mergeHistory("s1", raw);
    const cached = store.cachedView("s1");
    const unchanged = store.mergeHistory("s1", raw);

    expect(cached).toBe(merged);
    expect(cached.messages).toBe(merged.messages);
    expect(unchanged).toBe(merged);
    expect(unchanged.messages).toBe(merged.messages);
  });

  it("evicts the least-recently-used hot transcript without corrupting retained views", () => {
    const cache = new MemoryChatHistoryCache();
    const store = new ChatTranscriptStore(cache, { capacity: 2 });
    const first = store.mergeHistory("s1", page(0, 1, [{ role: "user", content: "one" }]));
    store.mergeHistory("s2", page(0, 1, [{ role: "user", content: "two" }]));
    expect(store.cachedView("s1")).toBe(first);

    const third = store.mergeHistory("s3", page(0, 1, [{ role: "user", content: "three" }]));

    expect(store.cachedView("s1")).toBe(first);
    expect(store.cachedView("s2")).toEqual({ messages: [], messagePageStart: 0, messagePageEnd: 0, messagePageTotal: 0 });
    expect(store.cachedView("s3")).toBe(third);
  });

  it("keeps the latest scheduled persistence when LRU eviction drops the hot view", () => {
    const cache = new MemoryChatHistoryCache();
    const scheduler = new ManualPersistScheduler();
    const store = new ChatTranscriptStore(cache, { capacity: 1, scheduler });
    const evicted = page(0, 1, [{ role: "user", content: "persist me" }]);

    store.mergeHistory("s1", evicted);
    store.schedulePersist("s1");
    store.mergeHistory("s2", page(0, 1, [{ role: "user", content: "evict s1" }]));
    scheduler.flush();

    expect(cache.writes).toEqual([{ sessionId: "s1", page: evicted }]);
  });

  it("lets explicit discard cancel a pending persist after LRU eviction", () => {
    const cache = new MemoryChatHistoryCache();
    const scheduler = new ManualPersistScheduler();
    const store = new ChatTranscriptStore(cache, { capacity: 1, scheduler });

    store.mergeHistory("s1", page(0, 1, [{ role: "user", content: "discard me" }]));
    store.schedulePersist("s1");
    store.mergeHistory("s2", page(0, 1, [{ role: "user", content: "evict s1" }]));
    store.discard("s1");
    scheduler.flush();

    expect(cache.removals).toEqual(["s1"]);
    expect(cache.writes).toEqual([]);
  });

  it("keeps merge synchronous work in memory until persistence is explicitly scheduled", () => {
    const cache = new MemoryChatHistoryCache();
    const scheduler = new ManualPersistScheduler();
    const store = new ChatTranscriptStore(cache, { scheduler });
    const raw = page(0, 1, [{ role: "user", content: "hi" }]);

    store.mergeHistory("s1", raw);

    expect(cache.writes).toEqual([]);
    store.schedulePersist("s1");
    expect(cache.writes).toEqual([]);

    scheduler.flush();

    expect(cache.writes).toEqual([{ sessionId: "s1", page: raw }]);
  });

  it("runs deferred persistence from a timer after an animation frame", () => {
    const cache = new MemoryChatHistoryCache();
    const scheduler = new ManualPersistScheduler();
    const store = new ChatTranscriptStore(cache, { scheduler });
    const raw = page(0, 1, [{ role: "user", content: "after paint" }]);

    store.mergeHistory("s1", raw);
    store.schedulePersist("s1");
    scheduler.flushFrames();

    expect(cache.writes).toEqual([]);
    scheduler.flushTimers();

    expect(cache.writes).toEqual([{ sessionId: "s1", page: raw }]);
  });

  it("cancels both unpainted frames and post-frame timers", () => {
    const cache = new MemoryChatHistoryCache();
    const scheduler = new ManualPersistScheduler();
    const store = new ChatTranscriptStore(cache, { scheduler });

    store.mergeHistory("discarded", page(0, 1, [{ role: "user", content: "discard" }]));
    store.schedulePersist("discarded");
    store.discard("discarded");

    store.mergeHistory("superseded", page(0, 1, [{ role: "user", content: "old" }]));
    store.schedulePersist("superseded");
    scheduler.flushFrames();
    store.mergeHistory("superseded", page(0, 2, [{ role: "user", content: "old" }, { role: "assistant", content: "new" }]));
    store.schedulePersist("superseded");
    scheduler.flush();

    expect(scheduler.cancelledFrames).toEqual([1]);
    expect(scheduler.clearedTimers).toEqual([3]);
    expect(cache.removals).toEqual(["discarded"]);
    expect(cache.writes).toEqual([{ sessionId: "superseded", page: page(0, 2, [{ role: "user", content: "old" }, { role: "assistant", content: "new" }]) }]);
  });

  it("cancels superseded deferred writes per session and persists independent latest pages", () => {
    const cache = new MemoryChatHistoryCache();
    const scheduler = new ManualPersistScheduler();
    const store = new ChatTranscriptStore(cache, { scheduler });
    const oldA = page(0, 1, [{ role: "user", content: "old a" }]);
    const pageB = page(0, 1, [{ role: "user", content: "b" }]);
    const newA = page(0, 2, [{ role: "user", content: "old a" }, { role: "assistant", content: "new a" }]);

    store.mergeHistory("a", oldA);
    store.schedulePersist("a");
    store.mergeHistory("b", pageB);
    store.schedulePersist("b");
    store.mergeHistory("a", newA);
    store.schedulePersist("a");
    scheduler.flush();

    expect(scheduler.cancelledFrames).toEqual([1]);
    expect(cache.writes).toEqual([
      { sessionId: "b", page: pageB },
      { sessionId: "a", page: newA },
    ]);
  });

  it("guards deferred writes by current generation when a cancelled callback still runs", () => {
    const cache = new MemoryChatHistoryCache();
    const scheduler = new NonCancellingManualPersistScheduler();
    const store = new ChatTranscriptStore(cache, { scheduler });
    const oldPage = page(0, 1, [{ role: "user", content: "old" }]);
    const newPage = page(0, 2, [{ role: "user", content: "old" }, { role: "assistant", content: "new" }]);

    store.mergeHistory("s1", oldPage);
    store.schedulePersist("s1");
    store.mergeHistory("s1", newPage);
    store.schedulePersist("s1");
    scheduler.flush();

    expect(cache.writes).toEqual([{ sessionId: "s1", page: newPage }]);
  });

  it("keeps the hot view readable when deferred persistence hits quota", () => {
    const cache = new ThrowingWriteChatHistoryCache();
    const scheduler = new ManualPersistScheduler();
    const store = new ChatTranscriptStore(cache, { scheduler });
    const view = store.mergeHistory("s1", page(0, 1, [{ role: "user", content: "survives" }]));

    store.schedulePersist("s1");

    expect(() => { scheduler.flush(); }).not.toThrow();
    expect(store.cachedView("s1")).toBe(view);
    expect(store.cachedView("s1").messages).toEqual([{ role: "user", parts: [{ type: "text", text: "survives" }] }]);
  });

  it("keeps rapid A to B to A selection identities and raw offsets independent", () => {
    const store = new ChatTranscriptStore(new MemoryChatHistoryCache(), { capacity: 3 });
    const initialA = store.mergeHistory("a", page(2, 4, [{ role: "user", content: "a3" }, { role: "assistant", content: "a4" }]));
    const viewB = store.mergeHistory("b", page(0, 1, [{ role: "user", content: "b1" }]));

    expect(store.cachedView("a")).toBe(initialA);
    const expandedA = store.mergeHistory("a", page(0, 4, [{ role: "user", content: "a1" }, { role: "assistant", content: "a2" }]));

    expect(expandedA).not.toBe(initialA);
    expect(expandedA.messagePageStart).toBe(0);
    expect(expandedA.messagePageEnd).toBe(4);
    expect(store.cachedView("b")).toBe(viewB);
    expect(store.cachedView("b").messages).toBe(viewB.messages);
  });

  it("hydrates a visible transcript from cached raw history", () => {
    const cache = new MemoryChatHistoryCache();
    cache.write("s1", page(0, 2, [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }]));

    expect(new ChatTranscriptStore(cache).cachedView("s1")).toEqual({
      messages: [
        { role: "user", parts: [{ type: "text", text: "hi" }] },
        { role: "assistant", parts: [{ type: "text", text: "hello" }] },
      ],
      messagePageStart: 0,
      messagePageEnd: 2,
      messagePageTotal: 2,
    });
  });

  it("tracks the raw page end separately from normalized display messages", () => {
    const store = new ChatTranscriptStore(new MemoryChatHistoryCache());

    const view = store.mergeHistory("s1", page(0, 3, [
      { role: "user", content: "run the tool" },
      { role: "assistant", content: [{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "src/app.ts" } }] },
      { role: "toolResult", toolCallId: "tool-1", toolName: "read", content: [{ type: "text", text: "ok" }] },
    ]));

    expect(view.messages).toHaveLength(2);
    expect(view.messagePageStart).toBe(0);
    expect(view.messagePageEnd).toBe(3);
    expect(view.messagePageTotal).toBe(3);
  });

  it("keeps live streamed transcript state out of the raw history cache", () => {
    const cache = new MemoryChatHistoryCache();
    const scheduler = new ManualPersistScheduler();
    const store = new ChatTranscriptStore(cache, { scheduler });
    const initial = page(0, 2, [{ role: "user", content: "hi" }, { role: "assistant", content: "hel" }]);
    const updated = page(1, 3, [{ role: "assistant", content: "hello" }, { role: "user", content: "next" }]);

    let visible = store.mergeHistory("s1", initial).messages;
    visible = store.applyLiveEvent(visible, { type: "assistant.delta", text: "lo" }) ?? visible;
    store.schedulePersist("s1");
    scheduler.flush();

    expect(visible.at(-1)).toEqual({ role: "assistant", parts: [{ type: "text", text: "hello" }] });
    expect(store.rawHistoryPage("s1")?.messages).toEqual(initial.messages);
    expect(cache.read("s1")?.messages).toEqual(initial.messages);
    expect(store.mergeHistory("s1", updated)).toEqual({
      messages: [
        { role: "user", parts: [{ type: "text", text: "hi" }] },
        { role: "assistant", parts: [{ type: "text", text: "hello" }] },
        { role: "user", parts: [{ type: "text", text: "next" }] },
      ],
      messagePageStart: 0,
      messagePageEnd: 3,
      messagePageTotal: 3,
    });
  });
});
