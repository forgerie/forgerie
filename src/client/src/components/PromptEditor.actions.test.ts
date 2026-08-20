// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import type { AutocompleteMenu } from "./AutocompleteMenu";
import { PromptEditor } from "./PromptEditor";
import { sessionCapabilities } from "./promptEditorTestSupport";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("PromptEditor composer actions", () => {
  it("opens attachments directly from the composer", async () => {
    const editor = await renderPromptEditor();
    const input = required(editor.shadowRoot?.querySelector<HTMLInputElement>(".attachment-input"), "attachment input");
    const inputClick = vi.spyOn(input, "click");

    button(editor, ".composer-attach").click();

    expect(inputClick).toHaveBeenCalledOnce();
  });

  it("keeps archive directly available wherever the composer fits", async () => {
    const onArchiveAndNext = vi.fn();
    const editor = await renderPromptEditor({ onArchiveAndNext });

    button(editor, ".composer-archive").click();

    expect(onArchiveAndNext).toHaveBeenCalledOnce();
  });

  it("does not offer archive when the current session cannot be archived", async () => {
    const editor = await renderPromptEditor();

    expect(editor.shadowRoot?.querySelector(".composer-archive")).toBeNull();
  });

  it("opens the command menu from the rail when the draft is empty", async () => {
    const commands = vi.spyOn(api, "commands").mockResolvedValue([{ name: "tree", description: "Navigate session tree", source: "builtin" }]);
    const editor = await renderPromptEditor();

    button(editor, ".composer-commands").click();

    expect(editor.draft?.view?.state.doc.toString()).toBe("/");
    const menu = editor.shadowRoot?.querySelector("composer-draft")?.querySelector<AutocompleteMenu>("autocomplete-menu");
    if (menu === null || menu === undefined) throw new Error("Expected autocomplete menu");
    await vi.waitFor(() => {
      expect(menu.items).toEqual([expect.objectContaining({ kind: "command", insertText: "/tree" })]);
    });
    expect(commands).toHaveBeenCalled();
  });

  it("opens the command menu from a restored command draft whose caret sits at the start", async () => {
    vi.spyOn(api, "commands").mockResolvedValue([{ name: "tree", description: "Navigate session tree", source: "builtin" }]);
    const editor = await renderPromptEditor();
    // A reloaded page restores the persisted draft with its caret at 0, where
    // no command trigger exists. The button must still open the menu.
    editor.draft?.replaceText("/tr");
    editor.draft?.view?.dispatch({ selection: { anchor: 0 } });

    button(editor, ".composer-commands").click();

    expect(editor.draft?.view?.state.selection.main.head).toBe(3);
    const menu = editor.shadowRoot?.querySelector("composer-draft")?.querySelector<AutocompleteMenu>("autocomplete-menu");
    if (menu === null || menu === undefined) throw new Error("Expected autocomplete menu");
    await vi.waitFor(() => {
      expect(menu.items).toEqual([expect.objectContaining({ kind: "command", insertText: "/tree" })]);
    });
  });

  it("keeps the command button quiet while prose occupies the draft", async () => {
    const editor = await renderPromptEditor();

    editor.draft?.replaceText("a written prompt");
    await editor.updateComplete;

    expect(button(editor, ".composer-commands").disabled).toBe(true);

    editor.draft?.replaceText("");
    await editor.updateComplete;

    expect(button(editor, ".composer-commands").disabled).toBe(false);
  });

  it("offers no command button when the runtime cannot complete commands", async () => {
    const editor = new PromptEditor();
    editor.machineId = "local";
    editor.capabilities = sessionCapabilities();
    editor.composerRuntime = {
      supportedCompletionKinds: new Set(),
      inputModeForDraft: () => ({ kind: "normal" }),
      resolveCompletion: () => Promise.resolve([]),
    };
    document.body.append(editor);
    await editor.updateComplete;

    expect(editor.shadowRoot?.querySelector(".composer-commands")).toBeNull();
  });
});

async function renderPromptEditor(options: {
  onArchiveAndNext?: () => void;
} = {}): Promise<PromptEditor> {
  const editor = new PromptEditor();
  editor.sessionId = "session-1";
  editor.cwd = "/repo";
  editor.machineId = "local";
  editor.capabilities = sessionCapabilities(options);
  document.body.append(editor);
  await editor.updateComplete;
  return editor;
}

function button(editor: PromptEditor, selector: string): HTMLButtonElement {
  return required(editor.shadowRoot?.querySelector<HTMLButtonElement>(selector), `button ${selector}`);
}

function required<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${name}`);
  return value;
}
