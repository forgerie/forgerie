// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime, type AppendMessage } from "@assistant-ui/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionModel } from "../contracts";
import type { ModelBinding } from "./ModelPicker";
import { Thread } from "./Thread";
import { useThreadMessages } from "../useThreadMessages";
import type { ComposerInputElement } from "./ComposerEditor";

let root: Root;
const opus: SessionModel = { provider: "cliproxyapi", id: "claude-opus-5-5", name: "Claude Opus 5.5", contextWindow: 1_000_000, reasoning: true, scoped: true };
const codex: SessionModel = { provider: "openai-codex", id: "gpt-5.6-sol", name: "GPT-5.6 Sol", contextWindow: 272_000, reasoning: false };
const haiku: SessionModel = { provider: "anthropic", id: "claude-haiku-4-5", name: "Claude Haiku 4.5", contextWindow: 200_000, reasoning: true };

interface Props { model?: Partial<ModelBinding>; onNew?: (message: AppendMessage) => Promise<void>; offline?: boolean; onCancel?: () => Promise<void>; commands?: boolean }
function binding(overrides: Partial<ModelBinding> = {}): ModelBinding {
  return {
    model: opus, thinkingLevel: "high", disabled: false,
    listModels: async () => [opus, haiku, codex],
    listThinkingLevels: async () => ["off", "low", "medium", "high"],
    onModel: async () => {}, onThinkingLevel: async () => {}, ...overrides,
  };
}
function Fixture({ model, onNew = async () => {}, offline = false, onCancel, commands = false }: Props) {
  const running = onCancel !== undefined;
  const runtime = useExternalStoreRuntime({ messages: useThreadMessages([], running), onNew, ...(onCancel ? { onCancel } : {}), isRunning: running, isDisabled: offline });
  // Pi lists `/model` as a builtin, so the slash list offers it.
  return <AssistantRuntimeProvider runtime={runtime}><Thread model={binding(model)} commands={commands ? { catalog: { type: "ready",
    commands: [{ name: "model", source: "builtin", description: "Select model" }, { name: "name", source: "builtin", description: "Set name" }] },
    onRetry: () => {} } : undefined} /></AssistantRuntimeProvider>;
}
/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const render = (props: Props = {}) => act(async () => root.render(<Fixture {...props} />));
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const trigger = () => document.querySelector<HTMLButtonElement>(".model-trigger")!;
const panel = () => document.querySelector<HTMLElement>(".model-panel");
const input = () => document.querySelector<ComposerInputElement>(".composer [data-composer-input]")!;
const buttons = (scope: ParentNode = document) => [...scope.querySelectorAll<HTMLButtonElement>("button")];
const button = (name: string, scope: ParentNode = document) => buttons(scope).find((node) => node.textContent?.includes(name) || node.getAttribute("aria-label") === name);
const click = async (node: HTMLElement | undefined) => { await act(async () => node!.click()); await settle(); };
function type(text: string) {
  return act(async () => {
    input().value = text;
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const press = (target: HTMLElement, key: string) => act(async () => {
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }));
});
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe("context use in the input bar", () => {
  const readout = () => document.querySelector<HTMLElement>(".context-bar");
  it("draws the percent used as a bar on the input's top edge, with no number in the row", async () => {
    await render({ model: { context: { type: "known", percent: 62, high: false } } });
    expect(readout()?.parentElement?.classList.contains("composer-shell")).toBe(true);
    expect(readout()?.getAttribute("role")).toBe("progressbar");
    expect(readout()?.getAttribute("aria-valuenow")).toBe("62");
    expect(readout()?.getAttribute("aria-label")).toBe("Context used");
    expect(readout()?.style.getPropertyValue("--context-used")).toBe("62%");
    expect(readout()?.dataset.high).toBeUndefined();
    expect(document.querySelector(".composer-actions")?.textContent).not.toContain("%");
  });
  it("marks the last fifth of the window", async () => {
    await render({ model: { context: { type: "known", percent: 86, high: true } } });
    expect(readout()?.dataset.high).toBe("true");
  });
  it("shows nothing until Pi has measured a reply", async () => {
    await render({ model: { context: { type: "unknown" } } });
    expect(readout()).toBeNull();
  });
});

