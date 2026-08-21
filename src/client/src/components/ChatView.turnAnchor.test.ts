// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AskUserOutcome } from "../../../shared/apiTypes";
import type { PendingExtensionDialog } from "../api";
import { selectedChatLiveReady, selectedChatLoading, selectedChatTarget } from "../selectedChatLoad";
import { ChatView } from "./ChatView";
import type { ChatLine } from "./shared";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

const said = (role: ChatLine["role"], text: string): ChatLine => ({ role, parts: [{ type: "text", text }] });

async function loadedTranscript(messages: ChatLine[]): Promise<ChatView> {
  const view = new ChatView();
  view.sessionId = "session-1";
  view.messages = messages;
  document.body.append(view);
  await view.updateComplete;
  await view.updateComplete;
  return view;
}

function scroller(view: ChatView): HTMLElement {
  const chat = view.shadowRoot?.querySelector<HTMLElement>(".chat");
  if (chat === null || chat === undefined) throw new Error("The transcript did not render its scroller");
  return chat;
}

function reservedTurnKeys(view: ChatView): (string | null)[] {
  return [...view.shadowRoot?.querySelectorAll<HTMLElement>(".turn-body.reserved") ?? []]
    .map((body) => body.closest(".turn")?.getAttribute("data-turn-key") ?? null);
}

function followMode(view: ChatView): unknown {
  const scrolling: unknown = Reflect.get(view, "scrolling");
  return typeof scrolling === "object" && scrolling !== null ? Reflect.get(scrolling, "mode") : undefined;
}

/** Run one of the transcript's own alignment routines and report whether it found its target. */
function aligned(view: ChatView, method: "alignOpenAskToTop" | "alignOpenDialogToTop"): boolean {
  const align: unknown = Reflect.get(view, method);
  if (typeof align !== "function") throw new Error(`ChatView has no ${method}`);
  return align.call(view) === true;
}

/** Pull the transcript back the way a reader does, from somewhere above its foot. */
async function readerScrollsUp(view: ChatView): Promise<void> {
  const chat = scroller(view);
  chat.scrollTop = 400;
  chat.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, bubbles: true }));
  await view.updateComplete;
}

describe("ChatView running-turn tail", () => {
  const askedQuestion = {
    askId: "ask-open",
    askedAt: "2026-07-20T10:00:00.000Z",
    questions: [{ id: "editor", question: "Which editor?", options: [{ value: "vim", label: "Vim" }] }],
  };

  const answeredQuestion: AskUserOutcome = {
    askId: "ask-done",
    reason: "submitted",
    askedAt: "2026-07-20T10:00:00.000Z",
    closedAt: "2026-07-20T10:05:00.000Z",
    questions: [{
      question: { id: "editor", question: "Which editor?", options: [{ value: "vim", label: "Vim" }] },
      answered: true,
      values: ["vim"],
    }],
    answeredCount: 1,
    unansweredIds: [],
    summary: "Answered 1 of 1",
  };

  const openDialog: PendingExtensionDialog = {
    dialogId: "dlg-1",
    kind: "confirm",
    title: "Allow file writes?",
    askedAt: "2026-07-27T10:00:00.000Z",
    runScoped: false,
  };

  it("renders the open question inside the turn that asked it", async () => {
    const view = await loadedTranscript([said("user", "question"), said("assistant", "working")]);
    view.pendingAsk = askedQuestion;
    await view.updateComplete;

    const card = view.shadowRoot?.querySelector("ask-user-card.open-ask-card");
    expect(card?.closest(".turn")?.getAttribute("data-turn-key")).toBe("turn:m:0");
    expect(aligned(view, "alignOpenAskToTop")).toBe(true);
  });

  it("renders the open extension dialog inside the turn that raised it", async () => {
    const view = await loadedTranscript([said("user", "question")]);
    view.pendingDialogs = [openDialog];
    await view.updateComplete;

    const card = view.shadowRoot?.querySelector("extension-dialog-card.open-dialog-card");
    expect(card?.closest(".turn")?.getAttribute("data-turn-key")).toBe("turn:m:0");
    expect(aligned(view, "alignOpenDialogToTop")).toBe(true);
  });

  it("keeps the tail reachable in a session with no turns yet", async () => {
    const view = await loadedTranscript([]);
    view.pendingAsk = askedQuestion;
    await view.updateComplete;

    expect(view.shadowRoot?.querySelector(".chat > ask-user-card.open-ask-card")).not.toBeNull();
    expect(aligned(view, "alignOpenAskToTop")).toBe(true);
  });

  it("does not mistake a past question in the transcript for the open one", async () => {
    const view = await loadedTranscript([{ role: "assistant", parts: [{ type: "askUserRecord", outcome: answeredQuestion }] }]);

    expect(view.shadowRoot?.querySelector("ask-user-card")).not.toBeNull();
    expect(view.shadowRoot?.querySelector("ask-user-card.open-ask-card")).toBeNull();
    expect(aligned(view, "alignOpenAskToTop")).toBe(false);
  });
});

