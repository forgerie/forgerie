// @vitest-environment happy-dom

import { EditorSelection } from "@codemirror/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import type { AutocompleteMenu } from "./AutocompleteMenu";
import { pressKey } from "./modalSurfaceTestSupport";
import { PromptEditor } from "./PromptEditor";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("PromptEditor prompt history", () => {
  it("browses session prompts and restores the unsent draft", async () => {
    const editor = await mountEditor(["most recent", "older"]);
    editor.replaceText("unfinished");
    editor.view?.dispatch({ selection: EditorSelection.cursor(0) });

    press(editor, "ArrowUp");
    expect(editor.view?.state.doc.toString()).toBe("most recent");
    expect(editor.view?.state.selection.main.head).toBe(0);

    press(editor, "ArrowUp");
    expect(editor.view?.state.doc.toString()).toBe("older");

    press(editor, "ArrowDown");
    expect(editor.view?.state.doc.toString()).toBe("most recent");
    expect(editor.view?.state.selection.main.head).toBe("most recent".length);

    press(editor, "ArrowDown");
    expect(editor.view?.state.doc.toString()).toBe("unfinished");
    expect(editor.view?.state.selection.main.head).toBe(0);
  });

  it("keeps autocomplete arrow navigation ahead of prompt history", async () => {
    vi.spyOn(api, "commands").mockResolvedValue([
      { name: "one", source: "extension" },
      { name: "two", source: "extension" },
    ]);
    const editor = await mountEditor(["previous"]);
    editor.view?.dispatch({ changes: { from: 0, insert: "/" }, selection: EditorSelection.cursor(1) });
    const menu = editor.shadowRoot?.querySelector<AutocompleteMenu>("autocomplete-menu");
    if (menu === null || menu === undefined) throw new Error("Expected the autocomplete menu");
    await vi.waitFor(() => { expect(menu.items).toHaveLength(2); });

    press(editor, "ArrowUp");
    await editor.updateComplete;
    await menu.updateComplete;

    expect(menu.shadowRoot?.querySelector("button.selected strong")?.textContent).toBe("/two");
    expect(editor.view?.state.doc.toString()).toBe("/");
  });

  it("adds a sent prompt to history immediately", async () => {
    const editor = await mountEditor([]);
    const onSend = vi.fn<NonNullable<PromptEditor["onSend"]>>();
    editor.onSend = onSend;
    editor.replaceText("send this");

    const send = editor.shadowRoot?.querySelector<HTMLButtonElement>(".send-button");
    if (send === null || send === undefined) throw new Error("Expected the prompt send button");
    send.click();

    expect(onSend).toHaveBeenCalledWith("send this", undefined, undefined, undefined);
    expect(editor.view?.state.doc.toString()).toBe("");
    press(editor, "ArrowUp");
    expect(editor.view?.state.doc.toString()).toBe("send this");
  });

  it("moves through a multiline history entry before leaving it", async () => {
    const editor = await mountEditor(["first line\nsecond line"]);

    press(editor, "ArrowUp");
    press(editor, "ArrowDown");

    expect(editor.view?.state.doc.toString()).toBe("first line\nsecond line");
    expect(editor.view?.state.selection.main.head).toBeGreaterThan("first line".length);
  });

  it("leaves multiline cursor movement to CodeMirror away from a history boundary", async () => {
    const editor = await mountEditor(["previous"]);
    editor.replaceText("first\nsecond");

    press(editor, "ArrowUp");

    expect(editor.view?.state.doc.toString()).toBe("first\nsecond");
  });
});

async function mountEditor(history: readonly string[]): Promise<PromptEditor> {
  const editor = new PromptEditor();
  editor.sessionId = "session-1";
  editor.cwd = "/repo";
  editor.promptHistory = history;
  document.body.append(editor);
  await editor.updateComplete;
  if (editor.view === undefined) throw new Error("Expected CodeMirror to mount");
  return editor;
}

function press(editor: PromptEditor, key: "ArrowUp" | "ArrowDown"): void {
  const view = editor.view;
  if (view === undefined) throw new Error("Expected CodeMirror to mount");
  pressKey(view.contentDOM, key);
}
