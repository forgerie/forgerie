import { describe, expect, it } from "vitest";
import type { AppAction } from "./actions";
import { applyActiveShortcutPreferences, applyShortcutPreferences } from "./shortcutPreferences";

const noop = () => undefined;

describe("shortcut preferences", () => {
  it("keeps default shortcuts when there is no matching preference", () => {
    const actions = [action({ id: "core:view.chat", shortcut: "ctrl+1" })];

    expect(applyShortcutPreferences(actions, { "core:view.files": "ctrl+2" })).toEqual(actions);
  });

  it("overrides action shortcuts by action id", () => {
    expect(applyShortcutPreferences([
      action({ id: "core:view.chat", shortcut: "ctrl+1" }),
    ], { "core:view.chat": "ctrl+shift+1" })).toEqual([
      action({ id: "core:view.chat", shortcut: "ctrl+shift+1" }),
    ]);
  });

  it("removes shortcuts with null preferences", () => {
    expect(applyShortcutPreferences([
      action({ id: "core:view.chat", shortcut: "ctrl+1" }),
    ], { "core:view.chat": null })).toEqual([
      action({ id: "core:view.chat" }),
    ]);
  });

  it("hides every equal-priority conflict until it is resolved", () => {
    expect(applyActiveShortcutPreferences([
      action({ id: "core:z", title: "Later", shortcut: "ctrl+k" }),
      action({ id: "core:a", title: "Earlier", shortcut: "ctrl+k" }),
    ], undefined)).toEqual([
      action({ id: "core:z", title: "Later" }),
      action({ id: "core:a", title: "Earlier" }),
    ]);
  });

  it("hides labels that are shadowed in any declared context", () => {
    expect(applyActiveShortcutPreferences([
      action({ id: "core:wide", title: "Wide", shortcut: "ctrl+k", shortcutContexts: ["workbench", "terminal"] }),
      action({ id: "core:custom", title: "Custom", shortcut: "ctrl+j", shortcutContexts: ["workbench"] }),
    ], { "core:custom": "ctrl+k" })).toEqual([
      action({ id: "core:wide", title: "Wide", shortcutContexts: ["workbench", "terminal"] }),
      action({ id: "core:custom", title: "Custom", shortcut: "ctrl+k", shortcutContexts: ["workbench"] }),
    ]);
  });

  it("hides default shortcut labels shadowed by user-defined shortcuts", () => {
    expect(applyActiveShortcutPreferences([
      action({ id: "core:a", title: "Default", shortcut: "ctrl+1" }),
      action({ id: "core:z", title: "Custom", shortcut: "ctrl+2" }),
    ], { "core:z": "ctrl+1" })).toEqual([
      action({ id: "core:a", title: "Default" }),
      action({ id: "core:z", title: "Custom", shortcut: "ctrl+1" }),
    ]);
  });
});

function action(patch: Partial<AppAction>): AppAction {
  return { id: "action", title: "Action", run: noop, ...patch };
}
