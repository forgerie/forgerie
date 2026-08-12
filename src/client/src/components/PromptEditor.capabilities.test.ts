// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComposerCapabilities } from "../composerCapabilities";
import { PromptEditor } from "./PromptEditor";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

/**
 * A control belongs to the composer because a host declared it, not because a
 * field happened to be set. Both surfaces declare the same way, so a control
 * reaches both as soon as its host can supply the state behind it.
 */
describe("PromptEditor capabilities", () => {
  it("offers only writing and sending when a host declares nothing", async () => {
    const editor = await mount({});

    expect(query(editor, "composer-draft")).not.toBeNull();
    expect(query(editor, ".composer-attach")).not.toBeNull();
    expect(query(editor, ".send-button")).not.toBeNull();

    expect(query(editor, ".select-model")).toBeNull();
    expect(query(editor, ".select-thinking")).toBeNull();
    expect(query(editor, ".guidance-trigger")).toBeNull();
    expect(query(editor, ".stop-button")).toBeNull();
    expect(query(editor, ".composer-archive")).toBeNull();
    expect(query(editor, ".new-session-button")).toBeNull();
    expect(query(editor, "context-usage-meter")).toBeNull();
    expect(query(editor, ".composer-context-chip")).toBeNull();
  });

  it("offers model and thinking to any host that can choose them", async () => {
    const onSelectModel = vi.fn();
    const onSelectThinking = vi.fn();
    const editor = await mount({
      model: {
        model: { id: "sonnet", provider: "anthropic" },
        thinkingLevel: "medium",
        availableThinkingLevels: ["off", "medium"],
        onSelectModel,
        onSelectThinking,
      },
    });

    const model = button(editor, ".select-model");
    expect(model.textContent).toContain("sonnet");
    model.click();
    button(editor, ".select-thinking").click();

    expect(onSelectModel).toHaveBeenCalledTimes(1);
    expect(onSelectThinking).toHaveBeenCalledTimes(1);
  });

  it("offers guidance, stop, archive, and new session only when declared", async () => {
    const onStop = vi.fn();
    const onArchiveAndNext = vi.fn();
    const onNewSession = vi.fn();
    const editor = await mount({
      guidance: { activeIds: ["technical-english"], onSet: () => Promise.resolve(true) },
      stop: { stoppable: true, onStop },
      archive: { onArchiveAndNext },
      newSession: { onNewSession },
    });

    expect(query(editor, ".guidance-trigger")).not.toBeNull();
    button(editor, ".stop-button").click();
    button(editor, ".composer-archive").click();
    button(editor, ".new-session-button").click();

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onArchiveAndNext).toHaveBeenCalledTimes(1);
    expect(onNewSession).toHaveBeenCalledTimes(1);
  });

  it("states where it is pointed, and lets a host offer to repoint it", async () => {
    const onActivate = vi.fn();
    const editor = await mount({
      context: [{ id: "destination", label: "forge · main", action: { label: "Change destination", onActivate } }],
    });

    const chip = query(editor, ".composer-context-chip");
    expect(chip?.textContent).toContain("forge · main");
    button(editor, "[data-action='change-destination']").click();

    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});

async function mount(capabilities: ComposerCapabilities): Promise<PromptEditor> {
  const editor = new PromptEditor();
  editor.machineId = "local";
  editor.capabilities = capabilities;
  document.body.append(editor);
  await editor.updateComplete;
  return editor;
}

function query(editor: PromptEditor, selector: string): Element | null {
  return editor.shadowRoot?.querySelector(selector) ?? null;
}

function button(editor: PromptEditor, selector: string): HTMLButtonElement {
  const found = query(editor, selector);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`Expected button ${selector}`);
  return found;
}
