import { describe, expect, it, vi } from "vitest";
import type { AppAction } from "../../actions";
import {
  appendRecordedToken,
  closeShortcutEditor,
  deriveShortcutSettingsList,
  openShortcutMenu,
  rowEditorFor,
  shortcutBindingShortcut,
  startRecording,
  startTyping,
  type ShortcutEditor,
} from "./shortcutSettingsList";

describe("deriveShortcutSettingsList binding state", () => {
  it("tags every action with exactly one binding state", () => {
    const list = deriveShortcutSettingsList({
      actions: [
        action({ id: "a.default", title: "Bravo", shortcut: "ctrl+k" }),
        action({ id: "a.custom", title: "Alpha", shortcut: "ctrl+k" }),
        action({ id: "a.disabled", title: "Charlie", shortcut: "ctrl+j" }),
        action({ id: "a.unassigned", title: "Delta" }),
      ],
      shortcuts: { "a.custom": "ctrl+shift+p", "a.disabled": null },
    });

    // Rows sort by title within a group, so Alpha leads regardless of input order.
    expect(rowStates(list)).toEqual([
      ["a.custom", "custom", "ctrl+shift+p"],
      ["a.default", "default", "ctrl+k"],
      ["a.disabled", "disabled", ""],
      ["a.unassigned", "unassigned", ""],
    ]);
  });

  it("counts overrides rather than bindings", () => {
    const list = deriveShortcutSettingsList({
      actions: [action({ id: "a.one", shortcut: "ctrl+k" }), action({ id: "a.two", shortcut: "ctrl+j" })],
      shortcuts: { "a.two": null },
    });

    expect(list.total).toBe(2);
    expect(list.shown).toBe(2);
    expect(list.customCount).toBe(1);
  });
});

describe("deriveShortcutSettingsList conflicts", () => {
  it("marks the losing binding shadowed and names the winner", () => {
    const list = deriveShortcutSettingsList({
      actions: [
        action({ id: "a.loser", title: "Older Action", shortcut: "ctrl+k" }),
        action({ id: "a.winner", title: "Newer Action" }),
      ],
      shortcuts: { "a.winner": "ctrl+k" },
    });

    const byId = rowsById(list);
    expect(byId.get("a.loser")?.conflict).toEqual({ kind: "shadowed", winner: "Newer Action" });
    expect(byId.get("a.winner")?.conflict).toEqual({ kind: "shadows", victims: ["Older Action"] });
  });

  it("marks both equal-priority bindings as unresolved conflicts", () => {
    const list = deriveShortcutSettingsList({
      actions: [
        action({ id: "a.first", title: "First", shortcut: "ctrl+k" }),
        action({ id: "a.second", title: "Second", shortcut: "ctrl+k" }),
      ],
      shortcuts: {},
    });

    const byId = rowsById(list);
    expect(byId.get("a.first")?.conflict).toEqual({ kind: "conflict", peers: ["Second"] });
    expect(byId.get("a.second")?.conflict).toEqual({ kind: "conflict", peers: ["First"] });
  });

  it("distinguishes a conflict that leaves one action active in another context", () => {
    const list = deriveShortcutSettingsList({
      actions: [
        action({ id: "a.wide", title: "Wide", shortcut: "ctrl+k", shortcutContexts: ["workbench", "terminal"] }),
        action({ id: "a.workbench", title: "Workbench", shortcut: "ctrl+k", shortcutContexts: ["workbench"] }),
      ],
      shortcuts: {},
    });

    const byId = rowsById(list);
    expect(byId.get("a.wide")?.conflict).toEqual({ kind: "partial-conflict", peers: ["Workbench"] });
    expect(byId.get("a.workbench")?.conflict).toEqual({ kind: "conflict", peers: ["Wide"] });
  });

  it("reports a default shadowed by a custom binding in only one context", () => {
    const list = deriveShortcutSettingsList({
      actions: [
        action({ id: "a.wide", title: "Wide", shortcut: "ctrl+k", shortcutContexts: ["workbench", "terminal"] }),
        action({ id: "a.custom", title: "Custom", shortcut: "ctrl+j", shortcutContexts: ["workbench"] }),
      ],
      shortcuts: { "a.custom": "ctrl+k" },
    });

    expect(rowsById(list).get("a.wide")?.conflict).toEqual({ kind: "partial-shadowed", winners: ["Custom"] });
  });

  it("leaves non-colliding bindings clear", () => {
    const list = deriveShortcutSettingsList({
      actions: [action({ id: "a.one", shortcut: "ctrl+k" }), action({ id: "a.two", shortcut: "ctrl+j" })],
      shortcuts: {},
    });

    expect([...rowsById(list).values()].map((row) => row.conflict.kind)).toEqual(["clear", "clear"]);
  });
});

