// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionStatus } from "../api";
import { PromptEditor } from "./PromptEditor";
import { sessionCapabilities, type SessionCapabilityOptions } from "./promptEditorTestSupport";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("PromptEditor read-only control availability", () => {
  it("disables model, thinking, and stop controls when the editor is disabled", async () => {
    const onStop = vi.fn();
    const editor = await renderPromptEditor({ disabled: true, stoppable: true, onStop });

    const model = button(editor, ".select-model");
    const thinking = button(editor, ".select-thinking");
    const stop = button(editor, ".stop-button");

    expect(model.disabled).toBe(true);
    expect(thinking.disabled).toBe(true);
    expect(stop.disabled).toBe(true);
    model.click();
    thinking.click();
    stop.click();
    await editor.updateComplete;

    // A disabled control raises no choice, so no layer opens over the draft.
    expect(editor.shadowRoot?.querySelector("composer-popover")).toBeNull();
    expect(onStop).not.toHaveBeenCalled();
  });

  it("keeps drafting and submission available while runtime-only controls load", async () => {
    const onSend = vi.fn();
    const editor = await renderPromptEditor({ runtimeControlsAvailable: false });
    editor.onSend = onSend;
    editor.replaceText("queue this immediately");
    await editor.updateComplete;

    const send = button(editor, ".send-button");
    const model = button(editor, ".select-model");
    const thinking = button(editor, ".select-thinking");

    expect(editor.view?.state.readOnly).toBe(false);
    expect(send.disabled).toBe(false);
    expect(model.disabled).toBe(true);
    expect(thinking.disabled).toBe(true);

    send.click();

    expect(onSend).toHaveBeenCalledWith("queue this immediately", undefined, undefined, undefined);
  });

  it("keeps archive available but disables attachments while the editor is read-only", async () => {
    const onArchiveAndNext = vi.fn();
    const editor = await renderPromptEditor({
      disabled: true,
      chromeSummoned: true,
      onArchiveAndNext,
    });

    const archive = button(editor, ".composer-archive");
    const attach = button(editor, ".composer-attach");

    expect(archive.disabled).toBe(false);
    expect(attach.disabled).toBe(true);
    archive.click();

    expect(onArchiveAndNext).toHaveBeenCalledOnce();
  });
});

async function renderPromptEditor(options: SessionCapabilityOptions & {
  disabled?: boolean;
  chromeSummoned?: boolean;
  runtimeControlsAvailable?: boolean;
}): Promise<PromptEditor> {
  const editor = new PromptEditor();
  const runtimeAvailable = options.runtimeControlsAvailable ?? true;
  editor.sessionId = "session-1";
  editor.machineId = "local";
  editor.status = status();
  editor.disabled = options.disabled ?? false;
  editor.runtimeControlsAvailable = runtimeAvailable;
  editor.chromeSummoned = options.chromeSummoned ?? false;
  editor.capabilities = sessionCapabilities({ ...options, status: status(), runtimeAvailable });
  document.body.append(editor);
  await editor.updateComplete;
  return editor;
}

function status(): SessionStatus {
  return {
    sessionId: "session-1",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    model: { provider: "anthropic", id: "claude" },
    thinkingLevel: "minimal",
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  };
}

function button(editor: PromptEditor, selector: string): HTMLButtonElement {
  const found = editor.shadowRoot?.querySelector<HTMLButtonElement>(selector);
  if (found === null || found === undefined) throw new Error(`Expected button ${selector}`);
  return found;
}
