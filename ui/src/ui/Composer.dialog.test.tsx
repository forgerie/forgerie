// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime, type AppendMessage } from "@assistant-ui/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingDialog } from "../contracts";
import type { DialogBinding } from "./DialogLayer";
import type { AskBinding } from "./useAskMode";
import { Thread } from "./Thread";
import { useThreadMessages } from "../useThreadMessages";
import { createChatDraft, type ChatDraft } from "../chatDraft";
import type { ComposerInputElement } from "./ComposerEditor";

let root: Root;
const confirm: PendingDialog = { dialogId: "c", kind: "confirm", title: "Delete the branch?", message: "This cannot be undone.", askedAt: "2026-10-05T12:00:00Z" };
const select: PendingDialog = { dialogId: "s", kind: "select", title: "Pick a target", options: ["staging", "production"], askedAt: "2026-10-05T12:00:00Z" };
const input: PendingDialog = { dialogId: "i", kind: "input", title: "Name the release", placeholder: "v1.2.3", askedAt: "2026-10-05T12:00:00Z" };
const ask: AskBinding = { ask: { askId: "a", askedAt: "now", questions: [{ id: "q", question: "Which tests?", options: [] }] },
  phase: { type: "answering" }, offline: false, onChat: async () => {}, onDismiss: () => {}, onSubmit: () => {} };

interface Props { dialog?: Partial<DialogBinding> | null; ask?: AskBinding; onNew?: (message: AppendMessage) => Promise<void>; chatDraft?: ChatDraft; commands?: boolean }
function binding(overrides: Partial<DialogBinding> = {}): DialogBinding {
  return { dialog: confirm, count: 1, phase: { type: "answering" }, offline: false, onAnswer: () => {}, onCancel: () => {}, ...overrides };
}
function Fixture({ dialog = {}, ask, onNew = async () => {}, chatDraft, commands = false }: Props) {
  const runtime = useExternalStoreRuntime({ messages: useThreadMessages([], false), onNew, isRunning: false });
  return <AssistantRuntimeProvider runtime={runtime}><Thread ask={ask} dialog={dialog === null ? undefined : binding(dialog)} chatDraft={chatDraft}
    commands={commands ? { catalog: { type: "ready", commands: [{ name: "reload", source: "builtin", description: "Reload" }] }, onRetry: () => {} } : undefined} /></AssistantRuntimeProvider>;
}
const render = (props: Props = {}) => act(async () => root.render(<Fixture {...props} />));
const layer = () => document.querySelector<HTMLElement>(".dialog-layer");
const textarea = () => document.querySelector<ComposerInputElement>(".composer [data-composer-input]")!;
const button = (name: string, scope: ParentNode = document) => [...scope.querySelectorAll<HTMLButtonElement>("button")]
  .find((node) => node.textContent?.trim() === name || node.getAttribute("aria-label") === name);
