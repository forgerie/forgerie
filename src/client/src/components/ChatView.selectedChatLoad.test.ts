// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { textMessage } from "../chatMessages";
import {
  selectedChatCachedReadable,
  selectedChatFailed,
  selectedChatFreshReadable,
  selectedChatLiveReady,
  selectedChatLoading,
  selectedChatReadOnly,
  type SelectedChatTarget,
} from "../selectedChatLoad";
import { ChatView } from "./ChatView";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ChatView selected-chat load states", () => {
  it("shows a polite opening state without treating an uncached chat as empty", async () => {
    const view = await renderChatView({ selectedLoad: selectedChatLoading(target()), sessionTitle: "Target session" });

    expect(text(view)).toContain("Opening Target session");
    expect(statusText(view)).toContain("Opening Target session");
    expect(text(view)).not.toContain("No messages yet");
    expect(view.shadowRoot?.querySelector("[role='alert']")).toBeNull();
  });

  it("keeps readable transcript content mounted while cached and fresh history update", async () => {
    const view = await renderChatView({
      selectedLoad: selectedChatCachedReadable(target()),
      messages: [textMessage("assistant", "cached answer")],
      messageTotal: 1,
    });

    expect(view.messages).toEqual([textMessage("assistant", "cached answer")]);
    expect(statusText(view)).toContain("Showing cached transcript");

    view.selectedLoad = selectedChatFreshReadable(target());
    await view.updateComplete;

    expect(view.messages).toEqual([textMessage("assistant", "cached answer")]);
    expect(statusText(view)).toContain("Transcript ready");

    view.selectedLoad = selectedChatLiveReady(target());
    await view.updateComplete;

    expect(view.messages).toEqual([textMessage("assistant", "cached answer")]);
    expect(view.shadowRoot?.querySelector("[role='status']")?.textContent ?? "").not.toContain("Transcript ready");
  });

  it("shows a retryable alert without unmounting readable content and restores retry focus on repeated failure", async () => {
    const retry = vi.fn();
    const view = await renderChatView({
      selectedLoad: selectedChatFailed(target(), "fresh", "snapshot failed"),
      messages: [textMessage("assistant", "fresh answer")],
      messageTotal: 1,
      onRetry: retry,
    });

    expect(view.messages).toEqual([textMessage("assistant", "fresh answer")]);
    expect(alertText(view)).toContain("snapshot failed");
    const retryButton = retryButtonFor(view);
    retryButton.click();
    expect(retry).toHaveBeenCalledOnce();

    view.selectedLoad = selectedChatLoading(target(), "fresh");
    await view.updateComplete;
    view.selectedLoad = selectedChatFailed(target(), "fresh", "still failed");
    await view.updateComplete;

    expect(alertText(view)).toContain("still failed");
    expect(view.shadowRoot?.activeElement).toBe(retryButtonFor(view));

    retryButtonFor(view).click();
    view.selectedLoad = selectedChatLiveReady(target());
    await view.updateComplete;
    expect(view.shadowRoot?.querySelector(".chat-load-retry")).toBeNull();
  });

  it("clears pending retry focus when the session identity changes", async () => {
    const retry = vi.fn();
    const view = await renderChatView({
      selectedLoad: selectedChatFailed(target(), "absent", "target failed"),
      onRetry: retry,
    });
    retryButtonFor(view).click();
    expect(retry).toHaveBeenCalledOnce();

    view.sessionId = "other";
    view.sessionTitle = "Other session";
    view.selectedLoad = selectedChatFailed({ ...target(), sessionId: "other" }, "absent", "other failed");
    await view.updateComplete;

    expect(alertText(view)).toContain("other failed");
    expect(view.shadowRoot?.activeElement).not.toBe(retryButtonFor(view));
  });

  it("shows failure without content as an alert in the transcript frame", async () => {
    const view = await renderChatView({ selectedLoad: selectedChatFailed(target(), "absent", "history failed"), sessionTitle: "Target session" });

    expect(alertText(view)).toContain("Could not finish opening Target session");
    expect(alertText(view)).toContain("history failed");
    expect(text(view)).not.toContain("No messages yet");
  });

  it("uses the normal empty-chat treatment for an empty fresh transcript", async () => {
    const view = await renderChatView({ selectedLoad: selectedChatFreshReadable(target()), messageTotal: 0 });

    expect(text(view)).toContain("No messages yet");
    expect(text(view)).not.toContain("Opening");
    expect(view.shadowRoot?.querySelector("[role='status']")).toBeNull();
  });

  it("marks archived history as read-only without enabling live announcements", async () => {
    const view = await renderChatView({
      selectedLoad: selectedChatReadOnly(target(), "fresh"),
      messages: [textMessage("assistant", "archived answer")],
      messageTotal: 1,
    });

    expect(view.messages).toEqual([textMessage("assistant", "archived answer")]);
    expect(text(view)).toContain("Read-only transcript");
    expect(view.shadowRoot?.querySelector("[role='status']")).toBeNull();
  });

  it("reports selected load paint after a frame and later task for the still-current load", async () => {
    vi.useFakeTimers();
    const frames = installHeldFrames();
    const reported: ChatView["selectedLoad"][] = [];
    const view = await renderChatView({
      selectedLoad: selectedChatCachedReadable(target()),
      messages: [textMessage("assistant", "cached answer")],
      messageTotal: 1,
      onSelectedLoadPaint: (load) => { reported.push(load); },
    });

    expect(reported).toEqual([]);
    frames.releaseAll();
    await Promise.resolve();
    await vi.runOnlyPendingTimersAsync();
    expect(reported).toEqual([selectedChatCachedReadable(target())]);

    const staleLoad = selectedChatFreshReadable(target());
    view.selectedLoad = staleLoad;
    await view.updateComplete;
    view.selectedLoad = selectedChatLiveReady(target());
    await view.updateComplete;
    frames.releaseAll();
    await Promise.resolve();
    await vi.runOnlyPendingTimersAsync();

    expect(reported).toEqual([selectedChatCachedReadable(target()), selectedChatLiveReady(target())]);
  });

  it("does not report a scheduled selected load paint after disconnect", async () => {
    vi.useFakeTimers();
    const frames = installHeldFrames();
    const reported = vi.fn();
    const view = await renderChatView({
      selectedLoad: selectedChatFreshReadable(target()),
      messageTotal: 0,
      onSelectedLoadPaint: reported,
    });

    view.remove();
    frames.releaseAll();
    await Promise.resolve();
    await vi.runOnlyPendingTimersAsync();

    expect(reported).not.toHaveBeenCalled();
  });

  it("does not render or report selected load state for a different target identity with the same session id", async () => {
    vi.useFakeTimers();
    const frames = installHeldFrames();
    const reported = vi.fn();
    const view = await renderChatView({
      selectedLoad: selectedChatCachedReadable({ ...target(), cwd: "/other" }),
      messages: [textMessage("assistant", "current transcript")],
      messageTotal: 1,
      onSelectedLoadPaint: reported,
    });

    expect(text(view)).not.toContain("Showing cached transcript");
    frames.releaseAll();
    await Promise.resolve();
    await vi.runOnlyPendingTimersAsync();

    expect(reported).not.toHaveBeenCalled();
  });

  it("cancels a scheduled selected load paint when the session identity changes", async () => {
    vi.useFakeTimers();
    const frames = installHeldFrames();
    const reported = vi.fn();
    const view = await renderChatView({
      selectedLoad: selectedChatFreshReadable(target()),
      messageTotal: 0,
      onSelectedLoadPaint: reported,
    });

    view.sessionId = "other";
    await view.updateComplete;
    frames.releaseAll();
    await Promise.resolve();
    await vi.runOnlyPendingTimersAsync();

    expect(reported).not.toHaveBeenCalled();
  });
});

