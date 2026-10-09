import { describe, expect, it } from "vitest";
import { isShortcutSequenceStarter, parseStoredShortcutValue } from "./shortcutSyntax.js";

describe("stored shortcut values", () => {
  it("keeps null as no shortcut and refuses other non-strings", () => {
    expect(parseStoredShortcutValue(null)).toEqual({ ok: true, value: null });
    expect(parseStoredShortcutValue("")).toMatchObject({ ok: false });
    expect(parseStoredShortcutValue(3)).toMatchObject({ ok: false });
  });

  it("normalizes modifier order, aliases, and legacy Mod to Ctrl", () => {
    expect(parseStoredShortcutValue("Shift + Control + K")).toEqual({ ok: true, value: "ctrl+shift+k" });
    expect(parseStoredShortcutValue("mod+enter")).toEqual({ ok: true, value: "ctrl+enter" });
    expect(parseStoredShortcutValue("alt+esc ctrl+up")).toEqual({ ok: true, value: "alt+escape ctrl+arrowup" });
    expect(parseStoredShortcutValue("ctrl+f12")).toEqual({ ok: true, value: "ctrl+f12" });
    expect(parseStoredShortcutValue("ctrl+space")).toEqual({ ok: true, value: "ctrl+space" });
  });

  it("refuses shortcuts a browser cannot deliver or a reader cannot type", () => {
    expect(parseStoredShortcutValue("k")).toEqual({ ok: false, message: "Shortcuts must start with Ctrl or Alt." });
    expect(parseStoredShortcutValue("cmd+k")).toEqual({ ok: false, message: "Only Ctrl, Alt, and Shift modifiers are supported." });
    expect(JSON.stringify(parseStoredShortcutValue("ctrl+ctrl+k"))).toContain("duplicate");
    expect(parseStoredShortcutValue("ctrl+k+j")).toEqual({ ok: false, message: "Each shortcut chord can include only one non-modifier key." });
    expect(parseStoredShortcutValue("ctrl+shift")).toEqual({ ok: false, message: "Shortcut chords must include a key." });
    expect(parseStoredShortcutValue("ctrl+banana")).toEqual({ ok: false, message: "Unsupported shortcut key: banana" });
    expect(parseStoredShortcutValue("   ")).toMatchObject({ ok: false });
  });

  it("starts a sequence only with Ctrl or Alt", () => {
    expect(isShortcutSequenceStarter("ctrl+k")).toBe(true);
    expect(isShortcutSequenceStarter("alt+x")).toBe(true);
    expect(isShortcutSequenceStarter("shift+k")).toBe(false);
  });
});
