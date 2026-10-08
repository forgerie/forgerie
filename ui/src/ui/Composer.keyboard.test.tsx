// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime, type AppendMessage, type AssistantRuntime } from "@assistant-ui/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fromHistory, type TranscriptMessage } from "../transcript";
import { useThreadMessages } from "../useThreadMessages";
import { Composer } from "./Composer";
import type { AskBinding } from "./useAskMode";
import type { DialogBinding } from "./DialogLayer";

let root: Root;
let runtime: AssistantRuntime;
const past = fromHistory([{ role: "user", content: "older" }, { role: "assistant", content: "reply" }, { role: "user", content: "recent" }]).messages;
interface Props { messages?: readonly TranscriptMessage[]; onNew?: (message: AppendMessage) => Promise<void>; running?: boolean; disabled?: boolean; ask?: AskBinding; dialog?: DialogBinding; suggestions?: boolean }
function Fixture({ messages = past, onNew = async () => {}, running = false, disabled = false, ask, dialog, suggestions }: Props) {
  runtime = useExternalStoreRuntime({ messages: useThreadMessages(messages, running), onNew, isRunning: running, isDisabled: disabled });
  return <AssistantRuntimeProvider runtime={runtime}><Composer ask={ask} dialog={dialog} working={{ queue: running, steer: running }}
    commands={suggestions ? { catalog: { type: "ready", commands: [{ name: "review", source: "prompt", description: "Review changes" }, { name: "reload", source: "builtin", description: "Reload" }] }, onRetry: () => {} } : undefined} />
    <button type="button" id="outside">Outside</button><input id="search" />
  </AssistantRuntimeProvider>;
}
const render = (props: Props = {}) => act(async () => root.render(<Fixture {...props} />));
const input = () => document.querySelector<HTMLTextAreaElement>("textarea")!;
const type = (text: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input(), text);
  input().setSelectionRange(text.length, text.length);
  input().dispatchEvent(new Event("input", { bubbles: true }));
});
async function press(key: string, init: KeyboardEventInit = {}, target: HTMLElement = input()) {
  let event!: KeyboardEvent;
  await act(async () => {
    event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, ...init });
    // happy-dom treats left Alt as AltGraph; browsers distinguish them.
    if (init.altKey) Object.defineProperty(event, "getModifierState", { value: (modifier: string) => modifier === "Control" || modifier === "Alt" });
    target.dispatchEvent(event);
  });
  return event;
}
const touch = () => {
  const original = window.matchMedia.bind(window);
  vi.spyOn(window, "matchMedia").mockImplementation((query) => {
    const media = original(query);
    if (query === "(pointer: coarse)") Object.defineProperty(media, "matches", { value: true });
    return media;
  });
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("composer keyboard affordances", () => {
  it("recalls newest first, then restores the exact draft and caret without sending", async () => {
    const onNew = vi.fn(async () => {});
    await render({ onNew }); await type("my draft"); input().setSelectionRange(0, 0);
    await press("ArrowUp"); expect(input().value).toBe("recent"); expect(input().selectionStart).toBe(0);
    await press("ArrowUp"); expect(input().value).toBe("older");
    input().setSelectionRange(5, 5); await press("ArrowDown"); expect(input().value).toBe("recent");
    await press("ArrowDown"); expect(input().value).toBe("my draft"); expect(input().selectionStart).toBe(0);
    expect(onNew).not.toHaveBeenCalled();
  });
  it("leaves editing, selected text, modifiers, and wrapped-line caret movement alone", async () => {
    await render(); await type("draft");
    expect((await press("ArrowUp")).defaultPrevented).toBe(false);
    input().setSelectionRange(0, 3); expect((await press("ArrowUp")).defaultPrevented).toBe(false);
    input().setSelectionRange(0, 0); expect((await press("ArrowUp", { shiftKey: true })).defaultPrevented).toBe(false);
    expect((await press("ArrowUp", { ctrlKey: true })).defaultPrevented).toBe(false);
    await type(""); await press("ArrowUp");
    input().setSelectionRange(2, 2); expect((await press("ArrowDown")).defaultPrevented).toBe(false);
    expect(input().value).toBe("recent");
  });
  it("leaves history when a recalled prompt is edited or programmatically replaced", async () => {
    await render(); await press("ArrowUp"); await type("edited prompt");
    await press("ArrowDown"); expect(input().value).toBe("edited prompt");
    input().setSelectionRange(0, 0); await press("ArrowUp");
    await act(async () => runtime.thread.composer.setText("restored queue"));
    await press("ArrowDown"); expect(input().value).toBe("restored queue");
  });
  it("lets slash suggestions own arrows before history", async () => {
    await render({ suggestions: true }); await type("/re");
    await vi.waitFor(() => expect(document.querySelectorAll('[role="option"]').length).toBe(2));
    await press("ArrowUp"); expect(input().value).toBe("/re");
    await press("Enter"); expect(input().value).toMatch(/^\/re(?:view|load) /);
  });
  it("does not recall prompts into asks, input dialogs, or a disabled input", async () => {
    const ask: AskBinding = { ask: { askId: "a", askedAt: "now", questions: [{ id: "q", question: "Which?", options: [] }] }, phase: { type: "answering" }, offline: false, onSubmit: () => {}, onDismiss: () => {}, onChat: async () => {} };
    await render({ ask }); await press("ArrowUp"); expect(input().value).toBe("");
    const dialog: DialogBinding = { dialog: { dialogId: "d", kind: "input", title: "Name?", askedAt: "now" }, count: 1, phase: { type: "answering" }, offline: false, onAnswer: () => {}, onCancel: () => {} };
    await render({ dialog }); await press("ArrowUp"); expect(input().value).toBe("");
    await render({ disabled: true }); await press("ArrowUp"); expect(input().value).toBe("");
  });
  it("focuses the composer with Ctrl+Alt+I, without replacing its draft", async () => {
    await render(); await type("keep me"); const outside = document.getElementById("outside")!; outside.focus();
    await press("i", { ctrlKey: true, altKey: true }, outside);
    expect(document.activeElement).toBe(input()); expect(input().value).toBe("keep me");
    expect(input().getAttribute("aria-keyshortcuts")).toBe("Control+Alt+I");
  });
  it("does not focus a background composer through a modal or consume repeated keys", async () => {
    await render(); const outside = document.getElementById("outside")!; outside.focus();
    expect((await press("i", { ctrlKey: true, altKey: true, repeat: true }, outside)).defaultPrevented).toBe(false);
    const modal = document.createElement("dialog"); modal.setAttribute("open", ""); document.body.append(modal);
    await press("i", { ctrlKey: true, altKey: true }, outside); expect(document.activeElement).toBe(outside);
  });
  it("leaves AltGraph text input alone", async () => {
    await render(); const outside = document.getElementById("outside")!; outside.focus();
    let event!: KeyboardEvent;
    await act(async () => {
      event = new KeyboardEvent("keydown", { key: "i", ctrlKey: true, altKey: true, bubbles: true, cancelable: true });
      Object.defineProperty(event, "getModifierState", { value: (modifier: string) => modifier === "AltGraph" });
      outside.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false); expect(document.activeElement).toBe(outside);
  });
  it("sends Enter despite touch autocapitalization's phantom Shift", async () => {
    touch(); const onNew = vi.fn(async () => {}); await render({ onNew }); await type("send me");
    await press("Enter", { shiftKey: true }); expect(onNew).toHaveBeenCalledOnce(); expect(input().value).toBe("");
  });
  it("inserts a selected newline when Android drops a held Shift, then releases it", async () => {
    touch(); const onNew = vi.fn(async () => {}); await render({ onNew }); await type("abc def"); input().setSelectionRange(3, 7);
    await press("Shift"); await press("Unidentified", { keyCode: 229 }); await press("Enter");
    expect(onNew).not.toHaveBeenCalled(); expect(input().value).toBe("abc\n"); expect(input().selectionStart).toBe(4);
    await act(async () => input().dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", bubbles: true })));
    await press("Enter"); expect(onNew).toHaveBeenCalledOnce();
  });
  it("trusts Shift flags after seeing a hardware Shift and clears held Shift on blur", async () => {
    touch(); const onNew = vi.fn(async () => {}); await render({ onNew }); await type("draft");
    await press("Shift"); await act(async () => input().dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", bubbles: true })));
    expect((await press("Enter", { shiftKey: true })).defaultPrevented).toBe(false); expect(onNew).not.toHaveBeenCalled();
    input().focus(); await press("Shift"); await act(async () => input().blur()); await press("Enter"); expect(onNew).toHaveBeenCalledOnce();
  });
  it("keeps IME confirmation and Alt+Enter out of submission", async () => {
    const onNew = vi.fn(async () => {}); await render({ onNew }); await type("draft");
    await press("Enter", { isComposing: true }); await press("Enter", { keyCode: 229 }); await press("Enter", { altKey: true });
    await act(async () => input().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
    await press("Enter"); expect(onNew).not.toHaveBeenCalled();
    await act(async () => input().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
    await press("Enter"); expect(onNew).toHaveBeenCalledOnce();
  });
  it("keeps normalized Ctrl+Shift+Enter steering and phantom-Shift Enter queueing", async () => {
    touch(); const onNew = vi.fn<(message: AppendMessage) => Promise<void>>().mockResolvedValue(undefined);
    await render({ onNew, running: true }); await type("queue me"); await press("Enter", { shiftKey: true });
    expect(onNew.mock.calls[0]?.[0].steer).toBeFalsy();
    await type("steer me"); await press("Shift"); await press("Enter", { ctrlKey: true });
    expect(onNew.mock.calls[1]?.[0].steer).toBe(true);
  });
  it("uses normalized Enter for ask advancement and input dialogs", async () => {
    touch(); const submit = vi.fn(); const answer = vi.fn();
    const ask: AskBinding = { ask: { askId: "a", askedAt: "now", questions: [{ id: "q", question: "Which?", options: [] }] }, phase: { type: "answering" }, offline: false, onSubmit: submit, onDismiss: () => {}, onChat: async () => {} };
    await render({ ask }); await type("an answer"); await press("Enter", { shiftKey: true }); expect(submit).toHaveBeenCalledOnce();
    await render({ dialog: { dialog: { dialogId: "d", kind: "input", title: "Name?", askedAt: "now" }, count: 1, phase: { type: "answering" }, offline: false, onAnswer: answer, onCancel: () => {} } });
    await type("a name"); await press("Enter", { shiftKey: true }); expect(answer).toHaveBeenCalledWith("a name");
  });
});
