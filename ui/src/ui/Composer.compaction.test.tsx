// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime } from "@assistant-ui/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompactionState } from "../compaction";
import type { AskBinding } from "./useAskMode";
import { Thread } from "./Thread";
import { useThreadMessages } from "../useThreadMessages";
import type { ComposerInputElement } from "./ComposerEditor";

let root: Root;
interface Props {
  state?: CompactionState; running?: boolean; waits?: boolean; offline?: boolean; sending?: boolean; queueCount?: number;
  onSend?: (text: string) => Promise<void>; onClear?: () => void; onDismiss?: () => void;
  onCancel?: () => Promise<void>; ask?: AskBinding;
}
function Fixture({ state = { type: "idle" }, running = false, waits, offline = false, sending = false, queueCount = 1,
  onSend = async () => {}, onClear = () => {}, onDismiss = () => {}, onCancel = async () => {}, ask }: Props) {
  const runtime = useExternalStoreRuntime({ messages: useThreadMessages([], running), onNew: async () => {}, onCancel, isRunning: running, isDisabled: offline });
  // Pi lists a queued compaction as a follow-up, here after other clients' work.
  const items = state.type === "queued" ? [...Array.from({ length: queueCount - 1 }, (_, index) => ({ kind: "followUp" as const, text: `queued ${index + 1}` })),
    { kind: "followUp" as const, text: state.text }] : [];
  return <AssistantRuntimeProvider runtime={runtime}><Thread ask={ask} compaction={{ state, disabled: offline || sending, ...(waits === undefined ? {} : { waits }), onSend, onDismiss }}
    queue={{ items, disabled: offline || sending, onClear }} /></AssistantRuntimeProvider>;
}
const render = (props: Props = {}) => act(async () => root.render(<Fixture {...props} />));
const input = () => document.querySelector<ComposerInputElement>(".composer [data-composer-input]")!;
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === name || node.getAttribute("aria-label") === name);
const click = (node: HTMLElement | undefined) => act(async () => node!.click());
function type(text: string) {
  return act(async () => {
    input().value = text;
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const press = (key: string, shiftKey = false) => act(async () => { input().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, shiftKey })); });
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe("compaction in the one composer", () => {
  it("offers explicit queueing during a run while keeping ordinary sends unavailable and Stop reachable", async () => {
    const onSend = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    const onCancel = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    await render({ running: true, onSend, onCancel });
    await type("ordinary follow-up");
    expect(button("Send message")).toBeUndefined();
    expect(button("Queue compaction")).toBeUndefined();
    await type("/compact keep decisions");
    expect(onSend).not.toHaveBeenCalled();
    expect(button("Queue compaction")?.disabled).toBe(false);
    expect(button("Stop generating")).toBeDefined();
    await click(button("Queue compaction"));
    expect(onSend).toHaveBeenCalledExactlyOnceWith("/compact keep decisions");
    expect(input().value).toBe("");
    expect(document.querySelectorAll("[data-composer-input]")).toHaveLength(1);
    await click(button("Stop generating"));
    expect(onCancel).toHaveBeenCalledOnce();
  });
  it("names queueing when a shell command, not an agent run, holds the session", async () => {
    await render({ waits: true });
    await type("/compact");
    expect(button("Queue compaction")).toBeDefined();
    expect(button("Stop generating")).toBeUndefined();
  });
  it("uses explicit Enter confirmation and restores instructions after rejection", async () => {
    const onSend = vi.fn<(text: string) => Promise<void>>().mockRejectedValueOnce(new Error("Cannot compact")).mockResolvedValue(undefined);
    await render({ onSend });
    await type("/compact preserve tests");
    expect(button("Compact history")).toBeDefined();
    await press("Enter", true); expect(onSend).not.toHaveBeenCalled(); expect(input().value).toBe("/compact preserve tests\n");
    await press("Backspace"); await press("Enter");
    expect(onSend).toHaveBeenCalledWith("/compact preserve tests");
    expect(input().value).toBe("/compact preserve tests");
    await click(button("Compact history")); expect(input().value).toBe("");
  });
  it("names the whole queue, disables changes offline, and keeps the draft through state updates", async () => {
    const onClear = vi.fn();
    const state: CompactionState = { type: "queued", text: "/compact retain the release plan" };
    await render({ state, running: true, queueCount: 3, offline: true, onClear });
    expect(document.querySelector(".compaction-notice")).toBeNull();
    expect([...document.querySelectorAll("section.queue .queue-item")].at(-1)?.textContent).toBe("Compaction: /compact retain the release plan");
    expect(button("Clear entire queue (3)")?.disabled).toBe(true);
    await click(button("Clear entire queue (3)")); expect(onClear).not.toHaveBeenCalled();
    await render({ state, running: true, queueCount: 3, onClear }); await type("unfinished thought");
    await click(button("Clear entire queue (3)")); expect(onClear).toHaveBeenCalledOnce();
    await render({ state: { type: "running" }, running: true });
    expect(button("Stop compaction")).toBeDefined();
    expect(input().value).toBe("unfinished thought");
    await type("/compact"); expect(button("Queue compaction")?.disabled).toBe(true);
  });
  it("shows full completion feedback outside transcript messages and supports dismissal", async () => {
    const onDismiss = vi.fn();
    await render({ state: { type: "finished", outcome: "complete", message: "Compaction complete.\nTokens before: 123\n\nPreserve the decision log." }, onDismiss });
    expect(document.querySelector(".compaction-head [role=status]")?.textContent).toBe("Compaction complete.");
    expect(document.querySelector(".compaction-detail pre")?.textContent).toContain("Tokens before: 123");
    expect(document.querySelectorAll(".message")).toHaveLength(0);
    await click(button("Dismiss compaction feedback")); expect(onDismiss).toHaveBeenCalledOnce();
    await render({ state: { type: "finished", outcome: "failed", message: "Compaction failed: Provider unavailable" } });
    expect(document.querySelector(".compaction-notice [role=alert]")?.textContent).toBe("Compaction failed: Provider unavailable");
  });
  it("routes a compact command through ask mode without adding a second input or closing the ask", async () => {
    const onChat = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    const ask: AskBinding = { ask: { askId: "a", askedAt: "now", questions: [{ id: "q", question: "Which tests?", options: [] }] },
      phase: { type: "answering" }, offline: false, onChat, onDismiss: () => {}, onSubmit: () => {} };
    await render({ running: true, ask }); await type("/compact keep tests");
    expect(button("Queue compaction")).toBeUndefined();
    await click(button("Send message"));
    expect(onChat).toHaveBeenCalledWith("/compact keep tests");
    expect(document.querySelector(".ask")).not.toBeNull();
    expect(document.querySelectorAll("[data-composer-input]")).toHaveLength(1);
  });
  it("restores a rejected compaction to the chat draft across a replacement ask", async () => {
    let reject!: (error: Error) => void;
    const onSend = () => new Promise<void>((_, failed) => { reject = failed; });
    const ask: AskBinding = { ask: { askId: "a", askedAt: "now", questions: [{ id: "q", question: "Which tests?", options: [] }] },
      phase: { type: "answering" }, offline: false, onChat: async () => {}, onDismiss: () => {}, onSubmit: () => {} };
    await render({ running: true, onSend }); await type("/compact preserve deployment notes");
    await click(button("Queue compaction"));
    await render({ running: true, onSend, ask }); await type("current answer");
    await act(async () => reject(new Error("busy")));
    expect(input().value).toBe("current answer");
    await render({ running: true, onSend, ask: { ...ask, ask: { ...ask.ask, askId: "replacement" } } });
    expect(input().value).toBe("");
    await type("replacement answer"); await render({ running: true, onSend });
    expect(input().value).toBe("/compact preserve deployment notes");
  });
  it("does not replace a newer draft when a delayed compaction request fails", async () => {
    let reject!: (error: Error) => void;
    const onSend = () => new Promise<void>((_, failed) => { reject = failed; });
    await render({ running: true, onSend }); await type("/compact original instructions");
    await click(button("Queue compaction")); await type("new thought");
    await act(async () => reject(new Error("busy")));
    expect(input().value).toBe("new thought");
  });
});
