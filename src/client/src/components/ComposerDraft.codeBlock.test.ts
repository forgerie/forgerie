// @vitest-environment happy-dom

import { undo } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComposerRuntime } from "../composerRuntime";
import { inputModeForDraft } from "../inputModes";
import { saveDraft } from "../promptDraftStorage";
import type { PromptCompletionTrigger } from "../promptCompletions";
import { ComposerDraft, type ComposerDraftSubmitSnapshot } from "./ComposerDraft";

const SQL_SOURCE = "```sql\nSELECT * FROM you\n```\n";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("ComposerDraft rich code blocks", () => {
  it("converts a typed fence into one editable SQL block and undoes it atomically", async () => {
    saveDraft("code-block-conversion", "```sql");
    const draft = await mountDraft({ storageKey: "code-block-conversion" });
    const view = requiredView(draft);
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
    const originalCursor = view.state.selection.main.head;

    pressShiftEnter(draft);

    expect(draft.getText()).toBe("```sql\n\n```\n");
    await waitForCodeBlocks(draft, 1);
    expect(view.state.selection.main.head).toBe("```sql\n".length);
    expect(editorContent(draft).textContent).not.toContain("```");
    expect(codeBlockHeader(draft).textContent).toBe("SQL");
    expect(codeBlockHeader(draft).getAttribute("aria-label")).toBe("SQL code block");

    expect(undo(view)).toBe(true);
    expect(draft.getText()).toBe("```sql");
    expect(view.state.selection.main.head).toBe(originalCursor);
  });

  it("highlights supported SQL code and keeps Shift+Enter inside the block", async () => {
    const draft = await mountDraft();
    draft.replaceText(SQL_SOURCE);
    await waitForCodeBlocks(draft, 1);
    await waitForHighlightedText(draft, "SELECT");
    const view = requiredView(draft);
    const selectEnd = SQL_SOURCE.indexOf("\n```", SQL_SOURCE.indexOf("SELECT"));
    view.dispatch({ selection: EditorSelection.cursor(selectEnd) });

    pressShiftEnter(draft);

    expect(draft.getText()).toBe("```sql\nSELECT * FROM you\n\n```\n");
    expect(codeLine(draft).querySelectorAll("span").length).toBeGreaterThan(0);
  });

  it("uses the shared language aliases in the composer", async () => {
    const draft = await mountDraft();
    draft.replaceText("```ts\nconst answer: number = 1;\n```\n");
    await waitForCodeBlocks(draft, 1);
    await waitForHighlightedText(draft, "const");

    expect(codeBlockHeader(draft).textContent).toBe("TS");
  });

  it("converts complete pasted fences and leaves incomplete fences as source", async () => {
    const draft = await mountDraft();
    const pasted = "Before\n\n```sql\nSELECT 1\n```\n\n```diagram\nnode\n```\n\n```python\nprint(1)";

    pasteText(draft, pasted);
    await waitForCodeBlocks(draft, 2);

    expect(draft.getText()).toBe(pasted);
    expect(codeBlockHeaders(draft).map((header) => header.textContent)).toEqual(["SQL", "DIAGRAM"]);
    expect(editorContent(draft).textContent).toContain("```python");
  });

  it("moves from the final code line into prose with Arrow Down", async () => {
    const draft = await mountDraft();
    draft.replaceText("```sql\nSELECT 1\n```");
    await waitForCodeBlocks(draft, 1);
    const view = requiredView(draft);
    view.dispatch({ selection: EditorSelection.cursor("```sql\nSELECT 1".length) });

    pressKey(draft, "ArrowDown");

    expect(draft.getText()).toBe("```sql\nSELECT 1\n```\n");
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe("");

    draft.replaceText("```sql\nSELECT 1\n```\nContinue here");
    view.dispatch({ selection: EditorSelection.cursor("```sql\nSELECT 1".length) });
    pressKey(draft, "ArrowDown");

    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe("Continue here");
  });

  it("moves into an adjacent code block without selecting its hidden opener", async () => {
    const draft = await mountDraft();
    const source = "```sql\nSELECT 1\n```\n```python\nprint(1)\n```\n";
    draft.replaceText(source);
    await waitForCodeBlocks(draft, 2);
    const view = requiredView(draft);
    view.dispatch({ selection: EditorSelection.cursor(source.indexOf("\n```", source.indexOf("SELECT"))) });

    pressKey(draft, "ArrowDown");

    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe("print(1)");
  });

  it("protects hidden fence markers from boundary deletion", async () => {
    const draft = await mountDraft();
    draft.replaceText(SQL_SOURCE);
    await waitForCodeBlocks(draft, 1);
    const view = requiredView(draft);
    const firstCodeLine = view.state.doc.line(2);
    view.dispatch({ selection: EditorSelection.cursor(firstCodeLine.from) });

    pressKey(draft, "Backspace");

    expect(draft.getText()).toBe(SQL_SOURCE);
    const finalCodeLine = view.state.doc.line(2);
    view.dispatch({ selection: EditorSelection.cursor(finalCodeLine.to) });
    pressKey(draft, "Delete");

    expect(draft.getText()).toBe(SQL_SOURCE);
  });

  it("keeps ordinary Shift+Enter as a prose newline", async () => {
    const draft = await mountDraft();
    draft.replaceText("first line");

    pressShiftEnter(draft);

    expect(draft.getText()).toBe("first line\n");
    expect(codeBlockHeaders(draft)).toEqual([]);
  });

  it("makes an empty pasted block editable from its visible body", async () => {
    const draft = await mountDraft();
    pasteText(draft, "```sql\n```\n");
    await waitForCodeBlocks(draft, 1);
    const emptyBody = draft.querySelector<HTMLElement>(".cm-code-block-empty");
    if (emptyBody === null) throw new Error("Expected an empty code block body");

    emptyBody.click();

    expect(draft.getText()).toBe("```sql\n\n```\n");
    expect(requiredView(draft).state.doc.lineAt(requiredView(draft).state.selection.main.head).text).toBe("");

    draft.replaceText("```sql\n```\n");
    const keyboardBody = draft.querySelector<HTMLElement>(".cm-code-block-empty");
    if (keyboardBody === null) throw new Error("Expected an empty keyboard-editable body");
    keyboardBody.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

    expect(draft.getText()).toBe("```sql\n\n```\n");
  });

  it("keeps canonical fenced Markdown through reconnect, persistence, and submission", async () => {
    const storageKey = "rich-code-block-persistence";
    const host = document.createElement("div");
    const draft = await mountDraft({ host, storageKey });
    draft.replaceText(SQL_SOURCE);
    await waitForCodeBlocks(draft, 1);

    host.remove();
    document.body.append(host);
    await draft.updateComplete;
    await waitForCodeBlocks(draft, 1);
    expect(draft.getText()).toBe(SQL_SOURCE);

    host.remove();
    const submitted: ComposerDraftSubmitSnapshot[] = [];
    const restored = await mountDraft({
      storageKey,
      onSubmit: (snapshot) => {
        submitted.push(snapshot);
        return "rejected";
      },
    });
    await waitForCodeBlocks(restored, 1);
    restored.submit();

    expect(restored.getText()).toBe(SQL_SOURCE);
    expect(submitted).toEqual([{ text: SQL_SOURCE }]);
  });

  it("keeps hidden fence source available to selection, plugin insertion, and dictation", async () => {
    const draft = await mountDraft();
    draft.replaceText(SQL_SOURCE);
    await waitForCodeBlocks(draft, 1);
    const view = requiredView(draft);
    vi.spyOn(view, "hasFocus", "get").mockReturnValue(true);
    view.dispatch({ selection: EditorSelection.range(0, view.state.doc.length) });

    expect(draft.getSelection()?.text).toBe(SQL_SOURCE);

    const youFrom = draft.getText().indexOf("you");
    view.dispatch({ selection: EditorSelection.range(youFrom, youFrom + 3) });
    expect(draft.insertTextAtSelection("users")).toBe(true);
    expect(draft.getText()).toContain("SELECT * FROM users");
    const usersFrom = draft.getText().indexOf("users");
    view.dispatch({ selection: EditorSelection.range(usersFrom, usersFrom + "users".length) });
    expect(draft.beginDictationEdit()).toBe(true);
    expect(draft.commitDictationTranscript("accounts")).toBe(true);
    expect(draft.finishDictationEdit()).toBe(true);

    expect(draft.getText()).toBe("```sql\nSELECT * FROM accounts\n```\n");
    expect(codeBlockHeaders(draft)).toHaveLength(1);
  });

  it("restores rich code blocks through prompt history", async () => {
    const historySource = SQL_SOURCE.trimEnd();
    const draft = await mountDraft({ promptHistory: [historySource] });

    pressKey(draft, "ArrowUp");
    await waitForCodeBlocks(draft, 1);

    expect(draft.getText()).toBe(historySource);
  });

  it("renders unknown languages as labelled plain code without fuzzy matching", async () => {
    const draft = await mountDraft();
    draft.replaceText("```javascript-extra\nconst node = true;\n```\n");
    await waitForCodeBlocks(draft, 1);

    expect(codeBlockHeader(draft).textContent).toBe("JAVASCRIPT-EXTRA");
    expect(codeLine(draft).querySelector("span")).toBeNull();
    expect(draft.getText()).toBe("```javascript-extra\nconst node = true;\n```\n");
  });
});

