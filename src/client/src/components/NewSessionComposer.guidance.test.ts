// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { completeNewSessionDestination } from "../newSessionComposer";
import { NewSessionComposer } from "./NewSessionComposer";
import { PromptEditor } from "./PromptEditor";
import { settleRenderedDialog } from "./modalSurfaceTestSupport";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

/**
 * Guidance used to paint above the composer and outside the dialog, which is
 * `overflow:hidden` — so nothing appeared at all. It is a popover now, and a
 * popover is allowed to leave the island it is anchored to.
 */
describe("new-session composer guidance", () => {
  it("shows the guidance panel inside the modal", async () => {
    const composer = await mount();
    const editor = promptEditor(composer);

    trigger(editor).click();
    await editor.updateComplete;

    const popover = editor.shadowRoot?.querySelector("composer-popover");
    expect(popover).not.toBeNull();
    expect(popover?.querySelector("guidance-picker")).not.toBeNull();
    expect(popover?.shadowRoot?.querySelector(".popover-panel")).not.toBeNull();
  });

  it("keeps the modal open when the panel is dismissed", async () => {
    const onCancel = vi.fn();
    const composer = await mount();
    composer.onCancel = onCancel;
    const editor = promptEditor(composer);

    trigger(editor).click();
    await editor.updateComplete;
    editor.shadowRoot?.querySelector("composer-popover")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await editor.updateComplete;

    expect(editor.shadowRoot?.querySelector("composer-popover")).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
  });
});

async function mount(): Promise<NewSessionComposer> {
  const composer = new NewSessionComposer();
  composer.initialDestination = completeNewSessionDestination(
    { id: "local", name: "Machine local", kind: "local", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", status: "online" },
    { id: "forgerie", name: "Project forgerie", path: "/repos/forgerie", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "main", projectId: "forgerie", path: "/repos/forgerie/main", label: "main", isMain: true, isGitRepo: true, isGitWorktree: false, effectiveConfig: {} },
  );
  document.body.append(composer);
  await settleRenderedDialog(composer);
  return composer;
}

function promptEditor(composer: NewSessionComposer): PromptEditor {
  const found = composer.shadowRoot?.querySelector("prompt-editor");
  if (!(found instanceof PromptEditor)) throw new Error("Expected the shared composer");
  return found;
}

function trigger(editor: PromptEditor): HTMLButtonElement {
  const found = editor.shadowRoot?.querySelector(".guidance-trigger");
  if (!(found instanceof HTMLButtonElement)) throw new Error("Expected the guidance trigger");
  return found;
}
