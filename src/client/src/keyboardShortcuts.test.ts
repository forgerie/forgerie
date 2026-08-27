import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppAction, KeyboardShortcutContext } from "./actions";
import {
  KeyboardShortcutDispatcher,
  parseShortcutInput,
  resolveShortcutBindings,
  shortcutTokenFromEvent,
  type ShortcutKeyEvent,
} from "./keyboardShortcuts";

afterEach(() => {
  vi.useRealTimers();
});

function keyEvent(key: string, modifiers: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    target: null,
    getModifierState: () => false,
    ...modifiers,
  };
}

function action(shortcut: string, enabled = true, shortcutContexts?: readonly KeyboardShortcutContext[]) {
  return actionWithId(shortcut, shortcut, enabled, shortcutContexts);
}

function actionWithId(id: string, shortcut: string, enabled = true, shortcutContexts?: readonly KeyboardShortcutContext[]) {
  const run = vi.fn();
  const value: AppAction = {
    id,
    title: id,
    shortcut,
    enabled,
    ...(shortcutContexts === undefined ? {} : { shortcutContexts }),
    run,
  };
  return { value, run };
}

describe("KeyboardShortcutDispatcher", () => {
  it("returns an enabled Ctrl shortcut without running the action itself", () => {
    const dispatcher = new KeyboardShortcutDispatcher();
    const { value, run } = action("ctrl+k");

    const decision = dispatcher.decide(keyEvent("k", { ctrlKey: true }), [value]);

    expect(decision).toEqual({ kind: "run", action: value });
    expect(run).not.toHaveBeenCalled();
  });

  it("keeps legacy plugin Mod defaults working as physical Ctrl", () => {
    const dispatcher = new KeyboardShortcutDispatcher();
    const { value } = action("mod+k");

    expect(dispatcher.decide(keyEvent("k", { ctrlKey: true }), [value])).toEqual({ kind: "run", action: value });
  });

  it("rejects every shortcut event that includes Meta", () => {
    const dispatcher = new KeyboardShortcutDispatcher();
    const { value } = action("ctrl+k");

    expect(dispatcher.decide(keyEvent("k", { metaKey: true }), [value])).toEqual({ kind: "defer" });
    expect(dispatcher.decide(keyEvent("k", { ctrlKey: true, metaKey: true }), [value])).toEqual({ kind: "defer" });
  });

  it("consumes key repeat without rerunning a non-repeatable action", () => {
    const dispatcher = new KeyboardShortcutDispatcher();
    const { value } = action("ctrl+space");
    const nonRepeatable = { ...value, repeatable: false };

    expect(dispatcher.decide(keyEvent(" ", { ctrlKey: true }), [nonRepeatable])).toEqual({ kind: "run", action: nonRepeatable });
    expect(dispatcher.decide(keyEvent(" ", { ctrlKey: true, repeat: true }), [nonRepeatable])).toEqual({ kind: "consume" });
  });

  it("does not build the action catalog for ordinary typing", () => {
    const dispatcher = new KeyboardShortcutDispatcher();
    const { value } = action("ctrl+k");
    const actions = vi.fn(() => [value]);

    expect(dispatcher.decide(keyEvent("r"), actions)).toEqual({ kind: "defer" });
    expect(actions).not.toHaveBeenCalled();
    expect(dispatcher.decide(keyEvent("k", { ctrlKey: true }), actions)).toEqual({ kind: "run", action: value });
    expect(actions).toHaveBeenCalledOnce();
  });

  it("ignores plain letters and Shift-only shortcuts", () => {
    const dispatcher = new KeyboardShortcutDispatcher();

    expect(dispatcher.decide(keyEvent("r"), [action("r").value])).toEqual({ kind: "defer" });
    expect(dispatcher.decide(keyEvent("r", { shiftKey: true }), [action("shift+r").value])).toEqual({ kind: "defer" });
  });

  it("ignores disabled matching shortcuts", () => {
    const dispatcher = new KeyboardShortcutDispatcher();
    const { value } = action("ctrl+enter", false);

    expect(dispatcher.decide(keyEvent("Enter", { ctrlKey: true }), [value])).toEqual({ kind: "defer" });
  });

  it("requires every declared modifier", () => {
    const dispatcher = new KeyboardShortcutDispatcher();
    const { value } = action("ctrl+shift+r");

    expect(dispatcher.decide(keyEvent("r", { ctrlKey: true }), [value])).toEqual({ kind: "defer" });
    expect(dispatcher.decide(keyEvent("r", { ctrlKey: true, shiftKey: true }), [value])).toEqual({ kind: "run", action: value });
  });

  it("runs a VS Code-style sequence with a modified second chord", () => {
    const dispatcher = new KeyboardShortcutDispatcher();
    const { value } = action("ctrl+k ctrl+s");

    expect(dispatcher.decide(keyEvent("k", { ctrlKey: true }), [value])).toEqual({ kind: "pending" });
    expect(dispatcher.decide(keyEvent("s", { ctrlKey: true }), [value])).toEqual({ kind: "run", action: value });
  });

  it("applies shortcuts only in their declared keyboard contexts", () => {
    const dispatcher = new KeyboardShortcutDispatcher();
    const workbench = action("ctrl+k").value;
    const composer = actionWithId("composer", "ctrl+enter", true, ["workbench", "composer"]).value;

    expect(dispatcher.decide(keyEvent("k", { ctrlKey: true }), [workbench], { context: "composer" })).toEqual({ kind: "defer" });
    expect(dispatcher.decide(keyEvent("Enter", { ctrlKey: true }), [composer], { context: "composer" })).toEqual({ kind: "run", action: composer });
    expect(dispatcher.decide(keyEvent("Enter", { ctrlKey: true }), [composer], { context: "terminal" })).toEqual({ kind: "defer" });
  });

  it("expires a pending sequence after the chord timeout", () => {
    vi.useFakeTimers();
    const dispatcher = new KeyboardShortcutDispatcher();
    const { value } = action("ctrl+k ctrl+s");

    expect(dispatcher.decide(keyEvent("k", { ctrlKey: true }), [value])).toEqual({ kind: "pending" });
    vi.advanceTimersByTime(1201);
    expect(dispatcher.decide(keyEvent("s", { ctrlKey: true }), [value])).toEqual({ kind: "defer" });
  });

  it("re-evaluates a modified key after an incorrect sequence chord", () => {
    const dispatcher = new KeyboardShortcutDispatcher();
    const sequence = actionWithId("sequence", "ctrl+k ctrl+s");
    const standalone = actionWithId("standalone", "ctrl+p");

    expect(dispatcher.decide(keyEvent("k", { ctrlKey: true }), [sequence.value, standalone.value])).toEqual({ kind: "pending" });
    expect(dispatcher.decide(keyEvent("p", { ctrlKey: true }), [sequence.value, standalone.value])).toEqual({ kind: "run", action: standalone.value });
  });

  it("clears a pending sequence when the app resets keyboard state", () => {
    const dispatcher = new KeyboardShortcutDispatcher();
    const { value } = action("ctrl+k ctrl+s");

    expect(dispatcher.decide(keyEvent("k", { ctrlKey: true }), [value])).toEqual({ kind: "pending" });
    dispatcher.reset();
    expect(dispatcher.decide(keyEvent("s", { ctrlKey: true }), [value])).toEqual({ kind: "defer" });
  });

  it("clears a pending sequence when keyboard ownership changes", () => {
    const dispatcher = new KeyboardShortcutDispatcher();
    const { value } = actionWithId("settings", "ctrl+k ctrl+s", true, ["workbench", "composer"]);

    expect(dispatcher.decide(keyEvent("k", { ctrlKey: true }), [value], { context: "workbench" })).toEqual({ kind: "pending" });
    expect(dispatcher.decide(keyEvent("s", { ctrlKey: true }), [value], { context: "composer" })).toEqual({ kind: "defer" });
  });
});

