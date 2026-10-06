// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime, type AppendMessage } from "@assistant-ui/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompactionState } from "../compaction";
import type { QueuedMessage, WorkingSend } from "../queue";
import type { AskBinding } from "./useAskMode";
import { Thread } from "./Thread";
import { useThreadMessages } from "../useThreadMessages";

let root: Root;
interface Props {
  running?: boolean; working?: WorkingSend; items?: QueuedMessage[]; offline?: boolean; compaction?: CompactionState;
  onNew?: (message: AppendMessage) => Promise<void>; onClear?: () => void; onCancel?: () => Promise<void>; ask?: AskBinding;
  onRun?: (text: string) => Promise<void>;
}
const responding: WorkingSend = { queue: true, steer: true };
function Fixture({ running = true, working = responding, items = [], offline = false, compaction = { type: "idle" },
  onNew = async () => {}, onClear = () => {}, onCancel = async () => {}, ask, onRun = async () => {} }: Props) {
  const runtime = useExternalStoreRuntime({ messages: useThreadMessages([], running), onNew, onCancel, isRunning: running, isDisabled: offline });
  return <AssistantRuntimeProvider runtime={runtime}><Thread ask={ask} working={working} shell={{ availability: { type: "ready" }, onRun }}
    queue={{ items, disabled: offline, onClear }}
    compaction={{ state: compaction, disabled: offline, onSend: async () => {}, onDismiss: () => {} }} /></AssistantRuntimeProvider>;
}
const render = (props: Props = {}) => act(async () => root.render(<Fixture {...props} />));
const input = () => document.querySelector<HTMLTextAreaElement>(".composer textarea")!;
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")]
  .find((node) => node.textContent === name || node.getAttribute("aria-label") === name);
