// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { textMessage } from "../chatMessages";
import { selectedChatFreshReadable, selectedChatLoading, selectedChatTarget } from "../selectedChatLoad";
import { ChatView } from "./ChatView";
import { chatStyles } from "./shared";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ChatView native scroll behavior", () => {
  it("keeps browser scroll anchoring enabled", () => {
    expect(chatStyles.cssText).toMatch(/\.chat\s*{[^}]*overflow-anchor:\s*auto/);
  });

  it("keeps the fixed history control out of browser anchor selection", () => {
    expect(chatStyles.cssText).toMatch(/\.history-boundary\s*{[^}]*overflow-anchor:\s*none/);
  });

  // A grid without a stated align-content stretches its auto rows, which spread
  // a short transcript over the whole pane and inflated the history button into
  // a full-height pill. The property has to stay stated for the rows to keep
  // the height of what is in them.
  it("sizes transcript rows to their content rather than to the scroller", () => {
    expect(chatStyles.cssText).toMatch(/\.chat\s*{[^}]*align-content:\s*start/);
  });

  // The slack a short transcript leaves belongs above it, so the reading edge
  // stays against the composer.
  it("gives the slack to a leading spacer row", () => {
    expect(chatStyles.cssText).toMatch(/\.chat\s*{[^}]*grid-template-rows:\s*minmax\(0, 1fr\)/);
    expect(chatStyles.cssText).toMatch(/\.chat::before\s*{\s*content:\s*""/);
  });

  // A spacer that cannot collapse would push the first message above the scroll
  // origin, where scrolling never reaches it.
  it("lets the spacer collapse so no message sits above the scroll origin", () => {
    expect(chatStyles.cssText).not.toMatch(/\.chat\s*{[^}]*grid-template-rows:\s*1fr/);
  });

  // Content-sized rows leave an auto margin nothing to divide, so the empty
  // screen has to centre itself.
  it("centres an empty transcript without relying on an auto margin", () => {
    expect(chatStyles.cssText).toMatch(/\.chat-empty-state[^{]*{[^}]*align-content:\s*center/);
    expect(chatStyles.cssText).not.toMatch(/\.chat-empty-state\s*{[^}]*margin:\s*auto/);
    expect(chatStyles.cssText).not.toMatch(/\.chat-load-state\.empty\s*{[^}]*margin:\s*auto/);
  });
});