describe("shortcut conflict resolution", () => {
  it("lets a custom shortcut replace a conflicting default", () => {
    const defaultAction = actionWithId("plugin:a", "ctrl+k");
    const customAction = actionWithId("plugin:z", "ctrl+j");

    const resolutions = resolveShortcutBindings([defaultAction.value, customAction.value], { "plugin:z": "ctrl+k" });
    const defaultResolution = resolutions.find((resolution) => resolution.action.id === "plugin:a");
    const customResolution = resolutions.find((resolution) => resolution.action.id === "plugin:z");

    expect(customResolution?.active).toBe(true);
    expect(customResolution?.shadows.map((binding) => binding.action.id)).toEqual(["plugin:a"]);
    expect(defaultResolution?.active).toBe(false);
    expect(defaultResolution?.shadowedBy?.action.id).toBe("plugin:z");
  });

  it("leaves equal-priority conflicts inactive until the user resolves them", () => {
    const first = actionWithId("plugin:a", "ctrl+k");
    const second = actionWithId("plugin:z", "ctrl+k");

    const resolutions = resolveShortcutBindings([first.value, second.value]);

    expect(resolutions.map((resolution) => resolution.active)).toEqual([false, false]);
    expect(resolutions[0]?.conflicts.map((binding) => binding.action.id)).toEqual(["plugin:z"]);
    expect(resolutions[1]?.conflicts.map((binding) => binding.action.id)).toEqual(["plugin:a"]);
  });

  it("reports when a custom shortcut shadows a default in only one context", () => {
    const wide = actionWithId("plugin:wide", "ctrl+k", true, ["workbench", "terminal"]);
    const custom = actionWithId("plugin:custom", "ctrl+j", true, ["workbench"]);

    const resolutions = resolveShortcutBindings([wide.value, custom.value], { "plugin:custom": "ctrl+k" });
    const wideResolution = resolutions.find((resolution) => resolution.action.id === "plugin:wide");

    expect(wideResolution?.active).toBe(true);
    expect(wideResolution?.partiallyShadowedBy.map((binding) => binding.action.id)).toEqual(["plugin:custom"]);
  });

  it("does not report a conflict for actions that run in disjoint contexts", () => {
    const workbench = actionWithId("plugin:workbench", "ctrl+k", true, ["workbench"]);
    const terminal = actionWithId("plugin:terminal", "ctrl+k", true, ["terminal"]);

    const resolutions = resolveShortcutBindings([workbench.value, terminal.value]);

    expect(resolutions.map((resolution) => resolution.active)).toEqual([true, true]);
    expect(resolutions.flatMap((resolution) => resolution.conflicts)).toEqual([]);
  });

  it("lets a custom sequence replace a conflicting default prefix", () => {
    const standalone = actionWithId("plugin:standalone", "ctrl+k");
    const sequence = actionWithId("plugin:sequence", "ctrl+j");

    const resolutions = resolveShortcutBindings([standalone.value, sequence.value], { "plugin:sequence": "ctrl+k ctrl+s" });
    const standaloneResolution = resolutions.find((resolution) => resolution.action.id === "plugin:standalone");
    const sequenceResolution = resolutions.find((resolution) => resolution.action.id === "plugin:sequence");

    expect(sequenceResolution?.active).toBe(true);
    expect(standaloneResolution?.active).toBe(false);
    expect(standaloneResolution?.shadowedBy?.action.id).toBe("plugin:sequence");
  });
});

