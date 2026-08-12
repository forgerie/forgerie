// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { textMessage } from "../chatMessages";
import { chatScrollStorageKey } from "../chatScrollPosition";
import { selectedChatFreshReadable, selectedChatLoading, selectedChatTarget } from "../selectedChatLoad";
import { ChatView } from "./ChatView";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ChatView unread reading position", () => {
  it("places the newest agent answer at the viewport top and consumes the one-shot target", async () => {
    const frames = installFrames();
    localStorage.setItem(chatScrollStorageKey(session.id), JSON.stringify({ mode: "anchor", anchorId: "m:1", offset: 0 }));
    const view = await mountView();
    const onApplied = vi.fn();
    view.messages = [
      textMessage("user", "older question"),
      textMessage("assistant", "older answer"),
      textMessage("user", "new question"),
      { role: "assistant", parts: [{ type: "toolCall", toolName: "read", summary: "inspect" }] },
      textMessage("assistant", "new answer"),
    ];
    view.messageEnd = 5;
    view.messageTotal = 5;
    view.selectedLoad = selectedChatFreshReadable(selectedChatTarget("local", session));
    view.initialReadingTarget = { kind: "latest-response", id: "unread-1" };
    view.onInitialReadingTargetApplied = onApplied;
    await view.updateComplete;

    const chat = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(".chat"), "chat scroller");
    const answer = requiredElement(view.shadowRoot?.querySelector<HTMLElement>('article[data-index="4"]'), "latest answer");
    defineScrollGeometry(chat, { scrollTop: 500, scrollHeight: 1_400, clientHeight: 400, top: 100, bottom: 500 });
    answer.getBoundingClientRect = () => rect(260, 340);
    Reflect.set(view, "followMode", { kind: "tail" });
    Reflect.set(view, "lastClientHeight", 200);
    invokeViewHandler(view, "onImageLoad");
    invokeViewHandler(view, "onScroll");

    frames.releaseAll();
    await view.updateComplete;
    await Promise.resolve();

    expect(chat.scrollTop).toBe(660);
    expect(onApplied).toHaveBeenCalledOnce();
    expect(view.shadowRoot?.querySelectorAll(".turn-body.reserved")).toHaveLength(1);
  });

  it("keeps an unread answer fixed while an older image settles", async () => {
    const frames = installFrames();
    const onApplied = vi.fn();
    const view = new ChatView();
    view.sessionId = session.id;
    view.selectedMachineId = "local";
    view.sessionCwd = session.cwd;
    view.messages = [
      textMessage("user", "older question"),
      { role: "tool", parts: [{ type: "image", mimeType: "image/png", data: "QUJD" }] },
      textMessage("assistant", "older answer"),
      textMessage("user", "new question"),
      textMessage("assistant", "new answer"),
    ];
    view.messageEnd = 5;
    view.messageTotal = 5;
    view.selectedLoad = selectedChatFreshReadable(selectedChatTarget("local", session));
    view.initialReadingTarget = { kind: "latest-response", id: "unread-with-image" };
    view.onInitialReadingTargetApplied = onApplied;
    document.body.append(view);
    await view.updateComplete;

    const chat = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(".chat"), "chat scroller");
    const image = requiredElement(view.shadowRoot?.querySelector<HTMLImageElement>("img.chat-image"), "older image");
    const answer = requiredElement(view.shadowRoot?.querySelector<HTMLElement>('[data-scroll-anchor-id="m:4"]'), "unread answer");
    defineScrollGeometry(chat, { scrollTop: 500, scrollHeight: 2_000, clientHeight: 400, top: 100, bottom: 500 });
    let answerContentTop = 800;
    answer.getBoundingClientRect = () => rect(100 + answerContentTop - chat.scrollTop, 180 + answerContentTop - chat.scrollTop);

    frames.releaseAll();
    await view.updateComplete;
    await Promise.resolve();
    expect(onApplied).toHaveBeenCalledOnce();
    expect(answer.getBoundingClientRect().top - chat.getBoundingClientRect().top).toBe(0);
    const alignedScrollTop = chat.scrollTop;

    view.messages = [...view.messages, textMessage("user", "later question from elsewhere")];
    view.messageEnd = 6;
    view.messageTotal = 6;
    await view.updateComplete;

    answerContentTop += 304;
    image.dispatchEvent(new Event("load"));

    expect(chat.scrollTop).toBe(alignedScrollTop + 304);
    expect(answer.getBoundingClientRect().top - chat.getBoundingClientRect().top).toBe(0);
  });

  it("keeps a clamped unread-answer offset when an image below it settles", async () => {
    const frames = installFrames();
    const view = new ChatView();
    view.sessionId = session.id;
    view.selectedMachineId = "local";
    view.sessionCwd = session.cwd;
    view.messages = [
      textMessage("user", "older question"),
      textMessage("assistant", "older answer"),
      textMessage("user", "new question"),
      textMessage("assistant", "new answer"),
      { role: "tool", parts: [{ type: "image", mimeType: "image/png", data: "QUJD" }] },
    ];
    view.messageEnd = 5;
    view.messageTotal = 5;
    view.selectedLoad = selectedChatFreshReadable(selectedChatTarget("local", session));
    view.initialReadingTarget = { kind: "latest-response", id: "unread-clamped" };
    document.body.append(view);
    await view.updateComplete;

    const chat = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(".chat"), "chat scroller");
    const image = requiredElement(view.shadowRoot?.querySelector<HTMLImageElement>("img.chat-image"), "later image");
    const answer = requiredElement(view.shadowRoot?.querySelector<HTMLElement>('[data-scroll-anchor-id="m:3"]'), "unread answer");
    let scrollTop = 500;
    let scrollHeight = 1_160;
    let maxScrollTop = 760;
    Object.defineProperties(chat, {
      scrollTop: { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = Math.min(value, maxScrollTop); } },
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, value: 400 },
    });
    chat.getBoundingClientRect = () => rect(100, 500);
    const answerContentTop = 800;
    answer.getBoundingClientRect = () => rect(100 + answerContentTop - chat.scrollTop, 180 + answerContentTop - chat.scrollTop);

    frames.releaseAll();
    await view.updateComplete;
    await Promise.resolve();
    expect(answer.getBoundingClientRect().top - chat.getBoundingClientRect().top).toBe(40);

    scrollHeight += 304;
    maxScrollTop += 304;
    image.dispatchEvent(new Event("load"));

    expect(chat.scrollTop).toBe(760);
    expect(answer.getBoundingClientRect().top - chat.getBoundingClientRect().top).toBe(40);
  });

  it("waits for fresh history before applying a target from the opening shell", async () => {
    const frames = installFrames();
    const view = await mountView();
    const onApplied = vi.fn();
    const selectedTarget = selectedChatTarget("local", session);
    view.selectedLoad = selectedChatLoading(selectedTarget);
    view.initialReadingTarget = { kind: "latest-response", id: "unread-loading" };
    view.onInitialReadingTargetApplied = onApplied;
    await view.updateComplete;

    frames.releaseAll();
    expect(onApplied).not.toHaveBeenCalled();

    view.messages = [textMessage("user", "question"), textMessage("assistant", "fresh answer")];
    view.messageEnd = 2;
    view.messageTotal = 2;
    view.selectedLoad = selectedChatFreshReadable(selectedTarget);
    await view.updateComplete;
    const chat = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(".chat"), "chat scroller");
    const answer = requiredElement(view.shadowRoot?.querySelector<HTMLElement>('article[data-index="1"]'), "fresh answer");
    defineScrollGeometry(chat, { scrollTop: 0, scrollHeight: 800, clientHeight: 400, top: 100, bottom: 500 });
    const answerRect = vi.fn(() => rect(220, 300));
    answer.getBoundingClientRect = answerRect;

    frames.releaseAll();
    await view.updateComplete;
    await Promise.resolve();

    expect(answerRect).toHaveBeenCalled();
    expect(onApplied).toHaveBeenCalledOnce();
  });

  it("replaces a queued frame when a newer reading target arrives", async () => {
    const frames = installFrames();
    const view = await mountView();
    const onApplied = vi.fn();
    view.messages = [textMessage("user", "question"), textMessage("assistant", "answer")];
    view.messageEnd = 2;
    view.messageTotal = 2;
    view.selectedLoad = selectedChatFreshReadable(selectedChatTarget("local", session));
    view.initialReadingTarget = { kind: "latest-response", id: "target-a" };
    view.onInitialReadingTargetApplied = onApplied;
    await view.updateComplete;

    view.initialReadingTarget = { kind: "latest-response", id: "target-b" };
    await view.updateComplete;
    const chat = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(".chat"), "chat scroller");
    const answer = requiredElement(view.shadowRoot?.querySelector<HTMLElement>('article[data-index="1"]'), "answer");
    defineScrollGeometry(chat, { scrollTop: 0, scrollHeight: 800, clientHeight: 400, top: 100, bottom: 500 });
    answer.getBoundingClientRect = () => rect(220, 300);

    frames.releaseAll();
    await view.updateComplete;
    await Promise.resolve();

    expect(onApplied).toHaveBeenCalledOnce();
    expect(onApplied).toHaveBeenCalledWith({ kind: "latest-response", id: "target-b" });
  });

  it("recomputes the newest response when messages change during the reserved render", async () => {
    const frames = installFrames();
    const view = await mountView();
    const target = { kind: "latest-response" as const, id: "unread-changing" };
    const onApplied = vi.fn();
    view.messages = [textMessage("user", "first question"), textMessage("assistant", "first answer")];
    view.messageEnd = 2;
    view.messageTotal = 2;
    view.selectedLoad = selectedChatFreshReadable(selectedChatTarget("local", session));
    view.initialReadingTarget = target;
    view.onInitialReadingTargetApplied = onApplied;
    await view.updateComplete;

    const applying = invokeAsyncViewHandler(view, "applyInitialReadingTarget", target);
    view.messages = [
      textMessage("user", "first question"),
      textMessage("assistant", "first answer"),
      textMessage("user", "new question"),
      textMessage("assistant", "new answer"),
    ];
    view.messageEnd = 4;
    view.messageTotal = 4;
    await view.updateComplete;
    await applying;
    await view.updateComplete;

    const chat = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(".chat"), "chat scroller");
    const answer = requiredElement(view.shadowRoot?.querySelector<HTMLElement>('article[data-index="3"]'), "new answer");
    defineScrollGeometry(chat, { scrollTop: 0, scrollHeight: 900, clientHeight: 400, top: 100, bottom: 500 });
    answer.getBoundingClientRect = () => rect(220, 300);
    frames.releaseAll();
    await view.updateComplete;
    await Promise.resolve();

    const reserved = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(".turn-body.reserved"), "reserved latest turn");
    expect(reserved.parentElement?.dataset["turnKey"]).toBe("turn:m:2");
    expect(onApplied).toHaveBeenCalledOnce();
  });

  it("restores the saved position when a pending unread target is cleared", async () => {
    const frames = installFrames();
    localStorage.setItem(chatScrollStorageKey(session.id), JSON.stringify({ mode: "anchor", anchorId: "m:0", offset: 20 }));
    const selectedTarget = selectedChatTarget("local", session);
    const view = new ChatView();
    view.sessionId = session.id;
    view.selectedMachineId = "local";
    view.sessionCwd = session.cwd;
    view.selectedLoad = selectedChatLoading(selectedTarget);
    view.initialReadingTarget = { kind: "latest-response", id: "unread-cleared" };
    document.body.append(view);
    await view.updateComplete;

    view.initialReadingTarget = undefined;
    await view.updateComplete;
    view.messages = [textMessage("user", "saved question"), textMessage("assistant", "answer")];
    view.messageEnd = 2;
    view.messageTotal = 2;
    view.selectedLoad = selectedChatFreshReadable(selectedTarget);
    await view.updateComplete;
    const chat = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(".chat"), "chat scroller");
    const savedAnchor = requiredElement(view.shadowRoot?.querySelector<HTMLElement>('article[data-index="0"]'), "saved anchor");
    defineScrollGeometry(chat, { scrollTop: 0, scrollHeight: 900, clientHeight: 400, top: 100, bottom: 500 });
    const savedAnchorRect = vi.fn(() => rect(300, 380));
    savedAnchor.getBoundingClientRect = savedAnchorRect;

    frames.releaseAll();
    await Promise.resolve();

    expect(savedAnchorRect).toHaveBeenCalled();
    expect(chat.scrollTop).not.toBe(chat.scrollHeight);
  });

  it("keeps a restored passage fixed while earlier images settle until the reader scrolls", async () => {
    const frames = installFrames();
    localStorage.setItem(chatScrollStorageKey(session.id), JSON.stringify({ mode: "anchor", anchorId: "m:1", offset: 24 }));
    const view = new ChatView();
    view.sessionId = session.id;
    view.selectedMachineId = "local";
    view.sessionCwd = session.cwd;
    view.messages = [
      { role: "tool", parts: [{ type: "image", mimeType: "image/png", data: "QUJD" }] },
      textMessage("assistant", "saved passage"),
    ];
    view.messageEnd = 2;
    view.messageTotal = 2;
    view.selectedLoad = selectedChatFreshReadable(selectedChatTarget("local", session));
    document.body.append(view);
    await view.updateComplete;

    const chat = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(".chat"), "chat scroller");
    const image = requiredElement(view.shadowRoot?.querySelector<HTMLImageElement>("img.chat-image"), "history image");
    const savedPassage = requiredElement(view.shadowRoot?.querySelector<HTMLElement>('[data-scroll-anchor-id="m:1"]'), "saved passage");
    defineScrollGeometry(chat, { scrollTop: 500, scrollHeight: 1_100, clientHeight: 400, top: 100, bottom: 500 });
    let scrollHeight = 1_100;
    Object.defineProperty(chat, "scrollHeight", { configurable: true, get: () => scrollHeight });
    let passageContentTop = 700;
    savedPassage.getBoundingClientRect = () => rect(100 + passageContentTop - chat.scrollTop, 180 + passageContentTop - chat.scrollTop);

    frames.releaseAll();
    expect(chat.scrollTop).toBe(676);

    passageContentTop += 304;
    scrollHeight += 304;
    image.dispatchEvent(new Event("load"));
    frames.releaseAll();

    expect(chat.scrollTop).toBe(980);
    expect(savedPassage.getBoundingClientRect().top - chat.getBoundingClientRect().top).toBe(24);

    chat.scrollTop = 900;
    chat.dispatchEvent(new Event("scroll"));
    passageContentTop += 304;
    image.dispatchEvent(new Event("load"));

    expect(chat.scrollTop).toBe(900);
  });

  it("falls back to ordinary restoration when the unread turn has no answer", async () => {
    const frames = installFrames();
    const view = await mountView();
    const onApplied = vi.fn();
    view.messages = [textMessage("user", "question without an answer")];
    view.messageEnd = 1;
    view.messageTotal = 1;
    view.selectedLoad = selectedChatFreshReadable(selectedChatTarget("local", session));
    view.initialReadingTarget = { kind: "latest-response", id: "unread-no-answer" };
    view.onInitialReadingTargetApplied = onApplied;
    await view.updateComplete;

    const chat = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(".chat"), "chat scroller");
    defineScrollGeometry(chat, { scrollTop: 0, scrollHeight: 900, clientHeight: 400, top: 100, bottom: 500 });
    frames.releaseAll();
    await Promise.resolve();

    expect(chat.scrollTop).toBe(900);
    expect(onApplied).toHaveBeenCalledOnce();
  });

  it("loads earlier history instead of guessing when the newest turn opener is not loaded", async () => {
    const frames = installFrames();
    const view = await mountView();
    const onLoadMore = vi.fn();
    const onApplied = vi.fn();
    view.messages = [textMessage("assistant", "tail of a long answer")];
    view.messageStart = 100;
    view.messageEnd = 101;
    view.messageTotal = 101;
    view.hasMore = true;
    view.onLoadMore = onLoadMore;
    view.selectedLoad = selectedChatFreshReadable(selectedChatTarget("local", session));
    view.initialReadingTarget = { kind: "latest-response", id: "unread-2" };
    view.onInitialReadingTargetApplied = onApplied;
    await view.updateComplete;

    frames.releaseAll();
    await Promise.resolve();

    expect(onLoadMore).toHaveBeenCalledOnce();
    expect(onApplied).not.toHaveBeenCalled();

    view.loadingMore = true;
    await view.updateComplete;
    view.messages = [textMessage("user", "question"), textMessage("assistant", "tail of a long answer")];
    view.messageStart = 99;
    view.hasMore = false;
    view.loadingMore = false;
    await view.updateComplete;
    const chat = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(".chat"), "chat scroller");
    const answer = requiredElement(view.shadowRoot?.querySelector<HTMLElement>('article[data-index="100"]'), "complete answer");
    defineScrollGeometry(chat, { scrollTop: 0, scrollHeight: 900, clientHeight: 400, top: 100, bottom: 500 });
    const answerRect = vi.fn(() => rect(240, 320));
    answer.getBoundingClientRect = answerRect;

    frames.releaseAll();
    await view.updateComplete;
    await Promise.resolve();

    expect(answerRect).toHaveBeenCalled();
    expect(onApplied).toHaveBeenCalledOnce();
  });
});

