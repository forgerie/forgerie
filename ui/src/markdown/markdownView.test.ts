// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { markdownView } from "./markdownView";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("device Markdown view preference", () => {
  test("defaults to Rich, including an invalid stored value", () => {
    expect(markdownView.read()).toBe("rich");
    localStorage.setItem("forgerie.markdownView", "invalid");
    expect(markdownView.read()).toBe("rich");
  });
  test("writes and reads the shared device choice", () => {
    markdownView.write("source");
    expect(localStorage.getItem("forgerie.markdownView")).toBe("source");
    expect(markdownView.read()).toBe("source");
    markdownView.write("rich");
    expect(markdownView.read()).toBe("rich");
  });
  test("works without storage", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(markdownView.read()).toBe("rich");
    expect(() => markdownView.write("source")).not.toThrow();
  });
  test("survives denied reads and full storage", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("Storage denied"); },
      setItem: () => { throw new Error("Storage full"); },
    });
    expect(markdownView.read()).toBe("rich");
    expect(() => markdownView.write("source")).not.toThrow();
  });
  test("survives a denied storage getter", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => { throw new Error("Storage denied"); } });
    try {
      expect(markdownView.read()).toBe("rich");
      expect(() => markdownView.write("source")).not.toThrow();
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
  });
});
