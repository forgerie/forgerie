// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createPreSessionComposerRuntime } from "../composerRuntime";
import { PromptEditor } from "./PromptEditor";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

/**
 * The new-session modal shows the same composer the chat shows. Only the
 * controls that need a running session stand down, so one component carries
 * both surfaces and a change to the composer reaches the modal for free.
 */
describe("PromptEditor pre-session surface", () => {
  it("hides the controls that need a running session", async () => {
    const editor = await renderPreSessionEditor();

    expect(query(editor, ".stop-button")).toBeNull();
    expect(query(editor, ".new-session-button")).toBeNull();
    expect(query(editor, "context-usage-meter")).toBeNull();
    expect(query(editor, ".compact-status")).toBeNull();
    expect(query(editor, ".composer-archive")).toBeNull();
    expect(query(editor, ".session-identity")).toBeNull();
  });

  it("keeps drafting, attachments, and send", async () => {
    const editor = await renderPreSessionEditor();

    expect(query(editor, "composer-draft")).not.toBeNull();
    expect(query(editor, ".composer-attach")).not.toBeNull();
    expect(query(editor, ".send-button")).not.toBeNull();
  });

  it("sends the drafted first prompt through the composer's own send", async () => {
    const onSend = vi.fn();
    const editor = await renderPreSessionEditor();
    editor.onSend = onSend;
    editor.replaceText("first prompt");
    await editor.updateComplete;

    const send = editor.shadowRoot?.querySelector<HTMLButtonElement>(".send-button");
    send?.click();
    await editor.updateComplete;

    expect(onSend).toHaveBeenCalledWith("first prompt", undefined, undefined, undefined);
  });

  it("uses the injected pre-session runtime instead of a session runtime", async () => {
    const runtime = createPreSessionComposerRuntime({
      machineId: "local",
      projectId: "project-1",
      workspaceId: "workspace-1",
      promptResourceCatalog: () => Promise.resolve({ available: true as const, commands: [], diagnostics: [] }),
    });
    const editor = await renderPreSessionEditor({ runtime });

    expect(editor.composerRuntime).toBe(runtime);
  });
});

async function renderPreSessionEditor(options: { runtime?: ReturnType<typeof createPreSessionComposerRuntime> } = {}): Promise<PromptEditor> {
  const editor = new PromptEditor();
  editor.machineId = "local";
  editor.composerRuntime = options.runtime ?? createPreSessionComposerRuntime({
    machineId: "local",
    projectId: "project-1",
    workspaceId: "workspace-1",
    promptResourceCatalog: () => Promise.resolve({ available: true as const, commands: [], diagnostics: [] }),
  });
  document.body.append(editor);
  await editor.updateComplete;
  return editor;
}

function query(editor: PromptEditor, selector: string): Element | null {
  return editor.shadowRoot?.querySelector(selector) ?? null;
}
