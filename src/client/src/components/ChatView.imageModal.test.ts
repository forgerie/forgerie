// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "./ChatView";
import type { ImageLightbox } from "./ImageLightbox";
import { ModalSurface } from "./ModalSurface";
import { hasRenderedModal } from "./modalLayerRegistry";

const IMAGE_DATA = "iVBORw0KGgo=";
const SECOND_IMAGE_DATA = "U0VDT05E";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("ChatView native image modal", () => {
  it("opens a turn gallery as a navigable full-screen image set", async () => {
    const view = await mountImageGalleryView();
    const thumbnails = [...shadow(view).querySelectorAll<HTMLButtonElement>(".turn-image-gallery-thumb")];
    const first = requiredElement(thumbnails[0], "first gallery thumbnail");

    first.click();
    await lightbox(view).updateComplete;
    let dialog = imageDialog(view);
    expect(dialog.open).toBe(true);
    expect(imageCounter(dialog).textContent.trim()).toBe("1 / 2");
    expect(zoomedImage(dialog).getAttribute("src")).toContain(IMAGE_DATA);

    imageNextButton(dialog).click();
    await lightbox(view).updateComplete;
    dialog = imageDialog(view);
    expect(imageCounter(dialog).textContent.trim()).toBe("2 / 2");
    expect(zoomedImage(dialog).getAttribute("src")).toContain(SECOND_IMAGE_DATA);
    expect(imageNextButton(dialog).disabled).toBe(true);
  });

  it("opens overflow at the first hidden image without rendering every thumbnail", async () => {
    const view = await mountOverflowGalleryView();
    const root = shadow(view);
    expect(root.querySelectorAll(".turn-image-gallery-thumb")).toHaveLength(4);
    const more = requiredElement(root.querySelector<HTMLButtonElement>(".turn-image-gallery-more"), "gallery overflow button");
    expect(more.textContent.trim()).toBe("+2");

    more.click();
    await lightbox(view).updateComplete;

    const dialog = imageDialog(view);
    expect(imageCounter(dialog).textContent.trim()).toBe("5 / 6");
    expect(zoomedImage(dialog).getAttribute("src")).toContain("SU1BR0U1");
  });

  it("applies a two-finger pinch only to the full-screen image", async () => {
    const view = await mountImageView();
    chatImage(view).click();
    await lightbox(view).updateComplete;
    const dialog = imageDialog(view);
    const stage = requiredElement(dialog.querySelector<HTMLElement>(".stage"), "image zoom stage");
    const image = zoomedImage(dialog);
    setElementSize(stage, 300, 300);
    setElementSize(image, 300, 200);

    stage.dispatchEvent(pointer("pointerdown", 1, 100, 150));
    stage.dispatchEvent(pointer("pointerdown", 2, 200, 150));
    stage.dispatchEvent(pointer("pointermove", 1, 50, 150));
    stage.dispatchEvent(pointer("pointermove", 2, 250, 150));
    await lightbox(view).updateComplete;

    expect(image.style.transform).toContain("scale(2)");
    expect(dialog.style.transform).toBe("");
    expect(view.style.transform).toBe("");
  });

  it("preserves cancel and backdrop close behavior while restoring the image trigger", async () => {
    const view = await mountImageView();
    const image = chatImage(view);

    image.focus();
    image.click();
    await lightbox(view).updateComplete;
    const firstDialog = imageDialog(view);
    expect(firstDialog.open).toBe(true);
    expect(lightbox(view).shadowRoot?.activeElement).toBe(imageCloseButton(firstDialog));
    expect(hasRenderedModal(document)).toBe(true);

    const cancel = new Event("cancel", { cancelable: true });
    firstDialog.dispatchEvent(cancel);
    await lightbox(view).updateComplete;
    expect(cancel.defaultPrevented).toBe(false);
    expect(firstDialog.open).toBe(false);
    expect(view.shadowRoot?.activeElement).toBe(image);
    expect(hasRenderedModal(document)).toBe(false);

    image.click();
    await lightbox(view).updateComplete;
    const secondDialog = imageDialog(view);
    requiredElement(secondDialog.querySelector<HTMLElement>(".stage"), "image stage backdrop").click();
    await lightbox(view).updateComplete;

    expect(secondDialog.open).toBe(false);
    expect(view.shadowRoot?.activeElement).toBe(image);
    expect(hasRenderedModal(document)).toBe(false);
  });

  it("keeps the native top layer above a shared modal and restores focus into the survivor", async () => {
    const trigger = appendButton("Open lower dialog");
    trigger.focus();
    const lower = new ModalSurface();
    lower.initialFocus = "button";
    lower.innerHTML = "<button>Lower action</button>";
    document.body.append(lower);
    await lower.updateComplete;
    const lowerButton = requiredElement(lower.querySelector<HTMLButtonElement>("button"), "lower modal button");
    expect(document.activeElement).toBe(lowerButton);

    const view = await mountImageView();
    chatImage(view).click();
    await lightbox(view).updateComplete;
    await lower.updateComplete;
    const dialog = imageDialog(view);

    expect(dialog.open).toBe(true);
    expect(lowerDialogSection(lower).getAttribute("aria-modal")).toBe("false");
    expect(lowerDialogSection(lower).getAttribute("aria-hidden")).toBe("true");
    expect(lightbox(view).shadowRoot?.activeElement).toBe(imageCloseButton(dialog));

    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    await lightbox(view).updateComplete;
    await lower.updateComplete;

    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(lowerButton);
    expect(lowerDialogSection(lower).getAttribute("aria-modal")).toBe("true");
    expect(lowerDialogSection(lower).getAttribute("aria-hidden")).toBeNull();

    lower.remove();
    expect(document.activeElement).toBe(trigger);
  });
});

