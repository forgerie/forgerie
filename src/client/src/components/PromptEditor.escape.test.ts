// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type SessionStatus } from "../api";
import type { AutocompleteMenu } from "./AutocompleteMenu";
import { pressKey } from "./modalSurfaceTestSupport";
import { PromptEditor } from "./PromptEditor";
import { sessionCapabilities } from "./promptEditorTestSupport";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("PromptEditor Escape behavior", () => {
  it("closes autocomplete before stopping active work", async () => {
    vi.spyOn(api, "commands").mockResolvedValue([{ name: "tree", source: "builtin" }]);
    const onStop = vi.fn();
    const editor = await mountEditor({ status: status({ isStreaming: true }), canStop: true, onStop });
    setEditorText(editor, "/");
    const menu = autocompleteMenu(editor);
    if (menu === null || menu === undefined) throw new Error("Expected autocomplete menu");
    await vi.waitFor(() => { expect(menu.items).toHaveLength(1); });

    const event = pressEscape(editor);
    await editor.updateComplete;
    await menu.updateComplete;

    expect(menu.items).toEqual([]);
    expect(onStop).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it.each([
    { state: "streaming", patch: { isStreaming: true } },
    { state: "compacting", patch: { isCompacting: true } },
    { state: "running bash", patch: { isBashRunning: true } },
  ])("stops active work while $state", async ({ patch }) => {
    const onStop = vi.fn();
    const editor = await mountEditor({ status: status(patch), canStop: true, onStop });

    const event = pressEscape(editor);

    expect(onStop).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it("clears a pending shell command before considering double Escape", async () => {
    const onDoubleEscapeAction = vi.fn();
    const editor = await mountEditor({ status: status(), onDoubleEscapeAction });
    editor.replaceText("!pwd");

    pressEscape(editor);

    expect(editor.view?.state.doc.toString()).toBe("");
    expect(onDoubleEscapeAction).not.toHaveBeenCalled();
  });

  it.each(["tree", "fork"] as const)("runs the configured %s action on two empty-editor presses within 500 ms", async (action) => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const onDoubleEscapeAction = vi.fn();
    const editor = await mountEditor({ status: status({ doubleEscapeAction: action }), onDoubleEscapeAction });

    pressEscape(editor);
    vi.advanceTimersByTime(499);
    pressEscape(editor);

    expect(onDoubleEscapeAction).toHaveBeenCalledExactlyOnceWith(action);
  });

  it("uses Pi's tree default when an older daemon omits the setting", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const onDoubleEscapeAction = vi.fn();
    const editor = await mountEditor({ status: status(), onDoubleEscapeAction });

    pressEscape(editor);
    vi.advanceTimersByTime(100);
    pressEscape(editor);

    expect(onDoubleEscapeAction).toHaveBeenCalledExactlyOnceWith("tree");
  });

  it("does not run the idle action when disabled, configured as none, non-empty, or too slow", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const onDoubleEscapeAction = vi.fn();
    const editor = await mountEditor({ status: status({ doubleEscapeAction: "none" }), onDoubleEscapeAction });

    pressEscape(editor);
    vi.advanceTimersByTime(100);
    pressEscape(editor);
    editor.status = status({ doubleEscapeAction: "tree" });
    editor.replaceText("draft");
    pressEscape(editor);
    editor.replaceText("");
    vi.advanceTimersByTime(501);
    pressEscape(editor);
    vi.advanceTimersByTime(501);
    pressEscape(editor);
    editor.disabled = true;
    vi.advanceTimersByTime(100);
    pressEscape(editor);

    expect(onDoubleEscapeAction).not.toHaveBeenCalled();
  });
});

async function mountEditor(options: {
  status: SessionStatus;
  canStop?: boolean;
  onStop?: () => void;
  onDoubleEscapeAction?: (action: "tree" | "fork") => void;
}): Promise<PromptEditor> {
  const editor = new PromptEditor();
  editor.sessionId = "session-1";
  editor.cwd = "/repo";
  editor.status = options.status;
  editor.capabilities = sessionCapabilities({
    status: options.status,
    stoppable: options.canStop ?? false,
    ...(options.onStop === undefined ? {} : { onStop: options.onStop }),
  });
  if (options.onDoubleEscapeAction !== undefined) editor.onDoubleEscapeAction = options.onDoubleEscapeAction;
  document.body.append(editor);
  await editor.updateComplete;
  if (editor.view === undefined) throw new Error("Expected CodeMirror to mount");
  return editor;
}

function pressEscape(editor: PromptEditor): KeyboardEvent {
  const view = editor.view;
  if (view === undefined) throw new Error("Expected CodeMirror to mount");
  return pressKey(view.contentDOM, "Escape");
}

function autocompleteMenu(editor: PromptEditor): AutocompleteMenu | null | undefined {
  return editor.shadowRoot?.querySelector("composer-draft")?.querySelector<AutocompleteMenu>("autocomplete-menu");
}

function setEditorText(editor: PromptEditor, text: string): void {
  const view = editor.view;
  if (view === undefined) throw new Error("Expected CodeMirror to mount");
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: text.length } });
}

function status(patch: Partial<SessionStatus> = {}): SessionStatus {
  return {
    sessionId: "session-1",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    ...patch,
  };
}
