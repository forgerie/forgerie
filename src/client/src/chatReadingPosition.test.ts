import { describe, expect, it } from "vitest";
import {
  SessionStorageChatReadingPositionStore,
  chatLineReadingAnchorToken,
  chatReadingPositionStorageKey,
  findVisibleReadingAnchor,
  type ChatReadingAnchor,
  type ChatReadingPositionStorage,
  type ChatReadingViewport,
} from "./chatReadingPosition";
import { normalizeMessage, normalizeMessages } from "./chatMessages";

class MemoryStorage implements ChatReadingPositionStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const identity = { machineId: "local", cwd: "/repo", sessionId: "session-1" };

function viewport(overrides: Partial<ChatReadingViewport> = {}): ChatReadingViewport {
  return {
    scrollTop: 300,
    scrollHeight: 1_200,
    clientHeight: 400,
    getBoundingClientRect: () => rect(100, 500),
    ...overrides,
  };
}

function anchor(id: string, top: number, bottom: number, aliases: string[] = []): ChatReadingAnchor {
  return {
    dataset: { scrollAnchorId: id, ...(aliases.length === 0 ? {} : { scrollAnchorAliases: JSON.stringify(aliases) }) },
    getBoundingClientRect: () => rect(top, bottom),
  };
}

describe("SessionStorageChatReadingPositionStore", () => {
  it("keeps session identities separate by machine and cwd", () => {
    expect(chatReadingPositionStorageKey(identity)).not.toBe(chatReadingPositionStorageKey({ ...identity, machineId: "remote" }));
    expect(chatReadingPositionStorageKey(identity)).not.toBe(chatReadingPositionStorageKey({ ...identity, cwd: "/other" }));
  });

  it("remembers and restores the visible anchor nearest the viewport top", () => {
    const storage = new MemoryStorage();
    const store = new SessionStorageChatReadingPositionStore(storage);
    const chat = viewport();
    const anchors = [anchor("above", 60, 130), anchor("below", 160, 240)];

    expect(store.remember(identity, chat, anchors)).toBe("saved");
    expect(store.read(identity)).toEqual({ kind: "anchor", anchorId: "above", offset: -40 });

    chat.scrollTop = 0;
    const position = store.read(identity);
    if (position === undefined) throw new Error("Expected a stored reading position");
    const restored = anchor("above", 260, 330);
    expect(store.restore(position, chat, [restored], { fallbackToBottom: false })).toEqual({ status: "restored" });
    expect(chat.scrollTop).toBe(200);
  });

  it("clears an older anchor when the reader leaves at the tail", () => {
    const storage = new MemoryStorage();
    const store = new SessionStorageChatReadingPositionStore(storage);
    const key = chatReadingPositionStorageKey(identity);
    storage.setItem(key, JSON.stringify({ kind: "anchor", anchorId: "m:1", offset: 20 }));

    expect(store.remember(identity, viewport({ scrollTop: 800 }), [])).toBe("saved");
    expect(storage.getItem(key)).toBeNull();
  });

  it("reports a missing anchor while earlier history can still load", () => {
    const store = new SessionStorageChatReadingPositionStore(new MemoryStorage());
    const position = { kind: "anchor" as const, anchorId: "m:1", offset: 20 };

    expect(store.restore(position, viewport(), [], { fallbackToBottom: false })).toEqual({ status: "missing", position });
  });

  it("restores a turn through an alias retained after its opener loads", () => {
    const store = new SessionStorageChatReadingPositionStore(new MemoryStorage());
    const chat = viewport({ scrollTop: 0 });
    const position = { kind: "anchor" as const, anchorId: "turn:old-tail", offset: 20 };

    expect(store.restore(position, chat, [anchor("turn:user-opener", 260, 340, ["turn:old-tail"])], { fallbackToBottom: false })).toEqual({ status: "restored" });
    expect(chat.scrollTop).toBe(140);
  });

  it("matches a live bash anchor to the latest hydrated command", () => {
    const store = new SessionStorageChatReadingPositionStore(new MemoryStorage());
    const chat = viewport({ scrollTop: 0 });
    const position = { kind: "anchor" as const, anchorId: "turn:bash:command", offset: 20 };

    expect(store.restore(position, chat, [
      anchor("turn:bash:command:older", 180, 240),
      anchor("turn:bash:command:newer", 320, 380),
    ], { fallbackToBottom: false })).toEqual({ status: "restored" });
    expect(chat.scrollTop).toBe(200);
  });

  it("falls back to the tail after all history is loaded", () => {
    const store = new SessionStorageChatReadingPositionStore(new MemoryStorage());
    const chat = viewport({ scrollTop: 0 });

    expect(store.restore({ kind: "anchor", anchorId: "gone", offset: 20 }, chat, [])).toEqual({ status: "bottom" });
    expect(chat.scrollTop).toBe(1_200);
  });
});

