// @vitest-environment happy-dom

import type { TemplateResult } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionStatus } from "../api";
import { isTemplateResult, templateText } from "../templateInspection.testSupport";
import { deepActiveElement, pressKey } from "./modalSurfaceTestSupport";
import { PromptEditor } from "./PromptEditor";
import { sessionCapabilities } from "./promptEditorTestSupport";

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("PromptEditor control rail", () => {
  it("offers one send control while the session is idle", () => {
    const rendered = templateText(render(editor()));

    expect(rendered).toContain("Send message");
    expect(rendered).not.toContain("Steer current response");
  });

  it("does not render resident Stop while runtime controls are available but the session is idle", () => {
    const rendered = templateText(render(editor({ capabilities: sessionCapabilities({ stoppable: false }) })));

    expect(rendered).toContain("Send message");
    expect(rendered).not.toContain("Stop current work");
    expect(rendered).not.toContain("Queue message");
  });

  it("puts Stop in the send slot and Queue beside it while the agent streams", () => {
    const rendered = templateText(render(editor({ canSteer: true, capabilities: sessionCapabilities({ stoppable: true }) })));

    expect(rendered).toContain("Stop current work");
    expect(rendered).toContain("Queue message");
    expect(rendered).not.toContain("Send message");
    expect(rendered).not.toContain("steer-confirm-button");
  });

  it("puts Stop in the send slot and queues without steering while history is compacting", () => {
    const rendered = templateText(render(editor({ isCompacting: true, capabilities: sessionCapabilities({ stoppable: true }) })));

    expect(rendered).toContain("Stop current work");
    expect(rendered).toContain("Queue message");
    expect(rendered).not.toContain("Send message");
    expect(rendered).not.toContain("Steer current response");
  });

  it("shows Stop without Send, Queue, or Steer when work is stoppable but follow-up delivery is unavailable", () => {
    const rendered = templateText(render(editor({ capabilities: sessionCapabilities({ stoppable: true }) })));

    expect(rendered).toContain("Stop current work");
    expect(rendered).not.toContain("Send message");
    expect(rendered).not.toContain("Queue message");
    expect(rendered).not.toContain("Steer current response");
  });

  it("queues the message when the Queue control is used mid-stream", async () => {
    const onSend = vi.fn();
    const composer = await mountEditor({ canSteer: true, capabilities: sessionCapabilities({ stoppable: true }), onSend });
    composer.replaceText("and then run the tests");

    button(composer, ".queue-button").click();

    expect(onSend).toHaveBeenCalledWith("and then run the tests", "followUp", undefined, undefined);
  });

  it("holding streaming Queue through the threshold reveals Steer without queueing on release or click", async () => {
    vi.useFakeTimers();
    const onSend = vi.fn();
    const composer = await mountEditor({ canSteer: true, capabilities: sessionCapabilities({ stoppable: true }), onSend });
    composer.replaceText("use a smaller patch");
    const queue = button(composer, ".queue-button");

    await openSteerByPointerHold(composer, queue);
    queue.dispatchEvent(pointerEvent("pointerup", { pointerId: 7, pointerType: "touch", button: 0, clientX: 10, clientY: 10 }));
    queue.click();

    expect(onSend).not.toHaveBeenCalled();
  });

  it("confirms the disclosed Steer action exactly once and returns focus to the draft", async () => {
    vi.useFakeTimers();
    const onSend = vi.fn();
    const composer = await mountEditor({ canSteer: true, capabilities: sessionCapabilities({ stoppable: true }), onSend });
    composer.replaceText("use a smaller patch");
    await openSteerByPointerHold(composer, button(composer, ".queue-button"));

    button(composer, ".steer-confirm-button").click();
    await composer.updateComplete;

    expect(onSend).toHaveBeenCalledExactlyOnceWith("use a smaller patch", "steer", undefined, undefined);
    expect(composer.shadowRoot?.querySelector(".steer-confirm-button")).toBeNull();
    expect(deepActiveElement()).toBe(composer.view?.contentDOM);
  });

  it("closes Steer on Escape or outside press without submitting and restores Queue focus only for Escape", async () => {
    vi.useFakeTimers();
    const onSend = vi.fn();
    const composer = await mountEditor({ canSteer: true, capabilities: sessionCapabilities({ stoppable: true }), onSend });
    const queue = button(composer, ".queue-button");
    await openSteerByPointerHold(composer, queue);

    pressKey(popover(composer), "Escape");
    await composer.updateComplete;
    await composer.updateComplete;

    expect(onSend).not.toHaveBeenCalled();
    expect(deepActiveElement()).toBe(queue);

    await openSteerByPointerHold(composer, queue);
    document.body.dispatchEvent(pointerEvent("pointerdown", { pointerId: 99, pointerType: "mouse", button: 0, clientX: 300, clientY: 300 }));
    await composer.updateComplete;

    expect(onSend).not.toHaveBeenCalled();
    expect(composer.shadowRoot?.querySelector(".steer-confirm-button")).toBeNull();
  });

  it("cancels a pending pointer hold when movement or cancellation wins", async () => {
    vi.useFakeTimers();
    const onSend = vi.fn();
    const composer = await mountEditor({ canSteer: true, capabilities: sessionCapabilities({ stoppable: true }), onSend });
    const queue = button(composer, ".queue-button");

    queue.dispatchEvent(pointerEvent("pointerdown", { pointerId: 8, pointerType: "touch", button: 0, clientX: 0, clientY: 0 }));
    queue.dispatchEvent(pointerEvent("pointermove", { pointerId: 8, pointerType: "touch", button: 0, clientX: 11, clientY: 0 }));
    vi.advanceTimersByTime(500);
    await composer.updateComplete;
    expect(composer.shadowRoot?.querySelector(".steer-confirm-button")).toBeNull();

    queue.dispatchEvent(pointerEvent("pointerdown", { pointerId: 9, pointerType: "touch", button: 0, clientX: 0, clientY: 0 }));
    queue.dispatchEvent(pointerEvent("pointercancel", { pointerId: 9, pointerType: "touch", button: 0, clientX: 0, clientY: 0 }));
    vi.advanceTimersByTime(500);
    await composer.updateComplete;

    expect(composer.shadowRoot?.querySelector(".steer-confirm-button")).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not arm secondary-button pointerdown and opens Steer once from context menu", async () => {
    vi.useFakeTimers();
    const onSend = vi.fn();
    const composer = await mountEditor({ canSteer: true, capabilities: sessionCapabilities({ stoppable: true }), onSend });
    const queue = button(composer, ".queue-button");

    queue.dispatchEvent(pointerEvent("pointerdown", { pointerId: 12, pointerType: "mouse", button: 2, clientX: 4, clientY: 4 }));
    vi.advanceTimersByTime(500);
    await composer.updateComplete;
    expect(composer.shadowRoot?.querySelector(".steer-confirm-button")).toBeNull();

    const menuEvent = mouseEvent("contextmenu", { button: 2, clientX: 4, clientY: 4 });
    queue.dispatchEvent(menuEvent);
    vi.advanceTimersByTime(500);
    await composer.updateComplete;

    expect(menuEvent.defaultPrevented).toBe(true);
    expect(composer.shadowRoot?.querySelectorAll(".steer-confirm-button")).toHaveLength(1);
    queue.click();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("supports short and held keyboard Queue activation without repeat or native-click duplication", async () => {
    vi.useFakeTimers();
    const onSend = vi.fn();
    const composer = await mountEditor({ canSteer: true, capabilities: sessionCapabilities({ stoppable: true }), onSend });
    composer.replaceText("keyboard path");
    const queue = button(composer, ".queue-button");

    const shortDown = keyEvent("keydown", " ");
    queue.dispatchEvent(shortDown);
    vi.advanceTimersByTime(499);
    queue.dispatchEvent(keyEvent("keyup", " "));
    queue.click();

    expect(shortDown.defaultPrevented).toBe(true);
    expect(onSend).toHaveBeenCalledExactlyOnceWith("keyboard path", "followUp", undefined, undefined);

    composer.replaceText("steer keyboard path");
    queue.dispatchEvent(keyEvent("keydown", "Enter"));
    queue.dispatchEvent(keyEvent("keydown", "Enter", { repeat: true }));
    vi.advanceTimersByTime(500);
    await composer.updateComplete;
    queue.dispatchEvent(keyEvent("keyup", "Enter"));
    queue.click();

    expect(composer.shadowRoot?.querySelectorAll(".steer-confirm-button")).toHaveLength(1);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("keeps compaction Queue plain for long press, keyboard hold, and context menu", async () => {
    vi.useFakeTimers();
    const onSend = vi.fn();
    const composer = await mountEditor({ isCompacting: true, capabilities: sessionCapabilities({ stoppable: true }), onSend });
    composer.replaceText("after compaction");
    const queue = button(composer, ".queue-button");

    expect(queue.classList.contains("has-steer")).toBe(false);
    expect(queue.getAttribute("aria-describedby")).toBeNull();
    queue.dispatchEvent(pointerEvent("pointerdown", { pointerId: 22, pointerType: "touch", button: 0, clientX: 0, clientY: 0 }));
    queue.dispatchEvent(keyEvent("keydown", "Enter"));
    const menuEvent = mouseEvent("contextmenu", { button: 2 });
    queue.dispatchEvent(menuEvent);
    vi.advanceTimersByTime(500);
    await composer.updateComplete;
    queue.click();

    expect(menuEvent.defaultPrevented).toBe(false);
    expect(composer.shadowRoot?.querySelector(".steer-confirm-button")).toBeNull();
    expect(onSend).toHaveBeenCalledExactlyOnceWith("after compaction", "followUp", undefined, undefined);
  });

  it("invalidates pending or open Steer state when streaming ends or the component disconnects", async () => {
    vi.useFakeTimers();
    const composer = await mountEditor({ canSteer: true, capabilities: sessionCapabilities({ stoppable: true }) });
    const queue = button(composer, ".queue-button");

    queue.dispatchEvent(pointerEvent("pointerdown", { pointerId: 30, pointerType: "touch", button: 0, clientX: 0, clientY: 0 }));
    composer.canSteer = false;
    await composer.updateComplete;
    vi.advanceTimersByTime(500);
    await composer.updateComplete;
    expect(composer.shadowRoot?.querySelector(".steer-confirm-button")).toBeNull();

    composer.canSteer = true;
    await composer.updateComplete;
    await openSteerByPointerHold(composer, button(composer, ".queue-button"));
    composer.canSteer = false;
    await composer.updateComplete;
    expect(composer.shadowRoot?.querySelector(".steer-confirm-button")).toBeNull();

    composer.canSteer = true;
    await composer.updateComplete;
    button(composer, ".queue-button").dispatchEvent(pointerEvent("pointerdown", { pointerId: 31, pointerType: "touch", button: 0, clientX: 0, clientY: 0 }));
    composer.remove();
    vi.advanceTimersByTime(500);
    expect(composer.shadowRoot?.querySelector(".steer-confirm-button")).toBeNull();
  });

  it("keeps Steer mutually exclusive with guidance and model choices", async () => {
    vi.useFakeTimers();
    const composer = await mountEditor({ canSteer: true, capabilities: sessionCapabilities({ stoppable: true }) });

    button(composer, ".guidance-trigger").click();
    await composer.updateComplete;
    expect(composer.shadowRoot?.querySelector("guidance-picker")).not.toBeNull();
    await openSteerByPointerHold(composer, button(composer, ".queue-button"));
    expect(composer.shadowRoot?.querySelector("guidance-picker")).toBeNull();

    button(composer, ".select-model").click();
    await composer.updateComplete;
    expect(composer.shadowRoot?.querySelector("composer-choice-list")).not.toBeNull();
    expect(composer.shadowRoot?.querySelector(".steer-confirm-button")).toBeNull();
  });

  it("keeps Stop invocable while Queue hold or Steer disclosure is active", async () => {
    vi.useFakeTimers();
    const onStop = vi.fn();
    const composer = await mountEditor({ canSteer: true, capabilities: sessionCapabilities({ stoppable: true, onStop }) });
    const queue = button(composer, ".queue-button");
    const stop = button(composer, ".stop-button");

    queue.dispatchEvent(pointerEvent("pointerdown", { pointerId: 40, pointerType: "touch", button: 0, clientX: 0, clientY: 0 }));
    stop.click();
    vi.advanceTimersByTime(500);
    await composer.updateComplete;
    stop.click();

    expect(onStop).toHaveBeenCalledTimes(2);
  });

  it("sends straight through when nothing is running", async () => {
    const onSend = vi.fn();
    const composer = await mountEditor({ onSend });
    composer.replaceText("start here");

    button(composer, ".send-button").click();

    expect(onSend).toHaveBeenCalledWith("start here", undefined, undefined, undefined);
  });

  it("rejects submit in stop-only state without calling onSend or clearing the draft", async () => {
    const onSend = vi.fn();
    const composer = await mountEditor({ capabilities: sessionCapabilities({ stoppable: true }), onSend });
    const attachment = { kind: "file" as const, mimeType: "text/plain", data: "aGVsbG8=", name: "note.txt" };
    composer.restoreSnapshot({ text: "keep this", attachments: [attachment], delivery: "folder" });
    await composer.updateComplete;
    await composer.draft?.updateComplete;

    const draft = requiredDraft(composer);
    expect(draft.disabled).toBe(false);
    expect(draft.submissionDisabled).toBe(false);
    expect(composer.shadowRoot?.querySelector(".attachment-chip")?.textContent).toContain("note.txt");

    pressEnter(composer);
    await composer.updateComplete;
    await composer.draft?.updateComplete;

    expect(onSend).not.toHaveBeenCalled();
    expect(composer.view?.state.doc.toString()).toBe("keep this");
    expect(composer.shadowRoot?.querySelector(".attachment-chip")?.textContent).toContain("note.txt");
    expect(composer.shadowRoot?.querySelector<HTMLInputElement>(".attachment-delivery input[value='folder']")?.checked).toBe(true);
  });

  it("keeps Stop invocable when Queue submission is busy", async () => {
    const onStop = vi.fn();
    const composer = await mountEditor({ canSteer: true, sending: true, capabilities: sessionCapabilities({ stoppable: true, onStop }) });

    const stop = button(composer, ".stop-button");
    const queue = button(composer, ".queue-button");

    expect(queue.disabled).toBe(true);
    expect(stop.disabled).toBe(false);
    stop.click();
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("accepts nothing from a session that cannot be used", async () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    const composer = await mountEditor({ disabled: true, canSteer: true, capabilities: sessionCapabilities({ stoppable: true, onStop }), onSend });
    composer.replaceText("too late");

    button(composer, ".queue-button").click();
    button(composer, ".stop-button").click();

    expect(onSend).not.toHaveBeenCalled();
    expect(onStop).not.toHaveBeenCalled();
  });
});

function editor(overrides: Partial<PromptEditor> = {}): PromptEditor {
  const composer = new PromptEditor();
  composer.status = status();
  Object.assign(composer, overrides);
  return composer;
}

async function mountEditor(overrides: Partial<PromptEditor> = {}): Promise<PromptEditor> {
  const composer = editor(overrides);
  document.body.append(composer);
  await composer.updateComplete;
  if (composer.view === undefined) throw new Error("Expected CodeMirror to mount");
  return composer;
}

function button(composer: PromptEditor, selector: string): HTMLButtonElement {
  const found = composer.shadowRoot?.querySelector<HTMLButtonElement>(selector);
  if (found === null || found === undefined) throw new Error(`Expected ${selector}`);
  return found;
}

function requiredDraft(composer: PromptEditor) {
  const draft = composer.draft;
  if (draft === undefined) throw new Error("Expected draft");
  return draft;
}

function pressEnter(composer: PromptEditor): void {
  composer.view?.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
}

async function openSteerByPointerHold(composer: PromptEditor, queue: HTMLButtonElement): Promise<void> {
  queue.dispatchEvent(pointerEvent("pointerdown", { pointerId: 7, pointerType: "touch", button: 0, clientX: 10, clientY: 10 }));
  vi.advanceTimersByTime(500);
  await composer.updateComplete;
  const opened = composer.shadowRoot?.querySelector("composer-popover");
  expect(opened).not.toBeNull();
  expect(opened?.textContent).toContain("Steer current response");
}

function popover(composer: PromptEditor): HTMLElement {
  return requiredElement(composer.shadowRoot?.querySelector<HTMLElement>("composer-popover"), "Steer popover");
}

function pointerEvent(type: string, init: PointerEventInit): Event {
  if (typeof PointerEvent === "function") return new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, ...init });
  const mouseInit: MouseEventInit = { bubbles: true, cancelable: true, composed: true };
  if (init.button !== undefined) mouseInit.button = init.button;
  if (init.clientX !== undefined) mouseInit.clientX = init.clientX;
  if (init.clientY !== undefined) mouseInit.clientY = init.clientY;
  const event = new MouseEvent(type, mouseInit);
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId ?? 1 },
    pointerType: { value: init.pointerType ?? "mouse" },
  });
  return event;
}

function mouseEvent(type: string, init: MouseEventInit = {}): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, ...init });
}

function keyEvent(type: string, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent(type, { key, bubbles: true, cancelable: true, composed: true, ...init });
}

function requiredElement<T extends Element>(element: T | null | undefined, description: string): T {
  if (element === null || element === undefined) throw new Error(`Expected ${description}`);
  return element;
}

function render(composer: PromptEditor): TemplateResult {
  const rendered: unknown = composer.render();
  if (!isTemplateResult(rendered)) throw new Error("expected the composer template");
  return rendered;
}

function status(): SessionStatus {
  return {
    sessionId: "session-1",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    model: { id: "gpt-5.6-sol", provider: "openai-codex" },
  };
}
