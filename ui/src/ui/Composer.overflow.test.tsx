// @vitest-environment happy-dom
// The bar's overflow in the one composer: a measured row moves whole controls into More, and More's rows act for them.
// happy-dom has no layout, so each test gives the row and its controls the widths a browser would.
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime, type AppendMessage, type AssistantRuntime } from "@assistant-ui/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionModel } from "../contracts";
import type { ModelBinding } from "./ModelPicker";
import { Thread } from "./Thread";
import { useThreadMessages } from "../useThreadMessages";
import type { ComposerInputElement } from "./ComposerEditor";
import { createAttachmentAdapter } from "../attachments";
import { attachmentDelivery } from "../attachmentDelivery";

let root: Root;
let runtime: AssistantRuntime;
const opus: SessionModel = { provider: "anthropic", id: "claude-opus-5-5", name: "Claude Opus 5.5" };
const model: ModelBinding = { model: opus, thinkingLevel: "high", disabled: false, listModels: async () => [opus],
  listThinkingLevels: async () => ["high"], onModel: async () => {}, onThinkingLevel: async () => {} };
/** Natural widths in px, as the browser measured them at 15px type. */
const WIDTHS: Record<string, number> = { attach: 34, handle: 132, model: 175, dictate: 28, more: 28, steer: 58, send: 64, words: 132, total: 44 };
let row = 600;
function layout() {
  const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth")?.get;
  const rect = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("composer-actions") || this.classList.contains("composer-shell") ? row : width?.call(this) ?? 0;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const name = this.dataset.slot ?? this.dataset.measure;
    // An image adds the delivery half to Attach. happy-dom cannot measure that wider chip.
    const measured = name === "attach" && this.querySelector(".split-button-setting") ? 112 : name === undefined ? undefined : WIDTHS[name];
    return measured === undefined ? rect.call(this) : ({ ...rect.call(this).toJSON(), width: measured } as DOMRect);
  });
}
function Fixture({ onNew = async () => {} }: { onNew?: (message: AppendMessage) => Promise<void> }) {
  const [adapter] = useState(() => createAttachmentAdapter(async () => { throw new Error("This fixture must not upload files"); }));
  useEffect(() => () => adapter.dispose(), [adapter]);
  runtime = useExternalStoreRuntime({ messages: useThreadMessages([], true), onNew, onCancel: async () => {}, isRunning: true,
    adapters: { attachments: adapter } });
  return <AssistantRuntimeProvider runtime={runtime}><Thread model={model} working={{ queue: true, steer: true }}
    queue={{ items: [{ kind: "followUp", text: "add tests" }], disabled: false, onClear: () => {} }}
    ledge={{ count: 3, noun: "proposals", keys: ["a", "b", "c"], content: <div data-ledge-band>three</div> }} /></AssistantRuntimeProvider>;
}
const render = (props: Parameters<typeof Fixture>[0] = {}) => act(async () => root.render(<Fixture {...props} />));
const input = () => document.querySelector<ComposerInputElement>(".composer [data-composer-input]")!;
const slot = (name: string) => document.querySelector<HTMLElement>(`.composer-actions [data-slot="${name}"]`)!;
const moved = () => [...document.querySelectorAll<HTMLElement>(".composer-actions [data-slot][data-overflow]")].map((node) => node.dataset.slot);
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === name || node.getAttribute("aria-label") === name);
const menuItem = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("[role='menuitem']")].find((node) => node.textContent?.startsWith(name));
const type = (text: string) => act(async () => { input().value = text; input().dispatchEvent(new Event("input", { bubbles: true })); });
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
  layout();
  attachmentDelivery.set("inline");
});
afterEach(async () => { await act(async () => root.unmount()); attachmentDelivery.set("inline"); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); row = 600; });