describe("shortcut input parsing", () => {
  it("normalizes Ctrl, Alt, and Shift into one canonical grammar", () => {
    expect(parseShortcutInput("Control + Shift + K")).toEqual({ ok: true, shortcut: "ctrl+shift+k", tokens: ["ctrl+shift+k"] });
    expect(parseShortcutInput("ctrl+k ctrl+s")).toEqual({ ok: true, shortcut: "ctrl+k ctrl+s", tokens: ["ctrl+k", "ctrl+s"] });
    expect(parseShortcutInput("ALT + ArrowDown")).toEqual({ ok: true, shortcut: "alt+arrowdown", tokens: ["alt+arrowdown"] });
  });

  it.each(["mod+k", "meta+k", "cmd+k", "command+k", "primary+k", "gui+k", "option+k"])("rejects unsupported modifier syntax: %s", (shortcut) => {
    expect(parseShortcutInput(shortcut)).toEqual({ ok: false, message: "Only Ctrl, Alt, and Shift modifiers are supported." });
  });

  it("rejects shortcuts that would capture normal typing", () => {
    expect(parseShortcutInput("r")).toEqual({ ok: false, message: "Shortcuts must start with Ctrl or Alt." });
    expect(parseShortcutInput("shift+r")).toEqual({ ok: false, message: "Shortcuts must start with Ctrl or Alt." });
  });

  it("builds canonical tokens from recorded key events", () => {
    expect(shortcutTokenFromEvent(keyEvent("K", { ctrlKey: true, shiftKey: true }))).toBe("ctrl+shift+k");
    expect(shortcutTokenFromEvent(keyEvent("ArrowDown", { altKey: true }))).toBe("alt+arrowdown");
    expect(shortcutTokenFromEvent(keyEvent("K", { metaKey: true }))).toBeUndefined();
  });

  it("ignores AltGraph so international text input is never treated as Ctrl+Alt", () => {
    expect(shortcutTokenFromEvent(keyEvent("@", {
      ctrlKey: true,
      altKey: true,
      getModifierState: (modifier) => modifier === "AltGraph",
    }))).toBeUndefined();
  });
});