describe("ChatView turn anchoring", () => {
  it("anchors a turn that opens at the foot and reserves the space its reply needs", async () => {
    const view = await loadedTranscript([said("user", "first question"), said("assistant", "first answer")]);
    expect(followMode(view)).toEqual({ kind: "tail" });
    expect(reservedTurnKeys(view)).toEqual([]);

    view.messages = [...view.messages, said("user", "second question")];
    await view.updateComplete;

    expect(followMode(view)).toEqual({ kind: "turn", turnKey: "turn:m:2" });
    expect(reservedTurnKeys(view)).toEqual(["turn:m:2"]);
  });

  it("keeps holding the anchored turn while the reply streams in", async () => {
    const view = await loadedTranscript([said("assistant", "earlier answer")]);
    view.messages = [...view.messages, said("user", "question")];
    await view.updateComplete;

    for (const piece of ["an answer", "an answer arriving", "an answer arriving in pieces"]) {
      view.messages = [...view.messages.slice(0, 2), said("assistant", piece)];
      await view.updateComplete;
      expect(followMode(view)).toEqual({ kind: "turn", turnKey: "turn:m:1" });
    }
    expect(reservedTurnKeys(view)).toEqual(["turn:m:1"]);
  });

  it("moves the reservation to the newest turn rather than reserving both", async () => {
    const view = await loadedTranscript([said("user", "first question")]);
    view.messages = [...view.messages, said("user", "second question")];
    await view.updateComplete;

    expect(reservedTurnKeys(view)).toEqual(["turn:m:1"]);
  });

  it("leaves a reader who scrolled away where they are", async () => {
    const view = await loadedTranscript([said("user", "question"), said("assistant", "answer")]);
    await readerScrollsUp(view);
    expect(followMode(view)).toEqual({ kind: "free" });

    view.messages = [...view.messages, said("user", "a turn from somewhere else")];
    await view.updateComplete;

    expect(followMode(view)).toEqual({ kind: "free" });
    expect(reservedTurnKeys(view)).toEqual([]);
  });

  it("anchors a scrolled-away reader to the turn they sent themselves", async () => {
    const view = await loadedTranscript([said("user", "question"), said("assistant", "answer")]);
    await readerScrollsUp(view);

    view.isSendingPrompt = true;
    await view.updateComplete;
    view.messages = [...view.messages, said("user", "my own next question")];
    await view.updateComplete;

    expect(followMode(view)).toEqual({ kind: "turn", turnKey: "turn:m:2" });
  });

  it("anchors a locally sent turn while history is still opening", async () => {
    const target = selectedChatTarget("local", { id: "session-1", cwd: "/repo" });
    const view = new ChatView();
    view.sessionId = "session-1";
    view.sessionCwd = "/repo";
    view.messages = [said("user", "earlier question"), said("assistant", "earlier answer")];
    view.selectedLoad = selectedChatLoading(target, "fresh");
    document.body.append(view);
    await view.updateComplete;

    view.isSendingPrompt = true;
    await view.updateComplete;
    view.messages = [...view.messages, said("user", "my opening prompt")];
    await view.updateComplete;

    expect(followMode(view)).toEqual({ kind: "turn", turnKey: "turn:m:2" });

    view.selectedLoad = selectedChatLiveReady(target);
    await view.updateComplete;
    await readerScrollsUp(view);
    view.messages = [...view.messages, said("user", "remote next turn")];
    await view.updateComplete;

    expect(followMode(view)).toEqual({ kind: "free" });
  });

  it("does not anchor the turn a session opens on", async () => {
    const view = await loadedTranscript([said("user", "question"), said("assistant", "answer")]);

    expect(followMode(view)).toEqual({ kind: "tail" });
    expect(reservedTurnKeys(view)).toEqual([]);
  });

  it("does not anchor a transcript that arrives after the session is selected", async () => {
    const view = await loadedTranscript([]);

    view.messages = [said("user", "first question"), said("assistant", "answer"), said("user", "latest question")];
    await view.updateComplete;

    expect(followMode(view)).toEqual({ kind: "tail" });
    expect(reservedTurnKeys(view)).toEqual([]);
  });

  it("anchors the first turn of a session that had none", async () => {
    const view = await loadedTranscript([]);

    view.messages = [said("user", "first question")];
    await view.updateComplete;

    expect(followMode(view)).toEqual({ kind: "turn", turnKey: "turn:m:0" });
  });

  it("keeps the reservation standing when the reader returns to the tail", async () => {
    const view = await loadedTranscript([said("user", "question")]);
    view.messages = [...view.messages, said("user", "second question")];
    await view.updateComplete;
    expect(reservedTurnKeys(view)).toEqual(["turn:m:1"]);

    const chat = scroller(view);
    Object.defineProperties(chat, {
      scrollTop: { configurable: true, writable: true, value: 600 },
      scrollHeight: { configurable: true, value: 1_000 },
      clientHeight: { configurable: true, value: 400 },
    });
    chat.dispatchEvent(new Event("scroll"));
    await view.updateComplete;

    expect(followMode(view)).toEqual({ kind: "tail" });
    expect(reservedTurnKeys(view)).toEqual(["turn:m:1"]);
  });

  it("releases a standing reservation when the viewport resizes while the session is idle", async () => {
    const view = await loadedTranscript([said("user", "question")]);
    view.messages = [...view.messages, said("user", "second question")];
    await view.updateComplete;
    expect(reservedTurnKeys(view)).toEqual(["turn:m:1"]);

    window.dispatchEvent(new Event("resize"));
    await view.updateComplete;

    expect(reservedTurnKeys(view)).toEqual([]);
  });

  it("keeps the reservation when the viewport resizes while the reply is still arriving", async () => {
    const view = await loadedTranscript([said("assistant", "earlier answer")]);
    view.isSendingPrompt = true;
    await view.updateComplete;
    view.messages = [...view.messages, said("user", "question")];
    await view.updateComplete;
    expect(reservedTurnKeys(view)).toEqual(["turn:m:1"]);

    window.dispatchEvent(new Event("resize"));
    await view.updateComplete;

    expect(followMode(view)).toEqual({ kind: "turn", turnKey: "turn:m:1" });
    expect(reservedTurnKeys(view)).toEqual(["turn:m:1"]);
  });

  it("cancels a queued automatic placement when the reader pulls back", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const view = await loadedTranscript([said("user", "question"), said("assistant", "answer")]);
    frames.length = 0;
    const chat = scroller(view);
    let scrollTop = 400;
    Object.defineProperties(chat, {
      scrollTop: { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = value; } },
      scrollHeight: { configurable: true, value: 1_200 },
      clientHeight: { configurable: true, value: 400 },
    });

    const scrollToBottom: unknown = Reflect.get(view, "scrollToBottom");
    if (typeof scrollToBottom !== "function") throw new Error("ChatView has no scrollToBottom");
    Reflect.apply(scrollToBottom, view, []);
    chat.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, bubbles: true }));
    frames.splice(0).forEach((callback) => { callback(performance.now()); });

    expect(scrollTop).toBe(400);
    expect(followMode(view)).toEqual({ kind: "free" });
  });
});
