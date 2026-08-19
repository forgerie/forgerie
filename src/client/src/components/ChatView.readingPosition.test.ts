// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { PendingExtensionDialog, SessionStatus } from "../api";
import { textMessage } from "../chatMessages";
import { ChatScrollCoordinator } from "../chatScrollCoordinator";
import { selectedChatFreshReadable, selectedChatLiveReady, selectedChatLoading, selectedChatPreviewReadable, selectedChatTarget } from "../selectedChatLoad";
import { ChatView } from "./ChatView";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ChatView loading-time reader takeover", () => {
  it("keeps reader ownership when scrolling starts before history is ready", async () => {
    const frames = installFrames();
    const selectedTarget = selectedChatTarget("local", session);
    const view = new ChatView();
    view.sessionId = session.id;
    view.selectedMachineId = "local";
    view.sessionCwd = session.cwd;
    view.selectedLoad = selectedChatLoading(selectedTarget);
    document.body.append(view);
    await view.updateComplete;

    const chat = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(".chat"), "chat scroller");
    let scrollTop = 0;
    let scrollHeight = 0;
    Object.defineProperties(chat, {
      scrollTop: { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = value; } },
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, value: 400 },
    });

    scrollTop = 10;
    chat.dispatchEvent(new Event("scroll"));
    expect(requiredScrollCoordinator(view).mode).toEqual({ kind: "tail" });
    scrollTop = 0;

    chat.dispatchEvent(new WheelEvent("wheel", { deltaY: -1, bubbles: true }));
    frames.releaseAll();
    expect(requiredScrollCoordinator(view).mode).toEqual({ kind: "free" });

    scrollHeight = 1_200;
    view.messages = [textMessage("user", "question"), textMessage("assistant", "answer")];
    view.messageEnd = 2;
    view.messageTotal = 2;
    view.selectedLoad = selectedChatLoading(selectedTarget, "fresh");
    await view.updateComplete;
    frames.releaseAll();

    expect(scrollTop).toBe(0);
    expect(requiredScrollCoordinator(view).mode).toEqual({ kind: "free" });

    scrollTop = 800;
    chat.dispatchEvent(new Event("scroll"));
    expect(requiredScrollCoordinator(view).mode).toEqual({ kind: "tail" });
  });

  it("lets a gesture take control while preview history is opening", async () => {
    const frames = installFrames();
    const selectedTarget = selectedChatTarget("local", session);
    const view = new ChatView();
    view.sessionId = session.id;
    view.selectedMachineId = "local";
    view.sessionCwd = session.cwd;
    view.messages = [textMessage("user", "preview question"), textMessage("assistant", "preview answer")];
    view.messageEnd = 2;
    view.messageTotal = 2;
    view.selectedLoad = selectedChatPreviewReadable(selectedTarget);
    document.body.append(view);
    await view.updateComplete;

    const chat = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(".chat"), "chat scroller");
    let scrollTop = 0;
    Object.defineProperties(chat, {
      scrollTop: { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = value; } },
      scrollHeight: { configurable: true, value: 1_200 },
      clientHeight: { configurable: true, value: 400 },
    });

    chat.dispatchEvent(new WheelEvent("wheel", { deltaY: -1, bubbles: true }));
    frames.releaseAll();
    expect(requiredScrollCoordinator(view).mode).toEqual({ kind: "free" });
    expect(scrollTop).toBe(0);

    view.messages = [...view.messages, textMessage("assistant", "fresh answer")];
    view.messageEnd = 3;
    view.messageTotal = 3;
    view.selectedLoad = selectedChatFreshReadable(selectedTarget);
    await view.updateComplete;
    frames.releaseAll();

    expect(requiredScrollCoordinator(view).mode).toEqual({ kind: "free" });
    expect(scrollTop).toBe(0);
  });
});