const click = (node: HTMLElement | undefined) => act(async () => node!.click());
function type(text: string) {
  return act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input(), text);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const press = (key: string, modifiers: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {}) => act(async () => {
  input().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, ...modifiers }));
});
const sentText = (message: AppendMessage | undefined) => message?.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("");
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe("sending while the agent works", () => {
  it("offers Queue and Steer beside Stop once there is a draft, and keeps Stop in its place", async () => {
    const onNew = vi.fn<(message: AppendMessage) => Promise<void>>().mockResolvedValue(undefined);
    await render({ onNew });
    expect(button("Queue message")).toBeUndefined();
    expect(button("Steer")).toBeUndefined();
    expect(button("Stop generating")).toBeDefined();
    await type("add tests after this");
    const actions = [...document.querySelectorAll(".composer-actions button")].map((node) => node.getAttribute("aria-label") ?? node.textContent);
    expect(actions.slice(-3)).toEqual(["Steer", "Queue message", "Stop generating"]);
    await click(button("Queue message"));
    expect(onNew).toHaveBeenCalledOnce();
    expect(sentText(onNew.mock.calls[0]?.[0])).toBe("add tests after this");
    expect(onNew.mock.calls[0]?.[0].steer).toBeFalsy();
    expect(input().value).toBe("");
    await type("use the existing helper");
    await click(button("Steer"));
    expect(onNew.mock.calls[1]?.[0].steer).toBe(true);
    expect(sentText(onNew.mock.calls[1]?.[0])).toBe("use the existing helper");
  });

  it("queues on Enter, steers on Ctrl or Cmd+Shift+Enter, and keeps Shift+Enter a new line", async () => {
    const onNew = vi.fn<(message: AppendMessage) => Promise<void>>().mockResolvedValue(undefined);
    await render({ onNew });
    await type("first"); await press("Enter", { shiftKey: true });
    expect(onNew).not.toHaveBeenCalled();
    await press("Enter");
    expect(sentText(onNew.mock.calls[0]?.[0])).toBe("first");
    expect(onNew.mock.calls[0]?.[0].steer).toBeFalsy();
    await type("second"); await press("Enter", { shiftKey: true, ctrlKey: true });
    expect(onNew.mock.calls[1]?.[0].steer).toBe(true);
    await type("third"); await press("Enter", { shiftKey: true, metaKey: true });
    expect(onNew.mock.calls[2]?.[0].steer).toBe(true);
  });

  it("queues without Steer while compaction runs or waits, and offers neither when the session cannot queue", async () => {
    const onNew = vi.fn<(message: AppendMessage) => Promise<void>>().mockResolvedValue(undefined);
    await render({ onNew, working: { queue: true, steer: false } }); await type("after compaction");
    expect(button("Queue message")).toBeDefined();
    expect(button("Steer")).toBeUndefined();
    await press("Enter", { shiftKey: true, ctrlKey: true });
    expect(onNew).not.toHaveBeenCalled();
    await render({ onNew, working: { queue: false, steer: false } });
    expect(button("Queue message")).toBeUndefined();
    await press("Enter");
    expect(onNew).not.toHaveBeenCalled();
    expect(input().value).toBe("after compaction");
  });

  it("runs a shell draft beside the agent run instead of queueing it", async () => {
    const onNew = vi.fn<(message: AppendMessage) => Promise<void>>().mockResolvedValue(undefined);
    const onRun = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    await render({ onNew, onRun }); await type("!git status");
    expect(button("Queue message")).toBeUndefined();
    expect(button("Steer")).toBeUndefined();
    expect(button("Run command")).toBeDefined();
    await press("Enter");
    expect(onRun).toHaveBeenCalledWith("!git status");
    expect(onNew).not.toHaveBeenCalled();
  });

  it("queues whenever the session can queue, even before the thread shows a run", async () => {
    // A compaction can wait behind a shell command while no agent run shows.
    const onNew = vi.fn<(message: AppendMessage) => Promise<void>>().mockResolvedValue(undefined);
    await render({ onNew, running: false, working: { queue: true, steer: false } }); await type("after compaction");
    expect(button("Send message")).toBeUndefined();
    expect(button("Queue message")).toBeDefined();
    await press("Enter");
    expect(sentText(onNew.mock.calls[0]?.[0])).toBe("after compaction");
  });

  it("keeps focus in the input after queueing, so the keyboard stays open", async () => {
    await render(); await type("add tests");
    input().focus();
    await click(button("Queue message"));
    expect(document.activeElement).toBe(input());
    await type("use the helper");
    await click(button("Steer"));
    expect(document.activeElement).toBe(input());
  });

  it("stops on Escape only with an empty draft, so Escape never throws away typing", async () => {
    const onCancel = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    await render({ onCancel }); await type("half a thought");
    await act(async () => { input().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" })); });
    expect(onCancel).not.toHaveBeenCalled();
    await type("");
    await act(async () => { input().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" })); });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("names the keyboard shortcuts for assistive technology", async () => {
    await render(); await type("add tests");
    expect(button("Queue message")?.getAttribute("aria-keyshortcuts")).toBe("Enter");
    expect(button("Steer")?.getAttribute("aria-keyshortcuts")).toBe("Control+Shift+Enter Meta+Shift+Enter");
  });

  it("leaves slash commands and ask answers without queue controls, and disables them offline", async () => {
    await render(); await type("/name release");
    expect(button("Queue message")).toBeUndefined();
    await render({ offline: true }); await type("plain text");
    expect(button("Queue message")?.disabled).toBe(true);
    expect(button("Steer")?.disabled).toBe(true);
    const ask: AskBinding = { ask: { askId: "a", askedAt: "now", questions: [{ id: "q", question: "Which tests?", options: [] }] },
      phase: { type: "answering" }, offline: false, onChat: async () => {}, onDismiss: () => {}, onSubmit: () => {} };
    await render({ ask }); await type("an answer");
    expect(button("Queue message")).toBeUndefined();
    expect(button("Steer")).toBeUndefined();
  });

  it("titles Stop with what happens to the queue", async () => {
    await render({ items: [{ kind: "followUp", text: "add tests" }] });
    expect(button("Stop generating")?.title).toBe("Stop and return queued messages to the draft");
    await render();
    expect(button("Stop generating")?.title).toBe("Stop generating");
  });
});

describe("the queue above the composer", () => {
  it("lists Pi's queue in delivery order, names each item, and clears it whole", async () => {
    const onClear = vi.fn();
    const items: QueuedMessage[] = [{ kind: "steer", text: "use the helper" }, { kind: "followUp", text: "add tests" },
      { kind: "followUp", text: "/compact keep the release plan" }];
    await render({ items, onClear, compaction: { type: "queued", text: "/compact keep the release plan" } });
    const region = document.querySelector("section.queue")!;
    expect(region.getAttribute("aria-label")).toBe("Queued messages");
    expect(region.querySelector(".queue-head span")?.textContent).toBe("3 queued");
    expect(document.querySelector(".queue-announcer")?.textContent).toBe("3 queued");
    expect([...region.querySelectorAll("li")].map((row) => [row.querySelector(".queue-kind")?.textContent, row.querySelector(".queue-text")?.textContent]))
      .toEqual([["Steer", "use the helper"], ["Follow-up", "add tests"], ["Compaction", "/compact keep the release plan"]]);
    // The queued compaction is one of these rows, so the compaction notice does not repeat it.
    expect(document.querySelector(".compaction-notice")).toBeNull();
    // A separator keeps the kind and the text apart for screen readers.
    expect(region.querySelector("li")!.textContent).toBe("Steer: use the helper");
    expect(region.querySelector("ol")!.tabIndex).toBe(0);
    await type("unfinished thought");
    await click(button("Clear entire queue (3)"));
    expect(onClear).toHaveBeenCalledOnce();
    expect(input().value).toBe("unfinished thought");
    expect(document.activeElement).toBe(input());
  });

  it("disables clearing offline and disappears when the queue is empty", async () => {
    const onClear = vi.fn();
    await render({ items: [{ kind: "followUp", text: "add tests" }], offline: true, onClear });
    expect(button("Clear entire queue")?.disabled).toBe(true);
    await click(button("Clear entire queue")); expect(onClear).not.toHaveBeenCalled();
    await render({ items: [] });
    expect(document.querySelector("section.queue")).toBeNull();
    // The live region stays mounted, so the first queued item and an empty queue are announced.
    expect(document.querySelector(".queue-announcer")?.getAttribute("role")).toBe("status");
    expect(document.querySelector(".queue-announcer")?.textContent).toBe("Queue empty");
    await render({ items: [{ kind: "followUp", text: "add tests" }] });
    expect(document.querySelector(".queue-announcer")?.textContent).toBe("1 queued");
  });
});
