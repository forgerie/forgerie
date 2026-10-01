import { describe, expect, it } from "vitest";
import { createDraftStore, type DraftStorage } from "./draftStore";

/** A real Storage-shaped map. Two stores on one map behave like two tabs, or a page and its reload. */
function memoryStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value); },
    removeItem: (key: string) => { items.delete(key); },
  };
}
/** Storage that a private window or a full quota refuses. */
const blockedStorage: DraftStorage = {
  getItem: () => { throw new DOMException("Blocked", "SecurityError"); },
  setItem: () => { throw new DOMException("Full", "QuotaExceededError"); },
  removeItem: () => { throw new DOMException("Blocked", "SecurityError"); },
};
const answer = { index: 1, drafts: { db: { values: ["pg"], text: "" }, name: { values: [], text: "billing-api" } } };

describe("draft store", () => {
  it("keeps each session's chat draft for the next page load", () => {
    const storage = memoryStorage();
    createDraftStore(storage).session("a").saveChat("unfinished thought");
    const reloaded = createDraftStore(storage);
    expect(reloaded.session("a").chat()).toBe("unfinished thought");
    expect(reloaded.session("b").chat()).toBe("");
  });

  it("leaves nothing behind once the drafts are empty", () => {
    const storage = memoryStorage();
    const drafts = createDraftStore(storage).session("a");
    drafts.saveChat("sent soon");
    drafts.saveAnswers("ask-1", { index: 0, drafts: { db: { values: [], text: "" } } });
    drafts.saveChat("");
    expect(storage.items.size).toBe(0);
  });

  it("returns saved answers only to the ask they belong to", () => {
    const drafts = createDraftStore(memoryStorage()).session("a");
    drafts.saveAnswers("ask-1", answer);
    expect(drafts.answers("ask-1")).toEqual(answer);
    expect(drafts.answers("ask-2")).toBeUndefined();
  });

  it("keeps the chat draft and the answers apart when two pages write one session", () => {
    const storage = memoryStorage();
    createDraftStore(storage).session("a").saveChat("from the first tab");
    createDraftStore(storage).session("a").saveAnswers("ask-1", answer);
    const drafts = createDraftStore(storage).session("a");
    expect(drafts.chat()).toBe("from the first tab");
    expect(drafts.answers("ask-1")).toEqual(answer);
  });

  it("drops the answers of an ask that closed or was replaced, and keeps the chat draft", () => {
    const storage = memoryStorage();
    const drafts = createDraftStore(storage).session("a");
    drafts.saveChat("parked chat");
    drafts.saveAnswers("ask-1", answer);
    drafts.keepAnswers("ask-1");
    expect(drafts.answers("ask-1")).toEqual(answer);
    drafts.keepAnswers("ask-2");
    expect(drafts.answers("ask-1")).toBeUndefined();
    expect(drafts.chat()).toBe("parked chat");
    drafts.saveChat("");
    drafts.keepAnswers(undefined);
    expect(storage.items.size).toBe(0);
  });

  it("reads a malformed record as no draft, and keeps the part that is still valid", () => {
    const storage = memoryStorage();
    const drafts = createDraftStore(storage);
    drafts.session("a").saveChat("x");
    const [key] = storage.items.keys();
    storage.setItem(key!, "{not json");
    expect(drafts.session("a").chat()).toBe("");
    storage.setItem(key!, JSON.stringify({ chat: "still mine", ask: { id: "ask-1", index: -1, drafts: "nope" } }));
    expect(drafts.session("a").chat()).toBe("still mine");
    expect(drafts.session("a").answers("ask-1")).toBeUndefined();
  });

  it("never throws when storage is blocked, full, or missing", () => {
    for (const storage of [blockedStorage, undefined]) {
      const drafts = createDraftStore(storage);
      const session = drafts.session("a");
      expect(() => {
        session.saveChat("typed");
        session.saveAnswers("ask-1", answer);
        session.keepAnswers(undefined);
        drafts.forget("a");
      }).not.toThrow();
      expect(session.chat()).toBe("");
      expect(session.answers("ask-1")).toBeUndefined();
    }
  });

  it("forgets a deleted session and ignores its late writes from this page", () => {
    const storage = memoryStorage();
    const drafts = createDraftStore(storage);
    drafts.session("a").saveChat("about to be deleted");
    drafts.session("b").saveChat("other session");
    drafts.forget("a");
    drafts.session("a").saveChat("written while the view unmounts");
    drafts.session("a").saveAnswers("ask-1", answer);
    expect(createDraftStore(storage).session("a").chat()).toBe("");
    expect(createDraftStore(storage).session("b").chat()).toBe("other session");
  });
});