describe("ChatView session opening position", () => {
  it("opens at the bottom instead of restoring a saved passage", async () => {
    const frames = installFrames();
    localStorage.setItem(`pi-web:chat-scroll:${session.id}`, JSON.stringify({ mode: "anchor", anchorId: "m:0", offset: 20 }));
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

    const chat = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(".chat"), "chat scroller");
    defineScrollGeometry(chat, { scrollTop: 0, scrollHeight: 1_400, clientHeight: 400 });

    frames.releaseAll();

    expect(chat.scrollTop).toBe(1_400);
    expect(requiredScrollCoordinator(view).mode).toEqual({ kind: "tail" });
  });

  it("follows fresh history to the bottom as soon as it arrives", async () => {
    const frames = installFrames();
    const selectedTarget = selectedChatTarget("local", session);
    const view = new ChatView();
    view.sessionId = session.id;
    view.selectedMachineId = "local";
    view.sessionCwd = session.cwd;
    view.selectedLoad = selectedChatLoading(selectedTarget);
    document.body.append(view);
    await view.updateComplete;

    const chat = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(".chat"), "chat scroller");
    let scrollTop = 0;
    let scrollHeight = 0;
    Object.defineProperties(chat, {
      scrollTop: { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = value; } },
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, value: 400 },
    });
    frames.releaseAll();

    scrollHeight = 1_200;
    view.messages = [textMessage("user", "question"), textMessage("assistant", "answer")];
    view.messageEnd = 2;
    view.messageTotal = 2;
    view.selectedLoad = selectedChatFreshReadable(selectedTarget);
    await view.updateComplete;
    frames.releaseAll();

    expect(scrollTop).toBe(1_200);
    expect(requiredScrollCoordinator(view).mode).toEqual({ kind: "tail" });
  });

  it("keeps earlier-history loading disabled until current work finishes", async () => {
    const view = await mountView();
    const onLoadMore = vi.fn();
    view.messages = [textMessage("assistant", "current")];
    view.messageStart = 1;
    view.messageEnd = 2;
    view.messageTotal = 2;
    view.hasMore = true;
    view.onLoadMore = onLoadMore;
    view.status = sessionStatus(true);
    await view.updateComplete;

    const button = requiredElement(view.shadowRoot?.querySelector<HTMLButtonElement>(".history-load-button"), "history load button");
    expect(button.disabled).toBe(true);
    expect(view.shadowRoot?.textContent).toContain("Earlier messages are available when current work finishes");
    button.click();
    expect(onLoadMore).not.toHaveBeenCalled();

    view.status = sessionStatus(false);
    await view.updateComplete;
    expect(button.disabled).toBe(false);
    button.click();
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it("resets to the bottom when machine and cwd change under the same session id", async () => {
    const frames = installFrames();
    const localTarget = selectedChatTarget("local", session);
    const view = new ChatView();
    view.sessionId = session.id;
    view.selectedMachineId = "local";
    view.sessionCwd = session.cwd;
    view.messages = [textMessage("user", "question"), textMessage("assistant", "answer")];
    view.messageEnd = 2;
    view.messageTotal = 2;
    view.selectedLoad = selectedChatFreshReadable(localTarget);
    document.body.append(view);
    await view.updateComplete;

    const chat = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(".chat"), "chat scroller");
    let scrollTop = 0;
    Object.defineProperties(chat, {
      scrollTop: { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = value; } },
      scrollHeight: { configurable: true, value: 1_200 },
      clientHeight: { configurable: true, value: 400 },
    });
    frames.releaseAll();

    scrollTop = 400;
    chat.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, bubbles: true }));
    expect(requiredScrollCoordinator(view).mode).toEqual({ kind: "free" });

    const pendingDialog: PendingExtensionDialog = {
      dialogId: "opening-dialog",
      kind: "confirm",
      title: "Continue?",
      askedAt: "2026-08-19T12:00:00.000Z",
      runScoped: false,
    };
    view.selectedMachineId = "remote";
    view.sessionCwd = "/other";
    view.selectedLoad = selectedChatFreshReadable(selectedChatTarget("remote", { id: session.id, cwd: "/other" }));
    view.pendingDialogs = [pendingDialog];
    await view.updateComplete;
    chat.getBoundingClientRect = () => rect(100, 500);
    const dialog = requiredElement(view.shadowRoot?.querySelector<HTMLElement>("extension-dialog-card.open-dialog-card"), "open dialog");
    dialog.getBoundingClientRect = () => rect(200, 260);
    frames.releaseAll();

    expect(scrollTop).toBe(1_200);
    expect(requiredScrollCoordinator(view).mode).toEqual({ kind: "tail" });
  });

  it("does not page earlier history when opening layout moves the tail", async () => {
    const frames = installFrames();
    const loadEarlier = vi.fn();
    const view = new ChatView();
    view.sessionId = session.id;
    view.selectedMachineId = "local";
    view.sessionCwd = session.cwd;
    view.messages = [textMessage("user", "question"), textMessage("assistant", "answer")];
    view.messageEnd = 2;
    view.messageTotal = 200;
    view.hasMore = true;
    view.onLoadMore = loadEarlier;
    view.selectedLoad = selectedChatFreshReadable(selectedChatTarget("local", session));
    document.body.append(view);
    await view.updateComplete;

    const chat = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(".chat"), "chat scroller");
    let scrollTop = 0;
    Object.defineProperties(chat, {
      scrollTop: { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = value; } },
      scrollHeight: { configurable: true, value: 1_200 },
      clientHeight: { configurable: true, value: 400 },
    });
    frames.releaseAll();
    expect(scrollTop).toBe(1_200);

    scrollTop = 0;
    chat.dispatchEvent(new Event("scroll"));
    frames.releaseAll();

    expect(loadEarlier).not.toHaveBeenCalled();
    expect(requiredScrollCoordinator(view).mode).toEqual({ kind: "tail" });
  });

  it("does not page earlier history from an unlatch live-ready scroll", async () => {
    const frames = installFrames();
    const loadEarlier = vi.fn();
    const view = new ChatView();
    view.sessionId = session.id;
    view.selectedMachineId = "local";
    view.sessionCwd = session.cwd;
    view.messages = [textMessage("user", "question"), textMessage("assistant", "answer")];
    view.messageEnd = 2;
    view.messageTotal = 200;
    view.hasMore = true;
    view.onLoadMore = loadEarlier;
    view.selectedLoad = selectedChatLiveReady(selectedChatTarget("local", session));
    document.body.append(view);
    await view.updateComplete;

    const chat = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(".chat"), "chat scroller");
    let scrollTop = 0;
    Object.defineProperties(chat, {
      scrollTop: { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = value; } },
      scrollHeight: { configurable: true, value: 1_200 },
      clientHeight: { configurable: true, value: 400 },
    });
    frames.releaseAll();

    scrollTop = 20;
    chat.dispatchEvent(new Event("scroll"));
    frames.releaseAll();

    expect(loadEarlier).not.toHaveBeenCalled();
    expect(requiredScrollCoordinator(view).mode).toEqual({ kind: "free" });
  });

  it("pages earlier history after the reader scrolls near the top", async () => {
    const frames = installFrames();
    const loadEarlier = vi.fn();
    const view = new ChatView();
    view.sessionId = session.id;
    view.selectedMachineId = "local";
    view.sessionCwd = session.cwd;
    view.messages = [textMessage("user", "question"), textMessage("assistant", "answer")];
    view.messageEnd = 2;
    view.messageTotal = 200;
    view.hasMore = true;
    view.onLoadMore = loadEarlier;
    view.selectedLoad = selectedChatLiveReady(selectedChatTarget("local", session));
    document.body.append(view);
    await view.updateComplete;

    const chat = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(".chat"), "chat scroller");
    let scrollTop = 0;
    Object.defineProperties(chat, {
      scrollTop: { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = value; } },
      scrollHeight: { configurable: true, value: 1_200 },
      clientHeight: { configurable: true, value: 400 },
    });
    frames.releaseAll();

    chat.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, bubbles: true }));
    scrollTop = 20;
    chat.dispatchEvent(new Event("scroll"));
    frames.releaseAll();

    expect(loadEarlier).toHaveBeenCalledOnce();
    expect(requiredScrollCoordinator(view).mode).toEqual({ kind: "free" });
  });

  it("does not page earlier history when the reader moves toward newer content", async () => {
    const frames = installFrames();
    const loadEarlier = vi.fn();
    const view = new ChatView();
    view.sessionId = session.id;
    view.selectedMachineId = "local";
    view.sessionCwd = session.cwd;
    view.messages = [textMessage("user", "question"), textMessage("assistant", "answer")];
    view.messageEnd = 2;
    view.messageTotal = 200;
    view.hasMore = true;
    view.onLoadMore = loadEarlier;
    view.selectedLoad = selectedChatLiveReady(selectedChatTarget("local", session));
    document.body.append(view);
    await view.updateComplete;

    const chat = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(".chat"), "chat scroller");
    let scrollTop = 0;
    Object.defineProperties(chat, {
      scrollTop: { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = value; } },
      scrollHeight: { configurable: true, value: 1_200 },
      clientHeight: { configurable: true, value: 400 },
    });
    frames.releaseAll();

    scrollTop = 20;
    chat.dispatchEvent(new Event("scroll"));
    chat.dispatchEvent(new WheelEvent("wheel", { deltaY: 120, bubbles: true }));
    chat.dispatchEvent(new Event("scroll"));
    frames.releaseAll();

    expect(loadEarlier).not.toHaveBeenCalled();
  });

  it("keeps following the tail when older history cannot scroll yet", async () => {
    const frames = installFrames();
    const loadEarlier = vi.fn();
    const view = new ChatView();
    view.sessionId = session.id;
    view.selectedMachineId = "local";
    view.sessionCwd = session.cwd;
    view.messages = [textMessage("user", "question"), textMessage("assistant", "answer")];
    view.messageEnd = 2;
    view.messageTotal = 200;
    view.hasMore = true;
    view.onLoadMore = loadEarlier;
    view.selectedLoad = selectedChatLiveReady(selectedChatTarget("local", session));
    document.body.append(view);
    await view.updateComplete;

    const chat = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(".chat"), "chat scroller");
    Object.defineProperties(chat, {
      scrollTop: { configurable: true, get: () => 0, set: () => undefined },
      scrollHeight: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 400 },
    });
    frames.releaseAll();

    chat.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, bubbles: true }));
    frames.releaseAll();

    expect(loadEarlier).not.toHaveBeenCalled();
    expect(requiredScrollCoordinator(view).mode).toEqual({ kind: "tail" });
  });

  it("clears earlier-history intent when the same session reopens", async () => {
    const frames = installFrames();
    const loadEarlier = vi.fn();
    const target = selectedChatTarget("local", session);
    const view = new ChatView();
    view.sessionId = session.id;
    view.selectedMachineId = "local";
    view.sessionCwd = session.cwd;
    view.messages = [textMessage("user", "question"), textMessage("assistant", "answer")];
    view.messageEnd = 2;
    view.messageTotal = 200;
    view.hasMore = true;
    view.onLoadMore = loadEarlier;
    view.selectedLoad = selectedChatLiveReady(target);
    document.body.append(view);
    await view.updateComplete;

    const chat = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(".chat"), "chat scroller");
    let scrollTop = 0;
    Object.defineProperties(chat, {
      scrollTop: { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = value; } },
      scrollHeight: { configurable: true, value: 1_200 },
      clientHeight: { configurable: true, value: 400 },
    });
    frames.releaseAll();

    chat.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, bubbles: true }));
    frames.releaseAll();
    expect(loadEarlier).not.toHaveBeenCalled();
    expect(requiredScrollCoordinator(view).mode).toEqual({ kind: "free" });

    scrollTop = 0;
    view.messages = [...view.messages, textMessage("assistant", "fresh answer")];
    view.selectedLoad = selectedChatLoading(target, "fresh");
    await view.updateComplete;
    frames.releaseAll();

    expect(loadEarlier).not.toHaveBeenCalled();
  });
});

