// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime } from "@assistant-ui/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptMessage } from "../transcript";
import { useThreadMessages } from "../useThreadMessages";
import { Thread } from "./Thread";

const red = "data:image/png;base64,cmVk";
const blue = "data:image/png;base64,Ymx1ZQ==";
const green = "data:image/png;base64,Z3JlZW4=";
let root: Root;

function Fixture({ messages }: { messages: TranscriptMessage[] }) {
  const threadMessages = useThreadMessages(messages, false);
  const runtime = useExternalStoreRuntime({ messages: threadMessages, onNew: async () => {}, isRunning: false });
  return <AssistantRuntimeProvider runtime={runtime}><Thread /></AssistantRuntimeProvider>;
}
const render = (messages: TranscriptMessage[]) => act(async () => root.render(<Fixture messages={messages} />));
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const click = (element: HTMLElement | null) => act(async () => element!.click());
const key = (name: string) => act(async () => {
  viewer()!.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
});
const viewer = () => document.querySelector<HTMLDialogElement>("dialog.image-viewer");
const shown = () => ({
  count: document.querySelector(".viewer-count")?.textContent,
  caption: document.querySelector(".viewer-caption")?.textContent,
  src: document.querySelector<HTMLImageElement>(".viewer-stage img")?.getAttribute("src"),
});

/** A reply that read two screenshots and then drew one image itself. */
const reply: TranscriptMessage[] = [
  { id: "u", role: "user", parts: [{ type: "text", text: "Compare the screens" }] },
  { id: "a", role: "assistant", parts: [
    { type: "tool", id: "read-home", name: "read", args: { path: "shots/home.png" }, state: { type: "done", output: "Read image file\n[image]", isError: false, images: [red] } },
    { type: "tool", id: "read-list", name: "read", args: { path: "shots/list.png" }, state: { type: "done", output: "Read image file\n[image]", isError: false, images: [blue] } },
    { type: "text", text: "Here is the difference." },
    { type: "image", src: green },
  ] },
];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("reply gallery", () => {
  it("gathers tool and generated images below the reply, in order", async () => {
    await render(reply);
    const gallery = document.querySelector(".message-assistant .image-gallery")!;
    expect(gallery.getAttribute("aria-label")).toBe("3 images from this reply");
    expect([...gallery.querySelectorAll("img")].map((img) => img.getAttribute("alt"))).toEqual(["home.png", "list.png", "Generated image 1"]);
    // Generated images live only in the gallery, never inline in the text.
    expect(document.querySelectorAll(".message-assistant img")).toHaveLength(3);
  });
  it("shows a lone image large instead of as a tile", async () => {
    await render([reply[0]!, { id: "a", role: "assistant", parts: [reply[1]!.parts[0]!] }]);
    expect(document.querySelector(".gallery-single img")?.getAttribute("alt")).toBe("home.png");
    expect(document.querySelector(".gallery-tile")).toBeNull();
  });
  it("draws no gallery for a reply without images", async () => {
    await render([reply[0]!, { id: "a", role: "assistant", parts: [{ type: "text", text: "No pictures" }] }]);
    expect(document.querySelector(".image-gallery")).toBeNull();
  });
});

describe("image viewer", () => {
  it("opens at the chosen image and browses the reply's whole set", async () => {
    await render(reply);
    await click(button("Open list.png"));
    expect(viewer()?.open).toBe(true);
    expect(shown()).toEqual({ count: "2 of 3", caption: "list.png", src: blue });
    await click(button("Next image"));
    expect(shown()).toEqual({ count: "3 of 3", caption: "Generated image 1", src: green });
    expect(button("Next image")?.disabled).toBe(true);
    await key("ArrowLeft"); await key("ArrowLeft");
    expect(shown().caption).toBe("home.png");
    expect(button("Previous image")?.disabled).toBe(true);
  });
  it("zooms with buttons and keys, and resets when the image changes", async () => {
    await render(reply);
    await click(button("Open home.png"));
    expect(button("Reset zoom")?.textContent).toBe("100%");
    expect(button("Zoom out")?.disabled).toBe(true);
    await click(button("Zoom in"));
    expect(button("Reset zoom")?.textContent).toBe("125%");
    await key("+");
    expect(button("Reset zoom")?.textContent).toBe("156%");
    await key("0");
    expect(button("Reset zoom")?.textContent).toBe("100%");
    await click(button("Zoom in"));
    await key("ArrowRight");
    expect(button("Reset zoom")?.textContent).toBe("100%");
  });
  it("swipes to the next image without the swipe's click closing the viewer", async () => {
    await render(reply);
    await click(button("Open home.png"));
    const stage = document.querySelector<HTMLElement>(".viewer-stage")!;
    const pointer = (type: string, x: number) => new PointerEvent(type, { bubbles: true, pointerId: 1, isPrimary: true, clientX: x, clientY: 100 });
    await act(async () => {
      stage.dispatchEvent(pointer("pointerdown", 300));
      stage.dispatchEvent(pointer("pointerup", 150));
      stage.click();
    });
    expect(shown().caption).toBe("list.png");
    expect(viewer()?.open).toBe(true);
    // A plain tap on the empty stage closes.
    await click(stage);
    expect(viewer()).toBeNull();
  });
  it("closes and returns focus to the image that opened it", async () => {
    await render(reply);
    const opener = button("Open home.png")!;
    opener.focus();
    await click(opener);
    await click(button("Close image viewer"));
    expect(viewer()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
  it("opens a tool's own images inside the reply's set", async () => {
    await render(reply);
    const step = [...document.querySelectorAll<HTMLElement>(".message-assistant .tally")]
      .find((node) => node.querySelector("button.tally-toggle")?.textContent?.startsWith("2 tool calls"))!;
    await click(step.querySelector<HTMLButtonElement>("button.tally-toggle"));
    const group = step.querySelector<HTMLElement>(".tally-panel")!;
    const tool = [...group.querySelectorAll<HTMLDetailsElement>("details.tool-call")].find((node) => node.textContent?.includes("list.png"))!;
    await act(async () => { tool.open = true; tool.dispatchEvent(new Event("toggle")); });
    const thumbnails = tool.querySelectorAll(".trace-section .image-gallery img");
    expect([...thumbnails].map((img) => img.getAttribute("alt"))).toEqual(["list.png"]);
    await click(tool.querySelector<HTMLButtonElement>(".image-gallery button"));
    expect(shown().count).toBe("2 of 3");
  });
  it("browses a user message's image attachments as one set", async () => {
    await render([{ id: "u", role: "user", parts: [], attachments: [
      { id: "one", type: "image", name: "before.png", contentType: "image/png", status: { type: "complete" }, content: [{ type: "image", image: red }] },
      { id: "two", type: "image", name: "after.png", contentType: "image/png", status: { type: "complete" }, content: [{ type: "image", image: blue }] },
    ] }]);
    await click(button("Preview after.png"));
    expect(shown()).toEqual({ count: "2 of 2", caption: "after.png", src: blue });
  });
});