async function mountDraft(options: {
  storageKey?: string;
  promptHistory?: readonly string[];
  onSubmit?: (snapshot: ComposerDraftSubmitSnapshot) => "accepted" | "rejected";
  host?: HTMLElement;
} = {}): Promise<ComposerDraft> {
  const host = options.host ?? document.createElement("div");
  const draft = new ComposerDraft();
  draft.runtime = runtimeWith(() => []);
  if (options.storageKey !== undefined) draft.storageKey = options.storageKey;
  if (options.promptHistory !== undefined) draft.promptHistory = options.promptHistory;
  if (options.onSubmit !== undefined) draft.onSubmit = options.onSubmit;
  host.append(draft);
  if (!host.isConnected) document.body.append(host);
  await draft.updateComplete;
  requiredView(draft);
  return draft;
}

function runtimeWith(resolve: (trigger: PromptCompletionTrigger) => readonly []): ComposerRuntime {
  return { supportedCompletionKinds: new Set(["command", "file", "model"]), inputModeForDraft, resolveCompletion: (trigger) => Promise.resolve(resolve(trigger)) };
}

function requiredView(draft: ComposerDraft) {
  const view = draft.view;
  if (view === undefined) throw new Error("Expected CodeMirror to mount");
  return view;
}

function editorContent(draft: ComposerDraft): HTMLElement {
  return requiredView(draft).contentDOM;
}

