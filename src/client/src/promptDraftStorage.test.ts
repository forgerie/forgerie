// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { clearDraft, loadDraft, moveDraft, saveDraft } from "./promptDraftStorage";

describe("prompt draft storage", () => {
  it("saves, loads, removes, and clears drafts", () => {
    const storage = memoryStorage();

    saveDraft("one", "draft", storage);
    expect(loadDraft("one", storage)).toBe("draft");

    saveDraft("one", "", storage);
    expect(loadDraft("one", storage)).toBe("");

    saveDraft("one", "again", storage);
    clearDraft("one", storage);
    expect(loadDraft("one", storage)).toBe("");
  });

  it("moves a non-empty draft between sessions", () => {
    const storage = memoryStorage();
    saveDraft("from", "message", storage);

    moveDraft("from", "to", storage);

    expect(loadDraft("from", storage)).toBe("");
    expect(loadDraft("to", storage)).toBe("message");
  });

  it("does not create a destination for an empty draft", () => {
    const storage = memoryStorage();

    moveDraft("missing", "to", storage);

    expect(loadDraft("to", storage)).toBe("");
  });

  it("ignores blocked browser storage access", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => { throw new Error("blocked"); } });
    try {
      expect(loadDraft("one")).toBe("");
      expect(() => { saveDraft("one", "draft"); }).not.toThrow();
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, "localStorage");
      else Object.defineProperty(globalThis, "localStorage", descriptor);
    }
  });

  it("ignores unavailable and failing storage", () => {
    const failing = failingStorage();

    expect(loadDraft("one", undefined)).toBe("");
    expect(loadDraft("one", failing)).toBe("");
    expect(() => { saveDraft("one", "draft", failing); }).not.toThrow();
    expect(() => { clearDraft("one", failing); }).not.toThrow();
  });
});

function failingStorage(): Storage {
  return {
    length: 0,
    clear: () => { throw new Error("blocked"); },
    getItem: () => { throw new Error("blocked"); },
    key: () => { throw new Error("blocked"); },
    removeItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("blocked"); },
  };
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => { values.clear(); },
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}