describe("chatLineReadingAnchorToken", () => {
  it("matches an isolated tool result to its later merged execution", () => {
    const [isolated] = normalizeMessage({ role: "toolResult", toolCallId: "read-1", toolName: "read", content: [{ type: "text", text: "ok" }], isError: false });
    const [merged] = normalizeMessages([
      { role: "assistant", content: [{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "src/app.ts" } }] },
      { role: "toolResult", toolCallId: "read-1", toolName: "read", content: [{ type: "text", text: "ok" }], isError: false },
    ], 4);
    if (isolated === undefined || merged === undefined) throw new Error("Expected tool lines");

    expect(chatLineReadingAnchorToken(isolated)).toBe("tool:read-1");
    expect(chatLineReadingAnchorToken(merged)).toBe("tool:read-1");
  });

  it("matches a live user line to its history-backed form", () => {
    const raw = { role: "user", content: "same prompt", timestamp: "2026-08-24T12:00:00.000Z" };
    const [live] = normalizeMessage(raw);
    const [hydrated] = normalizeMessages([raw], 14);
    if (live === undefined || hydrated === undefined) throw new Error("Expected user lines");

    expect(chatLineReadingAnchorToken(live)).toBe(chatLineReadingAnchorToken(hydrated));
  });

  it("leaves mutable live assistant prose to its stable turn anchor", () => {
    expect(chatLineReadingAnchorToken({ role: "assistant", parts: [{ type: "text", text: "still streaming" }] })).toBeUndefined();
  });

  it("uses timestamped command identity without colliding excluded commands", () => {
    const firstLine = normalizeMessage({ role: "bashExecution", command: "npm test", excludeFromContext: true })[0];
    const secondLine = normalizeMessage({ role: "bashExecution", command: "npm run verify", excludeFromContext: true })[0];
    if (firstLine === undefined || secondLine === undefined) throw new Error("Expected bash lines");
    const first = { ...firstLine, meta: { timestamp: "2026-08-24T12:00:00.000Z" } };
    const second = { ...secondLine, meta: { timestamp: "2026-08-24T12:00:00.000Z" } };

    expect(chatLineReadingAnchorToken(first)).not.toBe(chatLineReadingAnchorToken(second));
    expect(chatLineReadingAnchorToken({ role: "bash", parts: [{ type: "text", text: "$ npm test" }] })).toMatch(/^bash:/);
  });
});

describe("findVisibleReadingAnchor", () => {
  it("prefers the nearest visible anchor at or above the viewport top", () => {
    expect(findVisibleReadingAnchor(viewport(), [
      anchor("far-above", 20, 130),
      anchor("nearest-above", 70, 150),
      anchor("below", 120, 180),
    ])?.dataset.scrollAnchorId).toBe("nearest-above");
  });
});

function rect(top: number, bottom: number): Pick<DOMRectReadOnly, "top" | "bottom"> {
  return { top, bottom };
}