async function renderChatView(options: {
  selectedLoad: ChatView["selectedLoad"];
  messages?: ChatView["messages"];
  messageTotal?: number;
  sessionTitle?: string;
  onRetry?: () => void;
  onSelectedLoadPaint?: (load: ChatView["selectedLoad"]) => void;
}): Promise<ChatView> {
  const view = new ChatView();
  view.sessionId = target().sessionId;
  view.sessionTitle = options.sessionTitle ?? "Target session";
  view.selectedMachineId = target().machineId;
  view.sessionCwd = target().cwd;
  view.selectedLoad = options.selectedLoad;
  view.messages = options.messages ?? [];
  view.messageTotal = options.messageTotal ?? 0;
  if (options.onRetry !== undefined) view.onRetry = options.onRetry;
  if (options.onSelectedLoadPaint !== undefined) view.onSelectedLoadPaint = options.onSelectedLoadPaint;
  document.body.append(view);
  await view.updateComplete;
  return view;
}

function target(): SelectedChatTarget {
  return { machineId: "local", sessionId: "target", cwd: "/repo" };
}

function text(view: ChatView): string {
  return view.shadowRoot?.textContent ?? "";
}

function statusText(view: ChatView): string {
  return view.shadowRoot?.querySelector("[role='status']")?.textContent ?? "";
}

function alertText(view: ChatView): string {
  return view.shadowRoot?.querySelector("[role='alert']")?.textContent ?? "";
}

function retryButtonFor(view: ChatView): HTMLButtonElement {
  const button = view.shadowRoot?.querySelector<HTMLButtonElement>(".chat-load-retry");
  if (button === null || button === undefined) throw new Error("Expected retry button");
  return button;
}

function installHeldFrames(): { releaseNext: () => void; releaseAll: () => void } {
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
    callbacks[handle - 1] = () => undefined;
  });
  return {
    releaseNext: () => {
      const callback = callbacks.shift();
      if (callback === undefined) throw new Error("No animation frame is waiting");
      callback(performance.now());
    },
    releaseAll: () => {
      while (callbacks.length > 0) callbacks.shift()?.(performance.now());
    },
  };
}
