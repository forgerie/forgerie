// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime, type AssistantRuntime, type AttachmentAdapter } from "@assistant-ui/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Composer, type ShellBinding } from "./Composer";
import type { ComposerSessionKeys } from "./useComposerKeyboard";
import type { AskBinding } from "./useAskMode";
import { createAttachmentAdapter } from "../attachments";
import { ImageViewerProvider } from "./ImageViewer";
import { useThreadMessages } from "../useThreadMessages";

let root: Root;
let runtime: AssistantRuntime;
interface Props { sessionKeys?: ComposerSessionKeys; disabled?: boolean; shell?: ShellBinding; suggestions?: boolean; ask?: AskBinding; attachments?: AttachmentAdapter }
function Fixture({ sessionKeys, disabled, shell, suggestions, ask, attachments }: Props) {
  runtime = useExternalStoreRuntime({ messages: useThreadMessages([], false), onNew: async () => {}, isDisabled: disabled,
    ...(attachments ? { adapters: { attachments } } : {}) });
  return <AssistantRuntimeProvider runtime={runtime}><ImageViewerProvider><Composer sessionKeys={sessionKeys} shell={shell} ask={ask}
    commands={suggestions ? { catalog: { type: "ready", commands: [{ name: "tree", source: "builtin" }] }, onRetry: () => {} } : undefined} />
    <button id="outside">Outside</button></ImageViewerProvider></AssistantRuntimeProvider>;
}
const render = (props: Props) => act(async () => root.render(<Fixture {...props} />));
const input = () => document.querySelector<HTMLTextAreaElement>("textarea")!;
const type = (text: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input(), text);
  input().dispatchEvent(new Event("input", { bubbles: true }));
});
async function press(key = "Escape", init: KeyboardEventInit = {}) {
  let event!: KeyboardEvent;
  await act(async () => {
    event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    input().dispatchEvent(event);
  });
  return event;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const actions = (doubleEscapeAction?: "tree" | "fork" | "none"): ComposerSessionKeys => ({ doubleEscapeAction, onDoubleEscapeAction: vi.fn() });
describe("composer Escape precedence and timing", () => {
  it.each([undefined, "tree", "fork"] as const)("runs %s on two genuine empty presses within 500 ms", async (action) => {
    let now = 1_000; vi.spyOn(Date, "now").mockImplementation(() => now);
    const binding = actions(action); await render({ sessionKeys: binding });
    expect((await press()).defaultPrevented).toBe(true);
    expect(binding.onDoubleEscapeAction).not.toHaveBeenCalled();
    now += 499; await press();
    expect(binding.onDoubleEscapeAction).toHaveBeenCalledExactlyOnceWith(action ?? "tree");
    await press(); expect(binding.onDoubleEscapeAction).toHaveBeenCalledOnce();
  });
  it("requires a new pair at the 500 ms boundary and does nothing when set to none", async () => {
    let now = 1_000; vi.spyOn(Date, "now").mockImplementation(() => now);
    const binding = actions(); await render({ sessionKeys: binding }); await press();
    now += 500; await press(); expect(binding.onDoubleEscapeAction).not.toHaveBeenCalled();
    now += 1; await press(); expect(binding.onDoubleEscapeAction).toHaveBeenCalledOnce();
    binding.doubleEscapeAction = "none"; await render({ sessionKeys: binding });
    await press(); await press(); expect(binding.onDoubleEscapeAction).toHaveBeenCalledOnce();
  });
  it("keeps non-empty text and never opens a tree without a session binding", async () => {
    const binding = actions(); await render({ sessionKeys: binding }); await type("draft");
    await press(); await press(); expect(binding.onDoubleEscapeAction).not.toHaveBeenCalled(); expect(input().value).toBe("draft");
    await type(""); await render({}); await press(); await press();
    expect(binding.onDoubleEscapeAction).not.toHaveBeenCalled();
  });
  it.each([{ repeat: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }])("does not count a repeated or modified Escape: %j", async (init) => {
    const binding = actions(); await render({ sessionKeys: binding });
    await press(); await press("Escape", init); await press();
    expect(binding.onDoubleEscapeAction).not.toHaveBeenCalled();
  });
  it("resets after editing, another key, blur, composition, disconnect, and a changed action", async () => {
    const binding = actions(); await render({ sessionKeys: binding });
    await press(); await type("x"); await type(""); await press(); expect(binding.onDoubleEscapeAction).not.toHaveBeenCalled();
    await press("ArrowLeft"); await press(); expect(binding.onDoubleEscapeAction).not.toHaveBeenCalled();
    input().focus(); await act(async () => input().blur()); await press(); expect(binding.onDoubleEscapeAction).not.toHaveBeenCalled();
    await act(async () => input().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
    await press(); expect(binding.onDoubleEscapeAction).not.toHaveBeenCalled();
    await act(async () => input().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
    await press(); expect(binding.onDoubleEscapeAction).not.toHaveBeenCalled();
    await render({ sessionKeys: binding, disabled: true }); await press();
    await render({ sessionKeys: binding }); await press(); expect(binding.onDoubleEscapeAction).not.toHaveBeenCalled();
    binding.doubleEscapeAction = "fork"; await render({ sessionKeys: binding }); await press();
    expect(binding.onDoubleEscapeAction).not.toHaveBeenCalled(); await press();
    expect(binding.onDoubleEscapeAction).toHaveBeenCalledExactlyOnceWith("fork");
  });
  it("does not carry an idle Escape through an IME-marked key without composition events", async () => {
    const binding = actions(); await render({ sessionKeys: binding });
    await press(); await press("Escape", { isComposing: true }); await press();
    expect(binding.onDoubleEscapeAction).not.toHaveBeenCalled();
  });
  it("closes suggestions before Stop or a tree action", async () => {
    const binding = { ...actions(), onStop: vi.fn() };
    await render({ sessionKeys: binding, suggestions: true }); await type("/");
    await vi.waitFor(() => expect(document.querySelector('[role="option"]')).not.toBeNull());
    await press(); expect(binding.onStop).not.toHaveBeenCalled(); expect(binding.onDoubleEscapeAction).not.toHaveBeenCalled(); expect(input().value).toBe("/");
    await type(""); await press(); expect(binding.onStop).toHaveBeenCalledOnce(); expect(binding.onDoubleEscapeAction).not.toHaveBeenCalled();
  });
  it("clears a shell draft without submitting or arming double Escape", async () => {
    const binding = actions(); const onRun = vi.fn(async () => {});
    await render({ sessionKeys: binding, shell: { availability: { type: "ready" }, onRun } }); await type("!pwd");
    await press(); expect(input().value).toBe(""); expect(onRun).not.toHaveBeenCalled();
    await press(); expect(binding.onDoubleEscapeAction).not.toHaveBeenCalled();
    await press(); expect(binding.onDoubleEscapeAction).toHaveBeenCalledExactlyOnceWith("tree");
  });
  it("does not open a tree behind a foreground modal", async () => {
    const binding = actions(); await render({ sessionKeys: binding });
    const modal = document.createElement("dialog"); modal.setAttribute("open", ""); document.body.append(modal);
    await press(); await press(); expect(binding.onDoubleEscapeAction).not.toHaveBeenCalled(); modal.remove();
    await press(); expect(binding.onDoubleEscapeAction).not.toHaveBeenCalled();
  });
  it("does not treat an empty ask answer as an idle chat composer", async () => {
    const binding = actions(); await render({ sessionKeys: binding }); await press();
    const ask: AskBinding = { ask: { askId: "a", askedAt: "now", questions: [{ id: "q", question: "Which?", options: [] }] }, phase: { type: "answering" }, offline: false, onSubmit: () => {}, onDismiss: () => {}, onChat: async () => {} };
    await render({ sessionKeys: binding, ask }); await press(); await press();
    expect(binding.onDoubleEscapeAction).not.toHaveBeenCalled();
    await render({ sessionKeys: binding }); await press(); expect(binding.onDoubleEscapeAction).not.toHaveBeenCalled();
  });
  it("does not open the tree from a message with an attachment, or carry a pending press across attachment changes", async () => {
    const binding = actions(); const adapter = createAttachmentAdapter(async () => ({ path: ".forgerie/attachments/a.txt", mimeType: "text/plain", size: 2 }));
    await render({ sessionKeys: binding, attachments: adapter }); await press();
    await act(async () => runtime.thread.composer.addAttachment(new File(["hi"], "a.txt", { type: "text/plain" })));
    await press(); await press(); expect(binding.onDoubleEscapeAction).not.toHaveBeenCalled();
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Remove a.txt"]')!.click()); await press();
    expect(binding.onDoubleEscapeAction).not.toHaveBeenCalled(); adapter.dispose();
  });
});