describe("deriveShortcutSettingsList filtering and grouping", () => {
  it("matches title, action id, group, and the rendered shortcut", () => {
    const actions = [
      action({ id: "core:prompt.focus", title: "Focus Prompt", shortcut: "ctrl+g c", group: "General" }),
      action({ id: "core:view.chat", title: "Go to Chat", shortcut: "ctrl+1", group: "Navigation" }),
    ];

    expect(shownIds(actions, "focus prompt")).toEqual(["core:prompt.focus"]);
    expect(shownIds(actions, "view.chat")).toEqual(["core:view.chat"]);
    expect(shownIds(actions, "navigation")).toEqual(["core:view.chat"]);
    expect(shownIds(actions, "ctrl+g")).toEqual(["core:prompt.focus"]);
    expect(shownIds(actions, "")).toEqual(["core:prompt.focus", "core:view.chat"]);
  });

  it("drops groups that no longer have matching rows", () => {
    const list = deriveShortcutSettingsList({
      actions: [
        action({ id: "a.one", title: "Focus Prompt", group: "General" }),
        action({ id: "a.two", title: "Go to Chat", group: "Navigation" }),
      ],
      shortcuts: {},
      filter: "focus",
    });

    expect(list.groups.map((group) => group.name)).toEqual(["General"]);
    expect(list.shown).toBe(1);
    expect(list.total).toBe(2);
  });

  it("orders groups by the curated order, then unknown groups alphabetically", () => {
    const list = deriveShortcutSettingsList({
      actions: [
        action({ id: "a.z", group: "Zebra" }),
        action({ id: "a.view", group: "View" }),
        action({ id: "a.general", group: "General" }),
        action({ id: "a.nav", group: "Navigation" }),
        action({ id: "a.a", group: "Aardvark" }),
      ],
      shortcuts: {},
    });

    expect(list.groups.map((group) => group.name)).toEqual(["General", "Navigation", "View", "Aardvark", "Zebra"]);
  });
});

describe("shortcut editor transitions", () => {
  it("moves between closed, menu, recording, and typing for one action at a time", () => {
    const closed: ShortcutEditor = { kind: "closed" };

    const menu = openShortcutMenu(closed, "a.one");
    expect(menu).toEqual({ kind: "menu", actionId: "a.one" });

    const recording = startRecording(menu, "a.one");
    expect(recording).toEqual({ kind: "recording", actionId: "a.one", tokens: [] });

    const typing = startTyping("a.one", "ctrl+k");
    expect(typing).toEqual({ kind: "typing", actionId: "a.one", draft: "ctrl+k" });

    expect(closeShortcutEditor()).toEqual({ kind: "closed" });
  });

  it("closes the menu when the same action is tapped again", () => {
    expect(openShortcutMenu({ kind: "menu", actionId: "a.one" }, "a.one")).toEqual({ kind: "closed" });
    expect(openShortcutMenu({ kind: "menu", actionId: "a.one" }, "a.two")).toEqual({ kind: "menu", actionId: "a.two" });
  });

  it("accumulates recorded tokens into a sequence", () => {
    const first = appendRecordedToken({ kind: "recording", actionId: "a.one", tokens: [] }, "ctrl+g");
    expect(first).toEqual({ kind: "recording", actionId: "a.one", tokens: ["ctrl+g"] });
    expect(appendRecordedToken(first, "p")).toEqual({ kind: "recording", actionId: "a.one", tokens: ["ctrl+g", "p"] });
  });

  it("ignores recorded tokens when no row is recording", () => {
    const menu: ShortcutEditor = { kind: "menu", actionId: "a.one" };
    expect(appendRecordedToken(menu, "ctrl+k")).toBe(menu);
  });

  it("reports the editor state for one row and closed for every other row", () => {
    const editor: ShortcutEditor = { kind: "recording", actionId: "a.one", tokens: ["ctrl+g"] };
    expect(rowEditorFor(editor, "a.one")).toEqual(editor);
    expect(rowEditorFor(editor, "a.two")).toEqual({ kind: "closed" });
  });
});

describe("deriveShortcutSettingsList editor preview", () => {
  it("previews the recording in progress on the recording row only", () => {
    const list = deriveShortcutSettingsList({
      actions: [action({ id: "a.one", shortcut: "ctrl+k" }), action({ id: "a.two", shortcut: "ctrl+j" })],
      shortcuts: {},
      editor: { kind: "recording", actionId: "a.one", tokens: ["ctrl+g", "p"] },
    });

    const byId = rowsById(list);
    expect(byId.get("a.one")?.display).toBe("Ctrl+G P");
    expect(byId.get("a.one")?.dirty).toBe(true);
    expect(byId.get("a.two")?.display).toBe("Ctrl+J");
    expect(byId.get("a.two")?.dirty).toBe(false);
  });

  it("previews a typed draft and reports it clean when it matches the saved binding", () => {
    const rows = (draft: string) => rowsById(deriveShortcutSettingsList({
      actions: [action({ id: "a.one", shortcut: "ctrl+k" })],
      shortcuts: {},
      editor: { kind: "typing", actionId: "a.one", draft },
    }));

    expect(rows("ctrl+j").get("a.one")?.dirty).toBe(true);
    expect(rows("ctrl+k").get("a.one")?.dirty).toBe(false);
  });

  it("keeps an unparseable draft off the preview instead of blanking the row", () => {
    const list = deriveShortcutSettingsList({
      actions: [action({ id: "a.one", shortcut: "ctrl+k" })],
      shortcuts: {},
      editor: { kind: "typing", actionId: "a.one", draft: "ctrl+" },
    });

    expect(rowsById(list).get("a.one")?.display).toBe("Ctrl+K");
  });
});

function action(overrides: Partial<AppAction> & { id: string }): AppAction {
  return {
    title: "Action",
    group: "General",
    run: vi.fn(),
    ...overrides,
  };
}

function rowStates(list: ReturnType<typeof deriveShortcutSettingsList>): [string, string, string][] {
  return list.groups
    .flatMap((group) => group.rows)
    .map((row) => [row.action.id, row.state.kind, shortcutBindingShortcut(row.state)]);
}

function rowsById(list: ReturnType<typeof deriveShortcutSettingsList>) {
  return new Map(list.groups.flatMap((group) => group.rows).map((row) => [row.action.id, row]));
}

function shownIds(actions: AppAction[], filter: string): string[] {
  return deriveShortcutSettingsList({ actions, shortcuts: {}, filter })
    .groups.flatMap((group) => group.rows.map((row) => row.action.id));
}