async function mountView(): Promise<ChatView> {
  const view = new ChatView();
  view.sessionId = session.id;
  view.selectedMachineId = "local";
  view.sessionCwd = session.cwd;
  document.body.append(view);
  await view.updateComplete;
  return view;
}

function sessionStatus(isStreaming: boolean): SessionStatus {
  return {
    sessionId: session.id,
    isStreaming,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  };
}

const session = { id: "session-unread", cwd: "/repo" };

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
  const releaseOne = () => {
    const next = callbacks.entries().next();
    if (next.done === true) return;
    const [id, callback] = next.value;
    callbacks.delete(id);
    callback(performance.now());
  };
  return {
    releaseAll: () => {
      while (callbacks.size > 0) releaseOne();
    },
  };
}

function defineScrollGeometry(
  element: HTMLElement,
  geometry: { scrollTop: number; scrollHeight: number; clientHeight: number },
): void {
  Object.defineProperties(element, {
    scrollTop: { configurable: true, writable: true, value: geometry.scrollTop },
    scrollHeight: { configurable: true, value: geometry.scrollHeight },
    clientHeight: { configurable: true, value: geometry.clientHeight },
  });
}

function rect(top: number, bottom: number): DOMRect {
  return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) };
}

function requiredElement<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${label}`);
  return value;
}

function requiredScrollCoordinator(view: ChatView): ChatScrollCoordinator {
  const value: unknown = Reflect.get(view, "scrolling");
  if (!(value instanceof ChatScrollCoordinator)) throw new Error("Expected chat scroll coordinator");
  return value;
}