describe("ChatView tail ownership", () => {
  it("opens a selected session at the bottom", async () => {
    const frames = installFrames();
    const view = await mountedView();
    const geometry = defineMutableScrollGeometry(chatScroller(view), { scrollHeight: 1_400 });

    frames.releaseAll();

    expect(geometry.scrollTop).toBe(1_000);
  });

  it("follows new content while the reader remains at the bottom", async () => {
    const frames = installFrames();
    const view = await mountedView();
    const geometry = defineMutableScrollGeometry(chatScroller(view), { scrollHeight: 1_400 });
    frames.releaseAll();

    geometry.scrollHeight = 1_800;
    view.messages = [...view.messages, textMessage("assistant", "more")];
    await view.updateComplete;
    frames.releaseAll();

    expect(geometry.scrollTop).toBe(1_400);
  });

  it("leaves the reader position alone after they scroll away", async () => {
    const frames = installFrames();
    const view = await mountedView();
    const chat = chatScroller(view);
    const geometry = defineMutableScrollGeometry(chat, { scrollHeight: 1_400 });
    frames.releaseAll();

    geometry.scrollTop = 500;
    chat.dispatchEvent(new Event("scroll"));
    geometry.scrollHeight = 1_800;
    view.messages = [...view.messages, textMessage("assistant", "more")];
    await view.updateComplete;
    frames.releaseAll();

    expect(geometry.scrollTop).toBe(500);
  });

  it("resumes following after the reader returns to the bottom", async () => {
    const frames = installFrames();
    const view = await mountedView();
    const chat = chatScroller(view);
    const geometry = defineMutableScrollGeometry(chat, { scrollHeight: 1_400 });
    frames.releaseAll();

    geometry.scrollTop = 500;
    chat.dispatchEvent(new Event("scroll"));
    geometry.scrollTop = 1_000;
    chat.dispatchEvent(new Event("scroll"));

    geometry.scrollHeight = 1_800;
    view.messages = [...view.messages, textMessage("assistant", "more")];
    await view.updateComplete;
    frames.releaseAll();

    expect(geometry.scrollTop).toBe(1_400);
  });

  it("does not reclaim reader ownership during a same-session refresh", async () => {
    const frames = installFrames();
    const view = await mountedView();
    const chat = chatScroller(view);
    const geometry = defineMutableScrollGeometry(chat, { scrollHeight: 1_400 });
    frames.releaseAll();

    geometry.scrollTop = 500;
    chat.dispatchEvent(new Event("scroll"));
    view.selectedLoad = selectedChatLoading(selectedChatTarget("local", session));
    await view.updateComplete;
    frames.releaseAll();

    expect(geometry.scrollTop).toBe(500);
  });

  it("keeps ownership with a delayed scrollbar drag", async () => {
    const frames = installFrames();
    const view = await mountedView();
    const chat = chatScroller(view);
    const geometry = defineMutableScrollGeometry(chat, { scrollHeight: 1_400 });
    Object.defineProperties(chat, {
      offsetWidth: { configurable: true, value: 400 },
      clientWidth: { configurable: true, value: 400 },
    });
    chat.getBoundingClientRect = () => rect(0, 0, 400, 400);
    frames.releaseAll();

    chat.dispatchEvent(new PointerEvent("pointerdown", { clientX: 399, bubbles: true }));
    frames.releaseAll();
    geometry.scrollHeight = 1_800;
    view.messages = [...view.messages, textMessage("assistant", "more")];
    await view.updateComplete;
    frames.releaseAll();

    expect(geometry.scrollTop).toBe(1_000);
  });

  it("resumes tail following after a pointer press ends without scrolling", async () => {
    const frames = installFrames();
    const view = await mountedView();
    const chat = chatScroller(view);
    const geometry = defineMutableScrollGeometry(chat, { scrollHeight: 1_400 });
    frames.releaseAll();

    chat.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    chat.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    geometry.scrollHeight = 1_800;
    view.messages = [...view.messages, textMessage("assistant", "more")];
    await view.updateComplete;
    frames.releaseAll();

    expect(geometry.scrollTop).toBe(1_400);
  });

  it("cancels a queued tail placement when reader input arrives first", async () => {
    const frames = installFrames();
    const view = await mountedView();
    const chat = chatScroller(view);
    const geometry = defineMutableScrollGeometry(chat, { scrollHeight: 1_400 });
    frames.releaseAll();

    geometry.scrollHeight = 1_800;
    view.messages = [...view.messages, textMessage("assistant", "more")];
    await view.updateComplete;
    chat.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, bubbles: true }));
    frames.releaseAll();

    expect(geometry.scrollTop).toBe(1_000);
  });
});

