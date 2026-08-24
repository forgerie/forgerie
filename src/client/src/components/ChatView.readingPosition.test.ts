// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { PendingExtensionDialog, SessionStatus } from "../api";
import { normalizeMessages, textMessage } from "../chatMessages";
import { chatLineReadingAnchorToken, chatReadingPositionStorageKey } from "../chatReadingPosition";
import { ChatScrollCoordinator } from "../chatScrollCoordinator";
import { FOLLOW_FREE } from "../chatFollowMode";
import { selectedChatCachedReadable, selectedChatFreshReadable, selectedChatLiveReady, selectedChatLoading, selectedChatPreviewReadable, selectedChatTarget } from "../selectedChatLoad";
import { ChatView } from "./ChatView";
import type { ChatLine, ToolExecutionPart } from "./shared";
import type { TurnRailLedger } from "./TurnRailLedger";
import type { TurnRailSummary } from "./TurnRailSummary";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
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
  it("restores a saved passage from this browser window", async () => {
    const frames = installFrames();
    const anchorId = userReadingAnchorId("question");
    sessionStorage.setItem(chatReadingPositionStorageKey({ machineId: "local", cwd: session.cwd, sessionId: session.id }), JSON.stringify({ kind: "anchor", anchorId, offset: 20 }));
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
    const anchor = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(`[data-scroll-anchor-id="${anchorId}"]`), "saved message");
    let scrollTop = 0;
    Object.defineProperties(chat, {
      scrollTop: { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = value; } },
      scrollHeight: { configurable: true, value: 1_400 },
      clientHeight: { configurable: true, value: 400 },
    });
    chat.getBoundingClientRect = () => rect(100, 500);
    anchor.getBoundingClientRect = () => rect(600 - scrollTop, 680 - scrollTop);

    frames.releaseAll();

    expect(anchor.getBoundingClientRect().top - chat.getBoundingClientRect().top).toBe(20);
    expect(requiredScrollCoordinator(view).mode).toEqual({ kind: "anchor", position: { kind: "anchor", anchorId, offset: 20 } });

    chat.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", bubbles: true }));
    expect(requiredScrollCoordinator(view).mode).toEqual({ kind: "free" });
  });

  it("loads earlier history until the saved passage is available", async () => {
    const frames = installFrames();
    const onLoadMore = vi.fn();
    const anchorId = userReadingAnchorId("saved question");
    sessionStorage.setItem(chatReadingPositionStorageKey({ machineId: "local", cwd: session.cwd, sessionId: session.id }), JSON.stringify({ kind: "anchor", anchorId, offset: 20 }));
    const view = new ChatView();
    view.sessionId = session.id;
    view.selectedMachineId = "local";
    view.sessionCwd = session.cwd;
    view.messages = normalizeMessages([{ role: "assistant", content: "tail page" }], 3);
    view.messageStart = 3;
    view.messageEnd = 4;
    view.messageTotal = 4;
    view.hasMore = true;
    view.onLoadMore = onLoadMore;
    view.selectedLoad = selectedChatFreshReadable(selectedChatTarget("local", session));
    document.body.append(view);
    await view.updateComplete;

    const chat = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(".chat"), "chat scroller");
    let scrollTop = 0;
    Object.defineProperties(chat, {
      scrollTop: { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = value; } },
      scrollHeight: { configurable: true, value: 1_400 },
      clientHeight: { configurable: true, value: 400 },
    });
    chat.getBoundingClientRect = () => rect(100, 500);
    frames.releaseAll();

    expect(onLoadMore).toHaveBeenCalledOnce();
    expect(requiredScrollCoordinator(view).mode).toEqual({ kind: "free" });

    view.loadingMore = true;
    await view.updateComplete;
    view.messages = normalizeMessages([
      { role: "assistant", content: [{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "src/app.ts" } }] },
      { role: "toolResult", toolCallId: "read-1", toolName: "read", content: [{ type: "text", text: "ok" }], isError: false },
      { role: "user", content: "saved question" },
      { role: "assistant", content: "tail page" },
    ], 0);
    view.messageStart = 0;
    view.messageEnd = 4;
    view.messageTotal = 4;
    view.hasMore = false;
    view.loadingMore = false;
    await view.updateComplete;
    const anchor = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(`[data-scroll-anchor-id="${anchorId}"]`), "loaded saved passage");
    anchor.getBoundingClientRect = () => rect(400 - scrollTop, 480 - scrollTop);
    frames.releaseAll();

    expect(anchor.getBoundingClientRect().top - chat.getBoundingClientRect().top).toBe(20);
    expect(requiredScrollCoordinator(view).mode.kind).toBe("anchor");
  });

  it("waits for active work to finish before loading older saved history", async () => {
    const frames = installFrames();
    const onLoadMore = vi.fn();
    sessionStorage.setItem(chatReadingPositionStorageKey({ machineId: "local", cwd: session.cwd, sessionId: session.id }), JSON.stringify({ kind: "anchor", anchorId: userReadingAnchorId("saved question"), offset: 20 }));
    const view = new ChatView();
    view.sessionId = session.id;
    view.selectedMachineId = "local";
    view.sessionCwd = session.cwd;
    view.messages = normalizeMessages([{ role: "assistant", content: "tail page" }], 3);
    view.messageStart = 3;
    view.messageEnd = 4;
    view.messageTotal = 4;
    view.hasMore = true;
    view.onLoadMore = onLoadMore;
    view.status = sessionStatus(true);
    view.selectedLoad = selectedChatLiveReady(selectedChatTarget("local", session));
    document.body.append(view);
    await view.updateComplete;

    const chat = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(".chat"), "chat scroller");
    defineMutableScrollGeometry(chat);
    frames.releaseAll();
    expect(onLoadMore).not.toHaveBeenCalled();

    view.status = sessionStatus(false);
    await view.updateComplete;
    frames.releaseAll();

    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it("does not loop on an earlier-history failure while restoring", async () => {
    const frames = installFrames();
    const onLoadMore = vi.fn();
    sessionStorage.setItem(chatReadingPositionStorageKey({ machineId: "local", cwd: session.cwd, sessionId: session.id }), JSON.stringify({ kind: "anchor", anchorId: userReadingAnchorId("saved question"), offset: 20 }));
    const view = new ChatView();
    view.sessionId = session.id;
    view.selectedMachineId = "local";
    view.sessionCwd = session.cwd;
    view.messages = normalizeMessages([{ role: "assistant", content: "tail page" }], 3);
    view.messageStart = 3;
    view.messageEnd = 4;
    view.messageTotal = 4;
    view.hasMore = true;
    view.onLoadMore = onLoadMore;
    view.selectedLoad = selectedChatFreshReadable(selectedChatTarget("local", session));
    document.body.append(view);
    await view.updateComplete;

    const chat = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(".chat"), "chat scroller");
    defineMutableScrollGeometry(chat);
    frames.releaseAll();
    expect(onLoadMore).toHaveBeenCalledOnce();

    view.loadingMore = true;
    await view.updateComplete;
    view.loadingMore = false;
    await view.updateComplete;
    frames.releaseAll();

    expect(onLoadMore).toHaveBeenCalledOnce();
    expect(requiredScrollCoordinator(view).mode).toEqual({ kind: "free" });
  });

  it("lets the reader cancel a pending saved-position restore", async () => {
    const frames = installFrames();
    const onLoadMore = vi.fn();
    const anchorId = userReadingAnchorId("saved question");
    sessionStorage.setItem(chatReadingPositionStorageKey({ machineId: "local", cwd: session.cwd, sessionId: session.id }), JSON.stringify({ kind: "anchor", anchorId, offset: 20 }));
    const view = new ChatView();
    view.sessionId = session.id;
    view.selectedMachineId = "local";
    view.sessionCwd = session.cwd;
    view.messages = normalizeMessages([{ role: "assistant", content: "tail page" }], 3);
    view.messageStart = 3;
    view.messageEnd = 4;
    view.messageTotal = 4;
    view.hasMore = true;
    view.onLoadMore = onLoadMore;
    view.selectedLoad = selectedChatFreshReadable(selectedChatTarget("local", session));
    document.body.append(view);
    await view.updateComplete;

    const chat = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(".chat"), "chat scroller");
    const geometry = defineMutableScrollGeometry(chat);
    frames.releaseAll();
    expect(onLoadMore).toHaveBeenCalledOnce();

    geometry.scrollTop = 200;
    chat.dispatchEvent(new WheelEvent("wheel", { deltaY: 120, bubbles: true }));
    view.messages = normalizeMessages([
      { role: "user", content: "saved question" },
      { role: "assistant", content: "tail page" },
    ], 2);
    view.hasMore = false;
    await view.updateComplete;
    const anchor = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(`[data-scroll-anchor-id="${anchorId}"]`), "available saved passage");
    anchor.getBoundingClientRect = () => rect(400 - geometry.scrollTop, 480 - geometry.scrollTop);
    frames.releaseAll();

    expect(anchor.getBoundingClientRect().top - chat.getBoundingClientRect().top).toBe(100);
    expect(requiredScrollCoordinator(view).mode).toEqual({ kind: "free" });
  });

  it("keeps settled fold and preamble-turn anchors stable when adjacent events prepend", async () => {
    const view = new ChatView();
    view.sessionId = session.id;
    view.selectedMachineId = "local";
    view.sessionCwd = session.cwd;
    view.messages = normalizeMessages([{ role: "assistant", content: [{ type: "thinking", thinking: "current" }] }], 2);
    view.messageStart = 2;
    view.messageEnd = 3;
    view.messageTotal = 3;
    view.selectedLoad = selectedChatFreshReadable(selectedChatTarget("local", session));
    document.body.append(view);
    await view.updateComplete;

    const initialGroupAnchor = requiredElement(view.shadowRoot?.querySelector<HTMLElement>("details.event-group"), "initial event group").dataset["scrollAnchorId"];
    const initialTurnAnchor = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(".turn"), "initial preamble turn").dataset["scrollAnchorId"];

    view.messages = normalizeMessages([
      { role: "assistant", content: [{ type: "thinking", thinking: "older" }] },
      { role: "assistant", content: [{ type: "thinking", thinking: "current" }] },
    ], 1);
    view.messageStart = 1;
    await view.updateComplete;

    expect(requiredElement(view.shadowRoot?.querySelector<HTMLElement>("details.event-group"), "expanded event group").dataset["scrollAnchorId"]).toBe(initialGroupAnchor);
    expect(requiredElement(view.shadowRoot?.querySelector<HTMLElement>(".turn"), "expanded preamble turn").dataset["scrollAnchorId"]).toBe(initialTurnAnchor);

    view.messages = normalizeMessages([
      { role: "user", content: "loaded opener" },
      { role: "assistant", content: [{ type: "thinking", thinking: "older" }] },
      { role: "assistant", content: [{ type: "thinking", thinking: "current" }] },
    ], 0);
    view.messageStart = 0;
    await view.updateComplete;

    const openedTurn = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(".turn"), "turn with loaded opener");
    const aliases: unknown = JSON.parse(openedTurn.dataset["scrollAnchorAliases"] ?? "[]");
    expect(aliases).toContain(initialTurnAnchor);
  });

  it("returns to the same passage after switching to another conversation", async () => {
    const frames = installFrames();
    const first = { id: "session-first", cwd: "/repo" };
    const second = { id: "session-second", cwd: "/repo" };
    const view = new ChatView();
    view.sessionId = first.id;
    view.selectedMachineId = "local";
    view.sessionCwd = first.cwd;
    view.messages = [textMessage("user", "first question"), textMessage("assistant", "first answer")];
    view.messageEnd = 2;
    view.messageTotal = 2;
    view.selectedLoad = selectedChatFreshReadable(selectedChatTarget("local", first));
    document.body.append(view);
    await view.updateComplete;

    const chat = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(".chat"), "chat scroller");
    let scrollTop = 0;
    Object.defineProperties(chat, {
      scrollTop: { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = value; } },
      scrollHeight: { configurable: true, value: 1_400 },
      clientHeight: { configurable: true, value: 400 },
    });
    chat.getBoundingClientRect = () => rect(100, 500);
    frames.releaseAll();

    scrollTop = 500;
    const firstAnchor = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(`[data-scroll-anchor-id="${userReadingAnchorId("first question")}"]`), "first passage");
    firstAnchor.getBoundingClientRect = () => rect(630 - scrollTop, 710 - scrollTop);
    chat.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, bubbles: true }));
    chat.dispatchEvent(new Event("scroll"));

    view.sessionId = second.id;
    view.messages = [textMessage("user", "second question"), textMessage("assistant", "second answer")];
    view.selectedLoad = selectedChatFreshReadable(selectedChatTarget("local", second));
    await view.updateComplete;
    frames.releaseAll();

    view.sessionId = first.id;
    view.messages = [textMessage("user", "first question"), textMessage("assistant", "first answer")];
    view.selectedLoad = selectedChatFreshReadable(selectedChatTarget("local", first));
    await view.updateComplete;
    const restoredAnchor = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(`[data-scroll-anchor-id="${userReadingAnchorId("first question")}"]`), "restored first passage");
    restoredAnchor.getBoundingClientRect = () => rect(900 - scrollTop, 980 - scrollTop);
    frames.releaseAll();

    expect(restoredAnchor.getBoundingClientRect().top - chat.getBoundingClientRect().top).toBe(30);
    expect(requiredScrollCoordinator(view).mode.kind).toBe("anchor");
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

  it("does not let an unlatch live-ready scroll take reader control", async () => {
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
    expect(requiredScrollCoordinator(view).mode).toEqual({ kind: "tail" });
  });

  it("reopens the same session at the bottom after the reader moved away", async () => {
    const frames = installFrames();
    const target = selectedChatTarget("local", session);
    const view = new ChatView();
    view.sessionId = session.id;
    view.selectedMachineId = "local";
    view.sessionCwd = session.cwd;
    view.messages = [textMessage("user", "question"), textMessage("assistant", "answer")];
    view.messageEnd = 2;
    view.messageTotal = 2;
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
    scrollTop = 200;
    chat.dispatchEvent(new Event("scroll"));
    expect(requiredScrollCoordinator(view).mode).toEqual({ kind: "free" });

    view.selectedLoad = selectedChatLoading(target, "fresh");
    await view.updateComplete;
    frames.releaseAll();

    expect(scrollTop).toBe(1_200);
    expect(requiredScrollCoordinator(view).mode).toEqual({ kind: "tail" });
  });

  it("restarts bottom placement when the same session is already opening", async () => {
    const frames = installFrames();
    const target = selectedChatTarget("local", session);
    const view = new ChatView();
    view.sessionId = session.id;
    view.selectedMachineId = "local";
    view.sessionCwd = session.cwd;
    view.messages = [textMessage("user", "question"), textMessage("assistant", "answer")];
    view.messageEnd = 2;
    view.messageTotal = 2;
    view.selectedLoad = selectedChatCachedReadable(target);
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
    scrollTop = 200;
    chat.dispatchEvent(new Event("scroll"));
    expect(requiredScrollCoordinator(view).mode).toEqual({ kind: "free" });

    view.selectedLoad = selectedChatCachedReadable(target);
    await view.updateComplete;
    frames.releaseAll();

    expect(scrollTop).toBe(1_200);
    expect(requiredScrollCoordinator(view).mode).toEqual({ kind: "tail" });
  });

  it("keeps the tail when a prompt arrives as session opening finishes", async () => {
    const frames = installFrames();
    const target = selectedChatTarget("local", session);
    const view = new ChatView();
    view.sessionId = session.id;
    view.selectedMachineId = "local";
    view.sessionCwd = session.cwd;
    view.messages = [textMessage("user", "question"), textMessage("assistant", "answer")];
    view.messageEnd = 2;
    view.messageTotal = 2;
    view.selectedLoad = selectedChatPreviewReadable(target);
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

    scrollTop = 0;
    chat.dispatchEvent(new Event("scroll"));
    const pendingDialog: PendingExtensionDialog = {
      dialogId: "opening-dialog",
      kind: "confirm",
      title: "Continue?",
      askedAt: "2026-08-19T12:00:00.000Z",
      runScoped: false,
    };
    view.pendingDialogs = [pendingDialog];
    view.selectedLoad = selectedChatLiveReady(target);
    await view.updateComplete;
    chat.getBoundingClientRect = () => rect(100, 500);
    const dialog = requiredElement(view.shadowRoot?.querySelector<HTMLElement>("extension-dialog-card.open-dialog-card"), "open dialog");
    dialog.getBoundingClientRect = () => rect(200, 260);
    frames.releaseAll();

    expect(scrollTop).toBe(1_200);
    expect(requiredScrollCoordinator(view).mode).toEqual({ kind: "tail" });
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

describe("ChatView expanded ledger growth", () => {
  it("keeps the reader's page fixed when an open live ledger grows above it", async () => {
    const frames = installFrames();
    const view = new ChatView();
    view.sessionId = session.id;
    view.selectedMachineId = "local";
    view.sessionCwd = session.cwd;
    view.messages = [textMessage("user", "question"), toolExecution("read", "archive.ts", "running")];
    view.status = sessionStatus(true);
    view.selectedLoad = selectedChatLiveReady(selectedChatTarget("local", session));
    document.body.append(view);
    await view.updateComplete;
    await view.updateComplete;

    const chat = requiredElement(view.shadowRoot?.querySelector<HTMLElement>(".chat"), "chat scroller");
    let scrollTop = 300;
    Object.defineProperties(chat, {
      scrollTop: { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = value; } },
      scrollHeight: { configurable: true, value: 1_200 },
      clientHeight: { configurable: true, value: 400 },
    });
    chat.getBoundingClientRect = () => rect(0, 400);
    frames.releaseAll();
    scrollTop = 300;

    const summary = requiredElement(view.shadowRoot?.querySelector<TurnRailSummary>("turn-rail-summary"), "turn summary");
    const disclosure = requiredElement(summary.shadowRoot?.querySelector<HTMLButtonElement>("button.disclosure"), "rail disclosure");
    disclosure.click();
    await view.updateComplete;
    await view.updateComplete;

    const anchor = requiredElement(view.shadowRoot?.querySelector<HTMLElement>("[data-rail-growth-anchor]"), "rail growth anchor");
    const compactLedger = requiredElement(view.shadowRoot?.querySelector<TurnRailLedger>("turn-rail-ledger"), "compact ledger");
    anchor.getBoundingClientRect = () => compactLedger.shadowRoot?.querySelectorAll("details").length === 1
      ? rect(-12, -12)
      : rect(38, 38);
    requiredScrollCoordinator(view).follow(FOLLOW_FREE);

    view.messages = [...view.messages, toolExecution("edit", "ChatView.ts", "running")];
    await view.updateComplete;
    await compactLedger.updateComplete;
    await Promise.resolve();
    frames.releaseAll();

    expect(scrollTop).toBe(350);
    expect(requiredScrollCoordinator(view).mode).toEqual({ kind: "free" });
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

function toolExecution(toolName: string, summary: string, status: ToolExecutionPart["status"]): ChatLine {
  return { role: "tool", parts: [{ type: "toolExecution", toolName, summary, status }] };
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

function userReadingAnchorId(text: string): string {
  const token = chatLineReadingAnchorToken(textMessage("user", text));
  if (token === undefined) throw new Error("Expected a user reading anchor token");
  return `message:${token}`;
}

function defineMutableScrollGeometry(element: HTMLElement): { scrollTop: number } {
  const geometry = { scrollTop: 0 };
  Object.defineProperties(element, {
    scrollTop: { configurable: true, get: () => geometry.scrollTop, set: (value: number) => { geometry.scrollTop = value; } },
    scrollHeight: { configurable: true, value: 1_400 },
    clientHeight: { configurable: true, value: 400 },
  });
  element.getBoundingClientRect = () => rect(100, 500);
  return geometry;
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
