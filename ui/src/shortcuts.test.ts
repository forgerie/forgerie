// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { searchShortcut } from "./shortcuts";

const press = (key: string, extra: Partial<KeyboardEvent> = {}, target: EventTarget | null = document.body) =>
  searchShortcut({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, target, ...extra });

describe("search shortcut", () => {
  it("takes Ctrl+K and Cmd+K from anywhere, a text field included", () => {
    const field = document.createElement("textarea");
    expect(press("k", { ctrlKey: true })).toBe(true);
    expect(press("K", { metaKey: true })).toBe(true);
    expect(press("k", { ctrlKey: true }, field)).toBe(true);
    // Ctrl+Shift+K deletes a line in the editor; Ctrl+Alt+K is not ours either.
    expect(press("K", { ctrlKey: true, shiftKey: true })).toBe(false);
    expect(press("k", { ctrlKey: true, altKey: true })).toBe(false);
    expect(press("k", { ctrlKey: true, isComposing: true })).toBe(false);
  });

  it("takes / only outside a text field", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    expect(press("/")).toBe(true);
    expect(press("/", {}, document.createElement("input"))).toBe(false);
    expect(press("/", {}, editor)).toBe(false);
    expect(press("/", { ctrlKey: true })).toBe(false);
  });
});
