// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { PromptEditor } from "./PromptEditor";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("PromptEditor New session shortcut", () => {
  it.each([
    { modifier: "Control", event: { ctrlKey: true } },
    { modifier: "Meta", event: { metaKey: true } },
  ])("opens New session on the configured Mod+Enter binding with $modifier", async ({ event }) => {
    const { editor, onNewSession, onSend } = await mountedEditor("mod+enter", "keep this chat draft");

    const keyboardEvent = dispatchEditorKey(editor, "Enter", event);

    expect(onNewSession).toHaveBeenCalledOnce();
    expect(onSend).not.toHaveBeenCalled();
    expect(editor.view?.state.doc.toString()).toBe("keep this chat draft");
    expect(keyboardEvent.defaultPrevented).toBe(true);
  });

  it("opens New session only on a remapped binding", async () => {
    const { editor, onNewSession, onSend } = await mountedEditor("alt+n", "keep this chat draft");

    dispatchEditorKey(editor, "Enter", { ctrlKey: true });
    expect(onNewSession).not.toHaveBeenCalled();
    expect(onSend).toHaveBeenCalledWith("keep this chat draft", undefined, undefined, undefined);

    dispatchEditorKey(editor, "n", { altKey: true });
    expect(onNewSession).toHaveBeenCalledOnce();
  });

  it("does not open New session when its binding is disabled", async () => {
    const { editor, onNewSession, onSend } = await mountedEditor(undefined, "send with existing behavior");

    dispatchEditorKey(editor, "Enter", { ctrlKey: true });

    expect(onNewSession).not.toHaveBeenCalled();
    expect(onSend).toHaveBeenCalledWith("send with existing behavior", undefined, undefined, undefined);
  });

  it("preserves the configured plain Enter behavior", async () => {
    const { editor, onNewSession, onSend } = await mountedEditor("mod+enter", "send normally");

    dispatchEditorKey(editor, "Enter");

    expect(onNewSession).not.toHaveBeenCalled();
    expect(onSend).toHaveBeenCalledWith("send normally", undefined, undefined, undefined);
  });
});

async function mountedEditor(newSessionShortcut: string | undefined, text: string): Promise<{
  editor: PromptEditor;
  onNewSession: ReturnType<typeof vi.fn>;
  onSend: ReturnType<typeof vi.fn>;
}> {
  const onNewSession = vi.fn();
  const onSend = vi.fn();
  const editor = new PromptEditor();
  editor.sessionId = "session-1";
  editor.cwd = "/repo";
  if (newSessionShortcut !== undefined) editor.newSessionShortcut = newSessionShortcut;
  editor.onNewSession = onNewSession;
  editor.onSend = onSend;
  document.body.append(editor);
  await editor.updateComplete;
  editor.replaceText(text);
  return { editor, onNewSession, onSend };
}

function dispatchEditorKey(editor: PromptEditor, key: string, modifiers: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    ...modifiers,
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  editor.view?.contentDOM.dispatchEvent(event);
  return event;
}
