// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { loadAttachmentDelivery, saveAttachmentDelivery } from "./attachmentPreferences";

describe("attachment delivery preferences", () => {
  it("loads only the supported folder value", () => {
    expect(loadAttachmentDelivery(storageWith("folder"))).toBe("folder");
    expect(loadAttachmentDelivery(storageWith("inline"))).toBe("inline");
    expect(loadAttachmentDelivery(storageWith("unknown"))).toBe("inline");
    expect(loadAttachmentDelivery(undefined)).toBe("inline");
  });

  it("saves the selected mode", () => {
    const storage = storageWith(null);
    const setItem = vi.spyOn(storage, "setItem");

    saveAttachmentDelivery("folder", storage);

    expect(setItem).toHaveBeenCalledWith("pi-web:attachment-delivery", "folder");
  });

  it("falls back safely when browser storage access throws", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => { throw new Error("blocked"); } });
    try {
      expect(loadAttachmentDelivery()).toBe("inline");
      expect(() => { saveAttachmentDelivery("folder"); }).not.toThrow();
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, "localStorage");
      else Object.defineProperty(globalThis, "localStorage", descriptor);
    }
  });

  it("falls back safely when storage throws", () => {
    const failing = failingStorage();

    expect(loadAttachmentDelivery(failing)).toBe("inline");
    expect(() => { saveAttachmentDelivery("inline", failing); }).not.toThrow();
  });
});

function failingStorage(): Storage {
  return {
    length: 0,
    clear: () => { throw new Error("blocked"); },
    getItem: () => { throw new Error("blocked"); },
    key: () => { throw new Error("blocked"); },
    removeItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("full"); },
  };
}

function storageWith(value: string | null): Storage {
  return {
    length: value === null ? 0 : 1,
    clear: () => undefined,
    getItem: () => value,
    key: () => null,
    removeItem: () => undefined,
    setItem: () => undefined,
  };
}