const click = (node: HTMLElement | undefined) => act(async () => node!.click());
function type(text: string) {
  return act(async () => {
    textarea().value = text;
    textarea().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const press = (key: string) => act(async () => {
  textarea().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }));
});
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("extension dialogs in the one input bar", () => {
  it("shows a confirm above the input, names the extension, and answers Yes or No", async () => {
    const onAnswer = vi.fn();
    await render({ dialog: { onAnswer } });
    expect(layer()!.querySelector(".dialog-source")!.textContent).toBe("Extension");
    expect(layer()!.querySelector("h2")!.textContent).toBe("Delete the branch?");
    expect(layer()!.textContent).toContain("This cannot be undone.");
    expect(document.querySelector(".sr-only[role=status]")!.textContent).toBe("An extension asks: Delete the branch?");
    expect(document.querySelectorAll(".composer [data-composer-input]")).toHaveLength(1);
    await click(button("Yes", layer()!));
    expect(onAnswer).toHaveBeenLastCalledWith(true);
    await click(button("No", layer()!));
    expect(onAnswer).toHaveBeenLastCalledWith(false);
  });

  it("keeps the input a chat input for a confirm, so typing still sends a message", async () => {
    const onNew = vi.fn<(message: AppendMessage) => Promise<void>>().mockResolvedValue(undefined);
    await render({ onNew });
    expect(textarea().placeholder).toBe("Send a message...");
    await type("why does it ask?");
    await press("Enter");
    expect(onNew).toHaveBeenCalledOnce();
  });

  it("answers a select with the chosen option", async () => {
    const onAnswer = vi.fn();
    await render({ dialog: { dialog: select, onAnswer } });
    await click(button("production", layer()!));
    expect(onAnswer).toHaveBeenCalledWith("production");
  });

  it("takes the input for an input dialog, sends the text as typed, and parks the chat draft", async () => {
    const onAnswer = vi.fn();
    const onNew = vi.fn<(message: AppendMessage) => Promise<void>>().mockResolvedValue(undefined);
    await render({ dialog: null, onNew });
    await type("my unsent chat");
    await render({ dialog: { dialog: input, onAnswer }, onNew });
    expect(textarea().value).toBe("");
    expect(textarea().placeholder).toBe("v1.2.3");
    expect(button("Send message")).toBeUndefined();
    await type("!not a shell command");
    expect(document.querySelector(".composer-hint")).toBeNull();
    await press("Enter");
    expect(onAnswer).toHaveBeenCalledWith("!not a shell command");
    expect(onNew).not.toHaveBeenCalled();
    await render({ dialog: null, onNew });
    expect(textarea().value).toBe("my unsent chat");
  });

  it("names the field as the answer and ties it to the question", async () => {
    await render({ dialog: { dialog: input } });
    expect(textarea().getAttribute("aria-label")).toBe("Answer");
    const described = textarea().getAttribute("aria-describedby");
    expect(described && document.getElementById(described)?.textContent).toBe("Name the release");
  });

  it("keeps the slash list out of an input dialog's answer", async () => {
    await render({ dialog: { dialog: input }, commands: true });
    await type("/re");
    expect(document.querySelector(".command-popover")).toBeNull();
  });

  it("does not pull a touch keyboard up after a tapped choice, unless the reader was typing", async () => {
    await render({ dialog: { dialog: select } });
    (document.activeElement as HTMLElement | null)?.blur();
    await click(button("production", layer()!));
    expect(document.activeElement).not.toBe(textarea());
    textarea().focus();
    await act(async () => { button("staging", layer()!)!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
    await click(button("staging", layer()!));
    expect(document.activeElement).toBe(textarea());
  });

  it("answers the next dialog at once, even while the last answer is on its way", async () => {
    const onAnswer = vi.fn();
    await render({ dialog: { dialog: select, onAnswer, phase: { type: "answering" } } });
    expect(button("staging", layer()!)!.disabled).toBe(false);
  });

  it("shows a dialog this client cannot draw, so it can still be skipped", async () => {
    const onCancel = vi.fn();
    await render({ dialog: { dialog: { dialogId: "u", kind: "unknown", title: "Pick a colour", askedAt: "now" }, onCancel } });
    expect(layer()!.textContent).toContain("This client cannot show this kind of question");
    await click(button("Skip", layer()!));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("refuses an input answer longer than the daemon accepts", async () => {
    const onAnswer = vi.fn();
    await render({ dialog: { dialog: input, onAnswer } });
    await type("x".repeat(4001));
    expect(layer()!.querySelector("[role=alert]")!.textContent).toMatch(/exceeds 4000 characters/);
    expect(button("Send answer")!.disabled).toBe(true);
    await press("Enter");
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("skips without an answer", async () => {
    const onCancel = vi.fn();
    await render({ dialog: { onCancel } });
    await click(button("Skip", layer()!));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("counts open dialogs and shows the daemon's countdown", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-10-05T12:00:00Z"), toFake: ["Date", "setInterval", "clearInterval"] });
    await render({ dialog: { dialog: { ...confirm, timeoutAt: "2026-10-05T12:01:30Z" }, count: 3 } });
    expect(layer()!.querySelector(".ask-count")!.textContent).toBe("1 of 3");
    expect(layer()!.querySelector(".dialog-countdown")!.textContent).toBe("Closes in 1m 30s");
    await act(async () => { vi.advanceTimersByTime(31_000); });
    expect(layer()!.querySelector(".dialog-countdown")!.textContent).toBe("Closes in 59s");
  });

  it("disables answers while one is on its way or offline, and shows the daemon's refusal", async () => {
    await render({ dialog: { phase: { type: "sending" } } });
    expect(button("Yes", layer()!)!.disabled).toBe(true);
    expect(button("Skip", layer()!)!.disabled).toBe(true);
    expect(layer()!.getAttribute("aria-busy")).toBe("true");
    await render({ dialog: { offline: true } });
    expect(button("Yes", layer()!)!.disabled).toBe(true);
    await render({ dialog: { dialog: select, phase: { type: "failed", message: "Answer must be one of the offered options" } } });
    expect(layer()!.querySelector("[role=alert]")!.textContent).toBe("Answer must be one of the offered options");
  });

  it("lets an open ask go first, and says a dialog waits behind it", async () => {
    const chatDraft = createChatDraft(() => undefined);
    await render({ ask, dialog: { dialog: input }, chatDraft });
    expect(layer()).toBeNull();
    expect(document.querySelector(".ask h2")!.textContent).toBe("Which tests?");
    expect(document.querySelector(".composer-hint")!.textContent).toContain("An extension also asks something");
    expect(document.querySelector(".composer > [role=status]")!.textContent).toContain("An extension also asks something");
  });
});