const session = { id: "session-unread", cwd: "/repo" };

async function mountView(): Promise<ChatView> {
  const view = new ChatView();
  view.sessionId = session.id;
  view.selectedMachineId = "local";
  view.sessionCwd = session.cwd;
  document.body.append(view);
  await view.updateComplete;
  return view;
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

function invokeViewHandler(view: ChatView, name: string): void {
  const handler: unknown = Reflect.get(view, name);
  if (typeof handler !== "function") throw new Error(`${name} is unavailable`);
  Reflect.apply(handler, view, []);
}

function invokeAsyncViewHandler(view: ChatView, name: string, ...args: unknown[]): Promise<void> {
  const handler: unknown = Reflect.get(view, name);
  if (typeof handler !== "function") throw new Error(`${name} is unavailable`);
  const result: unknown = Reflect.apply(handler, view, args);
  if (!(result instanceof Promise)) throw new Error(`${name} did not return a promise`);
  return result;
}

function defineScrollGeometry(
  element: HTMLElement,
  geometry: { scrollTop: number; scrollHeight: number; clientHeight: number; top: number; bottom: number },
): void {
  Object.defineProperties(element, {
    scrollTop: { configurable: true, writable: true, value: geometry.scrollTop },
    scrollHeight: { configurable: true, value: geometry.scrollHeight },
    clientHeight: { configurable: true, value: geometry.clientHeight },
  });
  element.getBoundingClientRect = () => rect(geometry.top, geometry.bottom);
}

function rect(top: number, bottom: number): DOMRect {
  return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) };
}

function requiredElement<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${label}`);
  return value;
}
