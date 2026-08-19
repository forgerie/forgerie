import { describe, expect, it, vi } from "vitest";
import { textMessage } from "./chatMessages";
import { ChatTranscriptStore, type ChatHistoryCacheAdapter } from "./chatTranscriptStore";
import type { RawMessagePage } from "./chatHistoryCache";
import { ControllableChatNormalizationScheduler } from "./chatMessages.testSupport";
import { ManualPersistScheduler } from "./chatTranscriptStore.testSupport";

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

  it("cooperatively normalizes a merged history page before publishing its hot view", async () => {
    const normalizationScheduler = new ControllableChatNormalizationScheduler();
    const store = new ChatTranscriptStore(new MemoryChatHistoryCache(), {
      normalization: { budgetMs: 5, scheduler: normalizationScheduler },
    });
    const raw = page(0, 4, [
      { role: "user", content: "run" },
      { role: "assistant", content: [{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "src/app.ts" } }] },
      { role: "toolResult", toolCallId: "read-1", toolName: "read", content: [{ type: "text", text: "file" }] },
      { role: "assistant", content: "done" },
    ]);

    const merged = await store.mergeHistoryCooperatively("s1", raw);
    const expected = new ChatTranscriptStore(new MemoryChatHistoryCache()).mergeHistory("s1", raw);

    expect(merged).toEqual({ kind: "merged", view: expected });
    if (merged.kind !== "merged") throw new Error("Expected merged transcript");
    expect(store.cachedView("s1")).toBe(merged.view);
    expect(normalizationScheduler.yieldCount).toBeGreaterThan(0);
  });

  it("does not let a superseded cooperative merge overwrite newer history", async () => {
    const normalizationScheduler = new ControllableChatNormalizationScheduler({ pauseFirstYield: true });
    const store = new ChatTranscriptStore(new MemoryChatHistoryCache(), {
      normalization: { budgetMs: 5, scheduler: normalizationScheduler },
    });
    const staleMerge = store.mergeHistoryCooperatively("s1", page(0, 2, [
      { role: "user", content: "stale question" },
      { role: "assistant", content: "stale answer" },
    ]));
    await vi.waitFor(() => { expect(normalizationScheduler.yieldCount).toBe(1); });

    const current = store.mergeHistory("s1", page(0, 1, [{ role: "assistant", content: "newer replacement" }]));
    normalizationScheduler.release();

    expect(await staleMerge).toEqual({ kind: "superseded" });
    expect(store.cachedView("s1")).toBe(current);
  });

  it("serializes cooperative merges so concurrent pages are both retained", async () => {
    const store = new ChatTranscriptStore(new MemoryChatHistoryCache(), {
      normalization: { budgetMs: 5, scheduler: new ControllableChatNormalizationScheduler() },
    });

    const [newer, older] = await Promise.all([
      store.mergeHistoryCooperatively("s1", page(2, 4, [
        { role: "user", content: "question" },
        { role: "assistant", content: "answer" },
      ])),
      store.mergeHistoryCooperatively("s1", page(0, 4, [
        { role: "user", content: "older question" },
        { role: "assistant", content: "older answer" },
      ])),
    ]);

    expect(newer.kind).toBe("merged");
    expect(older.kind).toBe("merged");
    expect(store.rawHistoryPage("s1")).toEqual(page(0, 4, [
      { role: "user", content: "older question" },
      { role: "assistant", content: "older answer" },
      { role: "user", content: "question" },
      { role: "assistant", content: "answer" },
    ]));
  });

  it("does not publish a cooperative merge after disposal", async () => {
    const normalizationScheduler = new ControllableChatNormalizationScheduler({ pauseFirstYield: true });
    const store = new ChatTranscriptStore(new MemoryChatHistoryCache(), {
      normalization: { budgetMs: 5, scheduler: normalizationScheduler },
    });
    const pending = store.mergeHistoryCooperatively("s1", page(0, 2, [
      { role: "user", content: "question" },
      { role: "assistant", content: "answer" },
    ]));
    await Promise.resolve();

    store.dispose();
    normalizationScheduler.release();

    expect(await pending).toEqual({ kind: "superseded" });
    expect(store.rawHistoryPage("s1")).toBeUndefined();
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

  it("cancels pending persistence when LRU eviction drops the hot view", () => {
    const cache = new MemoryChatHistoryCache();
    const scheduler = new ManualPersistScheduler();
    const store = new ChatTranscriptStore(cache, { capacity: 1, scheduler });

    store.mergeHistory("s1", page(0, 1, [{ role: "user", content: "do not persist after eviction" }]));
    store.schedulePersist("s1");
    store.mergeHistory("s2", page(0, 1, [{ role: "user", content: "evict s1" }]));
    scheduler.flush();

    expect(scheduler.cancelledFrames).toEqual([1]);
    expect(cache.writes).toEqual([]);
  });

  it("disposes all pending transcript persistence without stale writes", () => {
    const cache = new MemoryChatHistoryCache();
    const scheduler = new ManualPersistScheduler();
    const store = new ChatTranscriptStore(cache, { scheduler });

    store.mergeHistory("s1", page(0, 1, [{ role: "user", content: "timer pending" }]));
    store.schedulePersist("s1");
    scheduler.flushFrames();
    store.mergeHistory("s2", page(0, 1, [{ role: "user", content: "frame pending" }]));
    store.schedulePersist("s2");

    store.dispose();
    scheduler.flush();

    expect(scheduler.cancelledFrames).toEqual([3]);
    expect(scheduler.clearedTimers).toEqual([2]);
    expect(cache.writes).toEqual([]);
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

  it("persists a bounded preview without replacing the canonical hot view", () => {
    const cache = new MemoryChatHistoryCache();
    const scheduler = new ManualPersistScheduler();
    const store = new ChatTranscriptStore(cache, { scheduler });
    const canonical = page(0, 2, [{ role: "user", content: "full question" }, { role: "assistant", content: "full answer" }]);
    const preview = page(1, 2, [{ role: "assistant", content: "bounded answer" }]);

    const canonicalView = store.mergeHistory("s1", canonical);
    store.schedulePersistedPage("s1", preview);
    scheduler.flush();

    expect(cache.writes).toEqual([{ sessionId: "s1", page: preview }]);
    expect(store.rawHistoryPage("s1")).toEqual(canonical);
    expect(store.cachedView("s1")).toBe(canonicalView);
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

  it("drops an expanded hot entry before a bounded warm open", () => {
    const store = new ChatTranscriptStore(new MemoryChatHistoryCache());
    store.mergeHistory("s1", page(0, 30, Array.from({ length: 30 }, (_, index) => ({ role: "assistant", content: `expanded ${String(index)}` }))));

    expect(store.boundedCachedView("s1", 25)).toBeUndefined();
    expect(store.rawHistoryPage("s1")).toBeUndefined();
  });

  it("falls back to a bounded persisted preview after dropping expanded hot history", () => {
    const cache = new MemoryChatHistoryCache();
    const preview = page(29, 30, [{ role: "assistant", content: "bounded preview" }]);
    cache.pages.set("s1", preview);
    const store = new ChatTranscriptStore(cache);
    store.mergeHistory("s1", page(0, 30, Array.from({ length: 30 }, (_, index) => ({ role: "assistant", content: `expanded ${String(index)}` }))));

    expect(store.boundedCachedView("s1", 25)).toEqual({
      messages: [textMessage("assistant", "bounded preview")],
      messagePageStart: 29,
      messagePageEnd: 30,
      messagePageTotal: 30,
    });
    expect(cache.removals).toEqual([]);
  });

  it("rejects and removes an oversized persisted cache before normalization", () => {
    const cache = new MemoryChatHistoryCache();
    cache.pages.set("s1", page(0, 30, Array.from({ length: 30 }, (_, index) => ({ role: "assistant", content: `legacy ${String(index)}` }))));
    const store = new ChatTranscriptStore(cache);

    expect(store.boundedCachedView("s1", 25)).toBeUndefined();
    expect(cache.removals).toEqual(["s1"]);
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
