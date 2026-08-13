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
    const onChooseModel = vi.fn();
    const onChooseThinkingLevel = vi.fn();
    const editor = await mount({
      model: {
        model: { id: "claude-sonnet-5", name: "Claude Sonnet 5", provider: "anthropic" },
        thinkingLevel: "medium",
        availableThinkingLevels: ["off", "medium"],
        listModels: () => Promise.resolve([{
          provider: "anthropic",
          id: "claude-opus-4-8",
          name: "Claude Opus 4.8",
          contextWindow: 1000000,
        }]),
        onChooseModel,
        onChooseThinkingLevel,
      },
    });

    expect(button(editor, ".select-model").textContent).toBe("Claude Sonnet 5");
    expect(button(editor, ".select-model").title).toBe("Select model: anthropic/claude-sonnet-5");

    // The choice opens against its own control, in the composer's one layer.
    button(editor, ".select-thinking").click();
    await editor.updateComplete;
    pick(editor, "off");
    await editor.updateComplete;

    expect(onChooseThinkingLevel).toHaveBeenCalledWith("off");
    expect(editor.shadowRoot?.querySelector("composer-popover")).toBeNull();

    button(editor, ".select-model").click();
    await editor.updateComplete;
    await editor.updateComplete;
    expect(choice(editor, "anthropic/claude-opus-4-8").textContent).toContain("Claude Opus 4.8");
    pick(editor, "anthropic/claude-opus-4-8");

    expect(onChooseModel).toHaveBeenCalledWith({
      provider: "anthropic",
      id: "claude-opus-4-8",
      name: "Claude Opus 4.8",
      contextWindow: 1000000,
    });
  });

  it("preserves scoped-first model order across provider groups", async () => {
    const editor = await mount({
      model: {
        model: { provider: "openai-codex", id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
        listModels: () => Promise.resolve([
          { provider: "anthropic", id: "claude-fable-5", name: "Claude Fable 5" },
          { provider: "openai-codex", id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
          { provider: "anthropic", id: "claude-opus-5", name: "Claude Opus 5" },
          { provider: "anthropic", id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
        ]),
        onChooseModel: vi.fn(),
        onChooseThinkingLevel: vi.fn(),
      },
    });

    button(editor, ".select-model").click();
    await editor.updateComplete;
    await editor.updateComplete;

    const list = editor.shadowRoot?.querySelector("composer-choice-list");
    const headings = [...list?.shadowRoot?.querySelectorAll(".choice-group") ?? []]
      .map((heading) => heading.textContent);
    expect(headings).toEqual(["Anthropic", "Openai Codex", "Anthropic"]);

    const values = [...list?.shadowRoot?.querySelectorAll<HTMLButtonElement>("[data-value]") ?? []]
      .map((option) => option.dataset["value"]);
    expect(values).toEqual([
      "anthropic/claude-fable-5",
      "openai-codex/gpt-5.6-sol",
      "anthropic/claude-opus-5",
      "anthropic/claude-haiku-4-5",
    ]);
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

function choice(editor: PromptEditor, value: string): HTMLButtonElement {
  const list = editor.shadowRoot?.querySelector("composer-choice-list");
  const option = list?.shadowRoot?.querySelector(`[data-value="${value}"]`);
  if (!(option instanceof HTMLButtonElement)) throw new Error(`Expected choice ${value}`);
  return option;
}

function pick(editor: PromptEditor, value: string): void {
  choice(editor, value).click();
}

function button(editor: PromptEditor, selector: string): HTMLButtonElement {
  const found = query(editor, selector);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`Expected button ${selector}`);
  return found;
}