describe("ChatView earlier history", () => {
  it("loads earlier messages only from the explicit button", async () => {
    const frames = installFrames();
    const loadMore = vi.fn();
    const view = await mountedView();
    view.hasMore = true;
    view.onLoadMore = loadMore;
    await view.updateComplete;
    const chat = chatScroller(view);
    const geometry = defineMutableScrollGeometry(chat, { scrollHeight: 1_400 });
    frames.releaseAll();

    geometry.scrollTop = 0;
    chat.dispatchEvent(new Event("scroll"));
    chat.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, bubbles: true }));
    frames.releaseAll();

    expect(loadMore).not.toHaveBeenCalled();

    const button = requiredElement(view.shadowRoot?.querySelector<HTMLButtonElement>(".history-load-button"), "history load button");
    button.click();

    expect(loadMore).toHaveBeenCalledOnce();
  });

  it("keeps an underfilled transcript at the top when earlier messages arrive", async () => {
    const frames = installFrames();
    const loadMore = vi.fn();
    const view = await mountedView();
    view.hasMore = true;
    view.onLoadMore = loadMore;
    view.messageStart = 1;
    await view.updateComplete;
    const geometry = defineMutableScrollGeometry(chatScroller(view), { scrollHeight: 300, clientHeight: 400 });
    frames.releaseAll();

    const button = requiredElement(view.shadowRoot?.querySelector<HTMLButtonElement>(".history-load-button"), "history load button");
    button.click();
    geometry.scrollHeight = 1_400;
    view.messageStart = 0;
    view.messages = [textMessage("user", "earlier"), ...view.messages];
    await view.updateComplete;
    frames.releaseAll();

    expect(loadMore).toHaveBeenCalledOnce();
    expect(geometry.scrollTop).toBe(0);
  });

  it("resumes tail following when loaded history still fits", async () => {
    const frames = installFrames();
    const view = await mountedView();
    view.hasMore = true;
    view.onLoadMore = vi.fn();
    view.messageStart = 1;
    await view.updateComplete;
    const geometry = defineMutableScrollGeometry(chatScroller(view), { scrollHeight: 300, clientHeight: 400 });
    frames.releaseAll();

    const button = requiredElement(view.shadowRoot?.querySelector<HTMLButtonElement>(".history-load-button"), "history load button");
    button.click();
    geometry.scrollHeight = 350;
    view.messageStart = 0;
    view.messages = [textMessage("user", "earlier"), ...view.messages];
    await view.updateComplete;
    frames.releaseAll();

    geometry.scrollHeight = 800;
    view.messages = [...view.messages, textMessage("assistant", "live update")];
    await view.updateComplete;
    frames.releaseAll();

    expect(geometry.scrollTop).toBe(400);
  });
});

async function mountedView(): Promise<ChatView> {
  const view = new ChatView();
  view.sessionId = session.id;
  view.selectedMachineId = "local";
  view.sessionCwd = session.cwd;
  view.messages = [textMessage("user", "question"), textMessage("assistant", "answer")];
  view.messageEnd = 2;
  view.messageTotal = 2;
  view.selectedLoad = selectedChatFreshReadable(selectedChatTarget("local", session));
  document.body.append(view);
  await view.updateComplete;
  return view;
}

const session = { id: "session-scroll", cwd: "/repo" };

function chatScroller(view: ChatView): HTMLElement {
  return requiredElement(view.shadowRoot?.querySelector<HTMLElement>(".chat"), "chat scroller");
}

function installFrames(): { releaseAll: () => void } {
  let nextId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = nextId;
    nextId += 1;
    callbacks.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { callbacks.delete(id); });
  return {
    releaseAll: () => {
      while (callbacks.size > 0) {
        const next = callbacks.entries().next();
        if (next.done === true) return;
        const [id, callback] = next.value;
        callbacks.delete(id);
        callback(performance.now());
      }
    },
  };
}

function defineMutableScrollGeometry(
  element: HTMLElement,
  initial: { scrollTop?: number; scrollHeight: number; clientHeight?: number },
): { scrollTop: number; scrollHeight: number; clientHeight: number } {
  const geometry = {
    scrollTop: initial.scrollTop ?? 0,
    scrollHeight: initial.scrollHeight,
    clientHeight: initial.clientHeight ?? 400,
  };
  Object.defineProperties(element, {
    scrollTop: {
      configurable: true,
      get: () => geometry.scrollTop,
      set: (value: number) => { geometry.scrollTop = Math.max(0, Math.min(value, geometry.scrollHeight - geometry.clientHeight)); },
    },
    scrollHeight: { configurable: true, get: () => geometry.scrollHeight },
    clientHeight: { configurable: true, get: () => geometry.clientHeight },
  });
  return geometry;
}

function rect(left: number, top: number, right: number, bottom: number): DOMRect {
  return { left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) };
}

function requiredElement<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${label}`);
  return value;
}
