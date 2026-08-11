// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type SessionModel } from "../api";
import { PromptEditor } from "./PromptEditor";
import type { AutocompleteMenu } from "./AutocompleteMenu";

const sonnet: SessionModel = { provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" };
const gpt: SessionModel = { provider: "openai", id: "gpt-5.2" };

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("PromptEditor model completions", () => {
  it("requests models for the session and maps a # token to model completions through the shared draft", async () => {
    const models = vi.spyOn(api, "models").mockResolvedValue({ models: [sonnet, gpt] });
    const editor = await mountEditor({ machineId: "remote-a" });

    setEditorText(editor, "please use #cla");
    const menu = await waitForMenuItems(editor, 1);

    expect(models).toHaveBeenCalledWith({ id: "session-1", cwd: "/repo" }, "remote-a");
    expect(menu.items).toEqual([
      { kind: "model", replaceFrom: 11, replaceTo: 15, insertText: "#anthropic/claude-sonnet-4-5", detail: "anthropic", description: "Claude Sonnet 4.5" },
    ]);
  });

  it("lists every model for a bare # token", async () => {
    vi.spyOn(api, "models").mockResolvedValue({ models: [sonnet, gpt] });
    const editor = await mountEditor();

    setEditorText(editor, "#");
    const menu = await waitForMenuItems(editor, 2);

    expect(menu.items).toEqual([
      { kind: "model", replaceFrom: 0, replaceTo: 1, insertText: "#anthropic/claude-sonnet-4-5", detail: "anthropic", description: "Claude Sonnet 4.5" },
      { kind: "model", replaceFrom: 0, replaceTo: 1, insertText: "#openai/gpt-5.2", detail: "openai" },
    ]);
  });

  it("clears completions when the models request fails", async () => {
    vi.spyOn(api, "models").mockRejectedValue(new Error("models unavailable"));
    const editor = await mountEditor();

    setEditorText(editor, "#cla");
    await vi.waitFor(() => { expect(modelsMenu(editor)?.items).toEqual([]); });
  });

  it("does not request models without session context", async () => {
    const models = vi.spyOn(api, "models").mockResolvedValue({ models: [sonnet] });
    const editor = new PromptEditor();
    document.body.append(editor);
    await editor.updateComplete;

    setEditorText(editor, "#cla");
    await Promise.resolve();

    expect(models).not.toHaveBeenCalled();
    expect(modelsMenu(editor)?.items).toEqual([]);
  });
});

function setEditorText(editor: PromptEditor, text: string): void {
  const view = editor.view;
  if (view === undefined) throw new Error("Expected CodeMirror to mount");
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: text.length } });
}

async function mountEditor(options: { machineId?: string } = {}): Promise<PromptEditor> {
  const editor = new PromptEditor();
  editor.sessionId = "session-1";
  editor.cwd = "/repo";
  editor.machineId = options.machineId ?? "local";
  document.body.append(editor);
  await editor.updateComplete;
  if (editor.view === undefined) throw new Error("Expected CodeMirror to mount");
  return editor;
}

async function waitForMenuItems(editor: PromptEditor, count: number): Promise<AutocompleteMenu> {
  const menu = modelsMenu(editor);
  if (menu === null || menu === undefined) throw new Error("Expected autocomplete menu");
  await vi.waitFor(() => { expect(menu.items).toHaveLength(count); });
  return menu;
}

function modelsMenu(editor: PromptEditor): AutocompleteMenu | null | undefined {
  return editor.shadowRoot?.querySelector("composer-draft")?.querySelector<AutocompleteMenu>("autocomplete-menu");
}