async function mountImageView(): Promise<ChatView> {
  const view = new ChatView();
  view.sessionId = "session-image";
  view.messages = [{ role: "user", parts: [{ type: "image", mimeType: "image/png", data: IMAGE_DATA }] }];
  document.body.append(view);
  await view.updateComplete;
  return view;
}

async function mountImageGalleryView(): Promise<ChatView> {
  const view = new ChatView();
  view.sessionId = "session-gallery";
  view.messages = [
    { role: "user", parts: [{ type: "text", text: "show me" }] },
    toolImage(IMAGE_DATA, "first"),
    toolImage(SECOND_IMAGE_DATA, "second"),
    { role: "assistant", parts: [{ type: "text", text: "done" }] },
  ];
  document.body.append(view);
  await view.updateComplete;
  await view.updateComplete;
  return view;
}

async function mountOverflowGalleryView(): Promise<ChatView> {
  const view = new ChatView();
  view.sessionId = "session-gallery-overflow";
  view.messages = [
    { role: "user", parts: [{ type: "text", text: "show all" }] },
    ...["SU1BR0Ux", "SU1BR0Uy", "SU1BR0Uz", "SU1BR0U0", "SU1BR0U1", "SU1BR0U2"].map((data, index) => toolImage(data, `image ${String(index + 1)}`)),
    { role: "assistant", parts: [{ type: "text", text: "done" }] },
  ];
  document.body.append(view);
  await view.updateComplete;
  await view.updateComplete;
  return view;
}

function toolImage(data: string, label: string) {
  return { role: "tool" as const, parts: [{ type: "toolResult" as const, toolName: "read", text: label, isError: false }, { type: "image" as const, mimeType: "image/png", data }] };
}

function chatImage(view: ChatView): HTMLElement {
  return requiredElement(view.shadowRoot?.querySelector<HTMLElement>(".chat-image"), "chat image");
}

function lightbox(view: ChatView): ImageLightbox {
  return requiredElement(view.shadowRoot?.querySelector<ImageLightbox>("image-lightbox"), "image lightbox");
}

function imageDialog(view: ChatView): HTMLDialogElement {
  return requiredElement(lightbox(view).shadowRoot?.querySelector<HTMLDialogElement>("dialog"), "image zoom dialog");
}

function imageCloseButton(dialog: HTMLDialogElement): HTMLButtonElement {
  return requiredElement(dialog.querySelector<HTMLButtonElement>(".close"), "image close button");
}

function imageCounter(dialog: HTMLDialogElement): HTMLElement {
  return requiredElement(dialog.querySelector<HTMLElement>(".counter"), "image counter");
}

function imageNextButton(dialog: HTMLDialogElement): HTMLButtonElement {
  return requiredElement(dialog.querySelector<HTMLButtonElement>(".next"), "next image button");
}

function zoomedImage(dialog: HTMLDialogElement): HTMLImageElement {
  return requiredElement(dialog.querySelector<HTMLImageElement>("img"), "zoomed image");
}

function pointer(type: string, pointerId: number, clientX: number, clientY: number): PointerEvent {
  return new PointerEvent(type, { pointerId, clientX, clientY, pointerType: "touch", bubbles: true, cancelable: true, composed: true });
}

function setElementSize(element: HTMLElement, width: number, height: number): void {
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: width },
    clientHeight: { configurable: true, value: height },
    offsetWidth: { configurable: true, value: width },
    offsetHeight: { configurable: true, value: height },
  });
  element.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) });
}

function lowerDialogSection(surface: ModalSurface): HTMLElement {
  return requiredElement(surface.shadowRoot?.querySelector<HTMLElement>("section[role='dialog']"), "lower dialog section");
}

function appendButton(text: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.textContent = text;
  document.body.append(button);
  return button;
}

function shadow(view: ChatView): ShadowRoot {
  return requiredElement(view.shadowRoot, "chat view shadow root");
}

function requiredElement<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${label}`);
  return value;
}