describe("model and thinking level in the input bar", () => {
  it("reads as the session's model and thinking level, and opens Pi's models in groups", async () => {
    await render();
    expect(trigger().textContent).toContain("Claude Opus 5.5");
    expect(trigger().textContent).toContain("High");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    await click(trigger());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect([...panel()!.querySelectorAll(".model-group-label")].map((node) => node.textContent)).toEqual(["Favorites", "Anthropic", "Openai Codex"]);
    expect(button("Claude Opus 5.5", panel()!)!.getAttribute("aria-current")).toBe("true");
    expect(document.activeElement).toBe(button("Claude Opus 5.5", panel()!));
    expect(button("GPT-5.6 Sol", panel()!)!.textContent).toContain("no thinking");
  });

  it("changes the model through the binding, then closes and returns focus to the trigger", async () => {
    const onModel = vi.fn<ModelBinding["onModel"]>().mockResolvedValue(undefined);
    await render({ model: { onModel } });
    await click(trigger());
    await click(button("Claude Haiku 4.5", panel()!));
    expect(onModel).toHaveBeenCalledWith("anthropic", "claude-haiku-4-5");
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("keeps the panel and the old choice when Pi refuses, and says why", async () => {
    const onModel = vi.fn<ModelBinding["onModel"]>().mockRejectedValue(new Error("Model not found: anthropic/claude-haiku-4-5"));
    await render({ model: { onModel } });
    await click(trigger());
    await click(button("Claude Haiku 4.5", panel()!));
    expect(panel()!.querySelector("[role=alert]")!.textContent).toBe("Model not found: anthropic/claude-haiku-4-5");
    expect(button("Claude Opus 5.5", panel()!)!.getAttribute("aria-current")).toBe("true");
    expect(onModel).toHaveBeenCalledTimes(1);
  });

  it("sets the thinking level from the levels the model allows, and stays open to compare", async () => {
    const onThinkingLevel = vi.fn<ModelBinding["onThinkingLevel"]>().mockResolvedValue(undefined);
    await render({ model: { onThinkingLevel } });
    await click(trigger());
    const levels = panel()!.querySelector(".model-levels")!;
    expect(buttons(levels).map((node) => [node.textContent, node.getAttribute("aria-pressed")]))
      .toEqual([["Off", "false"], ["Low", "false"], ["Medium", "false"], ["High", "true"]]);
    await click(button("Low", levels));
    expect(onThinkingLevel).toHaveBeenCalledWith("low");
    expect(panel()).not.toBeNull();
  });

  it("says when the model does not think instead of offering one level", async () => {
    await render({ model: { model: codex, thinkingLevel: "off", listThinkingLevels: async () => ["off"] } });
    expect(trigger().textContent).toContain("Off");
    await click(trigger());
    expect(panel()!.querySelector(".model-thinking")!.textContent).toContain("This model does not think.");
    expect(panel()!.querySelector(".model-levels")).toBeNull();
  });

  it("filters the list as you search, and Escape closes it", async () => {
    await render();
    await click(trigger());
    const search = panel()!.querySelector<HTMLInputElement>(".model-search")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "codex");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect([...panel()!.querySelectorAll(".model-row")].map((node) => node.querySelector(".model-row-name")!.textContent)).toEqual(["GPT-5.6 Sol"]);
    await press(search, "Escape");
    expect(panel()).toBeNull();
  });

  it("opens the picker for /model with its search, without sending anything", async () => {
    const onNew = vi.fn<(message: AppendMessage) => Promise<void>>().mockResolvedValue(undefined);
    await render({ onNew });
    await type("/model haiku");
    expect(button("Choose model")).toBeDefined();
    await press(input(), "Enter");
    await settle();
    expect(onNew).not.toHaveBeenCalled();
    expect(input().value).toBe("");
    expect(panel()!.querySelector<HTMLInputElement>(".model-search")!.value).toBe("haiku");
    expect([...panel()!.querySelectorAll(".model-row")]).toHaveLength(1);
  });

  it("names a session without a model, and cannot change anything while offline", async () => {
    await render({ model: { model: undefined, thinkingLevel: undefined, disabled: true } });
    expect(trigger().textContent).toContain("No model");
    expect(trigger().disabled).toBe(true);
  });

  it("moves focus into the panel at once, so Escape closes it and never stops the run", async () => {
    const onCancel = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const models = deferred<SessionModel[]>();
    await render({ onCancel, model: { listModels: () => models.promise } });
    await type("/model");
    await press(input(), "Enter");
    expect(panel()).not.toBeNull();
    expect(document.activeElement).toBe(panel());
    await press(document.activeElement as HTMLElement, "Escape");
    expect(panel()).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("focuses the current model once the list loads, if focus has not moved", async () => {
    const models = deferred<SessionModel[]>();
    await render({ model: { listModels: () => models.promise } });
    await click(trigger());
    expect(document.activeElement).toBe(panel());
    await act(async () => { models.resolve([opus, haiku]); });
    await settle();
    expect(document.activeElement).toBe(button("Claude Opus 5.5", panel()!));
  });

  it("opens the picker on the first Enter for a full /model, even while the slash list offers it", async () => {
    await render({ commands: true });
    await type("/model");
    await press(input(), "Enter");
    await settle();
    expect(panel()).not.toBeNull();
    expect(input().value).toBe("");
  });

  it("keeps the panel open while a change runs, so its result lands where it was sent", async () => {
    const change = deferred<void>();
    const onModel = vi.fn<ModelBinding["onModel"]>().mockReturnValue(change.promise);
    await render({ model: { onModel } });
    await click(trigger());
    await click(button("Claude Haiku 4.5", panel()!));
    // An outside tap, the trigger, and Escape all wait for Pi.
    await act(async () => { document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
    await click(trigger());
    await press(panel()!, "Escape");
    expect(panel()).not.toBeNull();
    // The pressed row keeps focus while it waits.
    expect(button("Claude Haiku 4.5", panel()!)!.getAttribute("aria-busy")).toBe("true");
    expect(button("GPT-5.6 Sol", panel()!)!.getAttribute("aria-disabled")).toBe("true");
    expect(button("GPT-5.6 Sol", panel()!)!.disabled).toBe(false);
    await click(button("GPT-5.6 Sol", panel()!));
    expect(onModel).toHaveBeenCalledOnce();
    await act(async () => { change.resolve(); });
    await settle();
    expect(panel()).toBeNull();
  });

  it("names the trigger by its visible text first", async () => {
    await render();
    expect(trigger().getAttribute("aria-label")).toBe("Claude Opus 5.5 High, change model and thinking level");
  });

  it("reports a failed model read inside the panel", async () => {
    await render({ model: { listModels: async () => { throw new Error("HTTP 404"); } } });
    await click(trigger());
    expect(panel()!.querySelector(".model-list [role=alert]")!.textContent).toBe("Models unavailable: HTTP 404");
  });
});