describe("the bar's overflow", () => {
  it("keeps everything inline with the handle in words while it fits, and draws no More", async () => {
    row = 800;
    await render();
    await type("check the store");
    expect(moved()).toEqual(["more"]);
    expect(slot("handle").textContent).toBe("3 proposals, 1 queued");
    expect(document.querySelector<HTMLElement>(".composer-actions")?.style.getPropertyValue("--bar-gap")).toBe("16px");
  });

  it("shortens the handle first, then moves the model picker and Steer into More, and More's rows act for them", async () => {
    const sent = vi.fn<(message: AppendMessage) => Promise<void>>(async () => {});
    // Attach, the handle's total, Dictate, More and the sends with four 12px gaps take 246 of 300; Steer would need 70 more.
    row = 300;
    await render({ onNew: sent });
    await type("check the store");
    expect(moved()).toEqual(["model", "steer"]);
    expect(slot("handle").textContent).toBe("4");
    expect(button("Fold 3 proposals, 1 queued away")).toBeDefined();
    expect(slot("model").getAttribute("aria-hidden")).toBe("true");
    await act(async () => button("More input controls")!.click());
    expect([...document.querySelectorAll("[role='menuitem']")].map((item) => item.textContent)).toEqual(["ModelClaude Opus 5.5, High", "Steer"]);
    // The model row opens the same picker.
    await act(async () => menuItem("Model")!.click());
    expect(document.querySelector(".floating-panel")).not.toBeNull();
    await act(async () => document.querySelector<HTMLElement>(".floating-panel")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    // The Steer row steers the draft.
    await act(async () => button("More input controls")!.click());
    await act(async () => menuItem("Steer")!.click());
    expect(sent).toHaveBeenCalledOnce();
    expect(sent.mock.calls[0]![0].steer).toBe(true);
  });

  it("keeps attachment delivery reachable in More at 280px while running", async () => {
    row = 280;
    await render();
    await act(async () => runtime.thread.composer.addAttachment(new File(["image"], "picture.png", { type: "image/png" })));
    expect(slot("attach").hasAttribute("data-overflow")).toBe(true);
    await act(async () => button("More input controls")!.click());
    expect(menuItem("Attach files")).toBeDefined();
    expect(menuItem("Attachment delivery…")).toBeDefined();
    await act(async () => menuItem("Attachment delivery…")!.click());
    const setting = document.querySelector<HTMLElement>('[role="menu"][aria-labelledby]');
    expect(setting?.textContent).toContain("Send images");
    // The setting must escape the hidden, aria-hidden overflow slot, not just mount inside it.
    expect(setting?.closest('[aria-hidden="true"]')).toBeNull();
    const asFiles = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find((item) => item.textContent?.startsWith("As files"));
    await act(async () => asFiles!.click());
    expect(attachmentDelivery.get()).toBe("folder");
    expect(document.querySelector('[role="menuitemradio"]')).toBeNull();
    expect(document.activeElement).toBe(button("More input controls"));
    // Reopen and dismiss with the keyboard. Focus must not return to hidden Attach.
    await act(async () => button("More input controls")!.click());
    await act(async () => menuItem("Attachment delivery…")!.click());
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="menuitemradio"]')).toBeNull();
    expect(document.activeElement).toBe(button("More input controls"));
  });

  it.each([400, 800])("keeps delivery out of More when Attach is inline at %ipx", async (width) => {
    row = width;
    await render();
    await act(async () => runtime.thread.composer.addAttachment(new File(["image"], "picture.png", { type: "image/png" })));
    expect(slot("attach").hasAttribute("data-overflow")).toBe(false);
    expect(button("Send images: Inline")).toBeDefined();
    // At 400px Model still overflows, so check a populated More as well as the wide, empty menu.
    await act(async () => button("More input controls")!.click());
    expect(menuItem("Attachment delivery…")).toBeUndefined();
  });

  it("never moves the handle or the sends, even when nothing else fits", async () => {
    row = 120;
    await render();
    await type("check the store");
    expect(moved()).toEqual(["attach", "model", "dictate", "steer"]);
    expect(slot("handle").hasAttribute("data-overflow")).toBe(false);
    expect(slot("send").hasAttribute("data-overflow")).toBe(false);
    expect(button("Queue message")).toBeDefined();
    await act(async () => button("More input controls")!.click());
    expect([...document.querySelectorAll("[role='menuitem']")].map((item) => item.textContent)).toEqual(["Attach files", "ModelClaude Opus 5.5, High", "Dictate", "Steer"]);
    // Attach files presses the file input it stands for.
    const picked = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    await act(async () => menuItem("Attach files")!.click());
    expect(picked).toHaveBeenCalledOnce();
  });
});
