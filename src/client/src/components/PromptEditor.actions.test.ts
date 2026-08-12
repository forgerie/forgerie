// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
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
});

async function renderPromptEditor(options: {
  onArchiveAndNext?: () => void;
} = {}): Promise<PromptEditor> {
  const editor = new PromptEditor();
  editor.sessionId = "session-1";
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