function pressShiftEnter(draft: ComposerDraft): void {
  editorContent(draft).dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", bubbles: true, cancelable: true }));
  editorContent(draft).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true }));
}

function pressKey(draft: ComposerDraft, key: string): void {
  editorContent(draft).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

function pasteText(draft: ComposerDraft, text: string): void {
  const view = requiredView(draft);
  view.dispatch({ ...view.state.replaceSelection(text), scrollIntoView: true, userEvent: "input.paste" });
}

function codeBlockHeaders(draft: ComposerDraft): HTMLElement[] {
  return Array.from(draft.querySelectorAll<HTMLElement>(".cm-code-block-header"));
}

function codeBlockHeader(draft: ComposerDraft): HTMLElement {
  const header = codeBlockHeaders(draft)[0];
  if (header === undefined) throw new Error("Expected a code block header");
  return header;
}

function codeLine(draft: ComposerDraft): HTMLElement {
  const line = draft.querySelector<HTMLElement>(".cm-code-block-body .cm-line");
  if (line === null) throw new Error("Expected a code block line");
  return line;
}

async function waitForCodeBlocks(draft: ComposerDraft, count: number): Promise<void> {
  await vi.waitFor(() => { expect(codeBlockHeaders(draft)).toHaveLength(count); });
}

async function waitForHighlightedText(draft: ComposerDraft, text: string): Promise<void> {
  await vi.waitFor(() => {
    const token = Array.from(codeLine(draft).querySelectorAll("span")).find((span) => span.textContent === text);
    expect(token).not.toBeUndefined();
  });
}
