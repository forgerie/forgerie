// @vitest-environment happy-dom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime, type AppendMessage, type AssistantRuntime, type ThreadMessageLike } from "@assistant-ui/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAttachmentAdapter, type SaveAttachment } from "../attachments";
import type { PendingAsk } from "../contracts";
import { Thread } from "./Thread";
import { sendMessage } from "../sendMessage";
import type { ComposerInputElement } from "./ComposerEditor";

let root: Root;
let runtime: AssistantRuntime;
let send: (message: AppendMessage) => Promise<void>;
let save: ReturnType<typeof vi.fn<SaveAttachment>>;
const messages: ThreadMessageLike[] = [];
const ask: PendingAsk = { askId: "ask", askedAt: "now", questions: [{ id: "answer", question: "Which file?", options: [] }] };
function Fixture({ pendingAsk, offline = false }: { pendingAsk?: PendingAsk; offline?: boolean }) {
  const [adapter] = useState(() => createAttachmentAdapter(save));
  useEffect(() => () => adapter.dispose(), [adapter]);
  runtime = useExternalStoreRuntime({ messages, convertMessage: (message) => message, onNew: (message: AppendMessage) => send(message), adapters: { attachments: adapter }, isDisabled: offline, isSendDisabled: offline });
  return <AssistantRuntimeProvider runtime={runtime}><Thread ask={pendingAsk && { ask: pendingAsk, phase: { type: "answering" }, offline,
    onSubmit: () => { throw new Error("Attachments must not be submitted as answers"); }, onDismiss: () => {}, onChat: async () => { throw new Error("Use runtime.send for attachments"); } }} /></AssistantRuntimeProvider>;
}
const render = (props: { pendingAsk?: PendingAsk; offline?: boolean } = {}) => act(async () => root.render(<Fixture {...props} />));
const label = (text: string) => document.querySelector<HTMLButtonElement>(`[aria-label="${text}"]`);
const input = () => document.querySelector<ComposerInputElement>("[data-composer-input]")!;
const add = (file = new File(["notes"], "notes.txt", { type: "text/plain" })) => act(async () => runtime.thread.composer.addAttachment(file));
const click = (element: HTMLElement) => act(async () => element.click());
beforeEach(() => {
  messages.length = 0;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  save = vi.fn<SaveAttachment>().mockResolvedValue({ path: ".forgerie/attachments/notes.txt", mimeType: "text/plain", size: 5 });
  send = vi.fn().mockResolvedValue(undefined);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe("assistant-ui attachment composer", () => {
  it("shows a persisted image-only message without an empty text bubble", async () => {
    messages.push({ id: "image-only", role: "user", content: [{ type: "text", text: "" }], attachments: [{
      id: "image", type: "image", name: "Image", status: { type: "complete" },
      content: [{ type: "image", image: "data:image/png;base64,aGk=" }],
    }] });
    await render();
    expect(document.querySelectorAll(".message-attachments .attachment-image")).toHaveLength(1);
    expect(document.querySelector(".user-bubble")).toBeNull();
  });
  it("adds and removes a named chip with no upload until send", async () => {
    await render(); await add();
    expect(document.querySelectorAll(".attachment")).toHaveLength(1);
    expect(document.querySelector(".attachment-name")?.textContent).toBe("notes.txt");
    expect(save).not.toHaveBeenCalled();
    await click(label("Remove notes.txt")!);
    expect(document.querySelectorAll(".attachment")).toHaveLength(0);
    expect(save).not.toHaveBeenCalled();
  });
  it("accepts pasted and dropped files through the library input handlers", async () => {
    await render();
    const clipboard = new DataTransfer(); clipboard.items.add(new File(["image"], "paste.png", { type: "image/png" }));
    await act(async () => input().dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: clipboard })));
    const transfer = new DataTransfer(); transfer.items.add(new File(["notes"], "dropped.txt", { type: "text/plain" }));
    // happy-dom does not report the browser's Files type for file drags.
    Object.defineProperty(transfer, "types", { value: ["Files"] });
    // happy-dom's DragEvent does not implement dataTransfer.
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: transfer });
    await act(async () => document.querySelector(".composer-shell")!.dispatchEvent(drop));
    expect(runtime.thread.composer.getState().attachments.map((file) => file.name)).toEqual(["paste.png", "dropped.txt"]);
    expect(save).not.toHaveBeenCalled();
  });
  it("sends an attachment-only message through the real runtime", async () => {
    await render(); await add();
    expect(label("Send message")?.disabled).toBe(false);
    await click(label("Send message")!);
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    const received = vi.mocked(send).mock.calls[0]![0];
    expect(received.content).toEqual([]);
    expect(received.attachments?.[0]?.content).toEqual([{ type: "text", text: "@.forgerie/attachments/notes.txt" }]);
    expect(save).toHaveBeenCalledOnce();
  });
  it("returns the file and draft after an upload fails, and retries only on an explicit send", async () => {
    save.mockRejectedValueOnce(new Error("Disk full"));
    await render(); await add(); await act(async () => runtime.thread.composer.setText("draft"));
    await click(label("Send message")!);
    await vi.waitFor(() => expect(runtime.thread.composer.getState().attachments).toHaveLength(1));
    expect(input().value).toBe("draft");
    expect(document.body.textContent).toContain("Disk full");
    expect(send).not.toHaveBeenCalled();
    await click(label("Send message")!);
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledTimes(2);
  });
  it("restores completed attachments and text after a prompt refusal without uploading again", async () => {
    const report = vi.fn();
    const deliver = vi.fn().mockRejectedValueOnce(new Error("Model unavailable")).mockResolvedValue(undefined);
    send = (message) => sendMessage(message, deliver, () => runtime.thread.composer, report);
    await render(); await add(); await act(async () => runtime.thread.composer.setText("draft"));
    await click(label("Send message")!);
    await vi.waitFor(() => expect(report).toHaveBeenCalledOnce());
    expect(input().value).toBe("draft");
    expect(runtime.thread.composer.getState().attachments).toHaveLength(1);
    expect(runtime.thread.composer.getState().attachments[0]?.status.type).toBe("complete");
    expect(save).toHaveBeenCalledOnce();
    await click(label("Send message")!);
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith(expect.stringContaining("Check the transcript"));
  });
  it("keeps new text typed before a failed prompt returns", async () => {
    let refuse!: (error: Error) => void;
    const deliver = () => new Promise<void>((_resolve, reject) => { refuse = reject; });
    send = (message) => sendMessage(message, deliver, () => runtime.thread.composer, () => {});
    await render(); await add(); await act(async () => runtime.thread.composer.setText("first draft"));
    await click(label("Send message")!);
    await vi.waitFor(() => expect(refuse).toBeDefined());
    await act(async () => runtime.thread.composer.setText("second draft"));
    await act(async () => refuse(new Error("Lost acknowledgement")));
    expect(input().value).toBe("first draft\nsecond draft");
    expect(runtime.thread.composer.getState().attachments).toHaveLength(1);
  });
  it("cancels an upload and does not deliver a late result", async () => {
    let finish!: (value: { path: string; mimeType: string; size: number }) => void;
    save.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await render(); await add(); await click(label("Send message")!);
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    await act(async () => runtime.thread.composer.cancel());
    expect(save.mock.calls[0]?.[1]?.aborted).toBe(true);
    await act(async () => finish({ path: ".forgerie/attachments/late.txt", mimeType: "text/plain", size: 5 }));
    expect(send).not.toHaveBeenCalled();
    expect(runtime.thread.composer.getState().attachments).toHaveLength(1);
  });
  it("aborts preparation when the session unmounts and cannot send into the next session", async () => {
    let finish!: (value: { path: string; mimeType: string; size: number }) => void;
    save.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await render(); await add(); await click(label("Send message")!);
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    await act(async () => root.render(<Fixture key="next-session" />));
    expect(save.mock.calls[0]?.[1]?.aborted).toBe(true);
    await act(async () => finish({ path: ".forgerie/attachments/late.txt", mimeType: "text/plain", size: 5 }));
    expect(send).not.toHaveBeenCalled();
    expect(runtime.thread.composer.getState().attachments).toHaveLength(0);
  });
  it("routes files in ask mode to chat, retains one input, and keeps an unsent file when the ask closes", async () => {
    await render(); await act(async () => runtime.thread.composer.setText("old draft"));
    await render({ pendingAsk: ask }); await add();
    expect(document.querySelectorAll("[data-composer-input]")).toHaveLength(1);
    expect(document.body.textContent).toContain("Attachments run as chat messages");
    const sendChat = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Send message")!;
    await click(sendChat);
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    await render();
    expect(input().value).toBe("old draft");
    await render({ pendingAsk: ask }); await add(); await render();
    expect(runtime.thread.composer.getState().attachments).toHaveLength(1);
  });
  it("blocks actions offline and reports oversized files without uploading", async () => {
    await render({ offline: true });
    expect(label("Add attachment")?.disabled).toBe(true);
    await render();
    await add(new File([new Uint8Array(16 * 1024 * 1024 + 1)], "huge.bin"));
    expect(document.body.textContent).toContain("16 MiB");
    expect(save).not.toHaveBeenCalled();
  });
  it("blocks send above the count limit and enables it again after removal", async () => {
    await render();
    for (let i = 0; i < 17; i++) await add(new File(["a"], `file-${i}.txt`));
    expect(label("Send message")?.disabled).toBe(true);
    expect(document.body.textContent).toContain("at most 16 attachments");
    await click(label("Remove file-16.txt")!);
    expect(label("Send message")?.disabled).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });
});
