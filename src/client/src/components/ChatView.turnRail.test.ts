// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { SessionStatus } from "../api";
import { ChatView } from "./ChatView";
import type { ChatLine } from "./shared";

afterEach(() => {
  document.body.replaceChildren();
});

const said = (role: ChatLine["role"], text: string): ChatLine => ({ role, parts: [{ type: "text", text }] });
const call = (summary: string): ChatLine => ({ role: "assistant", parts: [{ type: "toolCall", toolName: "read", summary }] });
const toolImage = (data: string, toolName = "read"): ChatLine => ({
  role: "tool",
  parts: [
    { type: "toolResult", toolName, text: `${toolName} image`, isError: false },
    { type: "image", mimeType: "image/png", data },
  ],
});

function compactingStatus(): SessionStatus {
  return {
    sessionId: "session-1",
    isStreaming: true,
    isCompacting: true,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  };
}

async function loadedTranscript(messages: ChatLine[], live = false): Promise<ChatView> {
  const view = new ChatView();
  view.sessionId = "session-1";
  view.messages = messages;
  if (live) {
    view.activity = {
      sessionId: "session-1",
      phase: "active",
      label: "receiving response",
      at: "2026-08-20T10:00:00.000Z",
    };
  }
  document.body.append(view);
  await view.updateComplete;
  await view.updateComplete;
  return view;
}

function shadow(view: ChatView): ShadowRoot {
  if (view.shadowRoot === null) throw new Error("The transcript did not render");
  return view.shadowRoot;
}

/** Assistant prose split by where it stands: on the rail or promoted outside it. */
function assistantProse(view: ChatView) {
  const articles = [...shadow(view).querySelectorAll<HTMLElement>(".msg.assistant")];
  return {
    onRail: articles.filter((article) => article.closest(".turn-rail") !== null),
    promoted: articles.filter((article) => article.closest(".turn-rail") === null),
  };
}

/** The prose body of a message article; the visible text lives in formatted-text's own shadow root. */
function proseText(article: HTMLElement): string {
  const formatted = article.querySelector("formatted-text");
  if (formatted === null) throw new Error("The message rendered no prose body");
  const text: unknown = Reflect.get(formatted, "text");
  return typeof text === "string" ? text : "";
}

describe("ChatView process rail", () => {
  const turn = [
    said("user", "question"),
    call("a"),
    said("assistant", "partway there"),
    call("b"),
    said("assistant", "the answer"),
  ];

  it("rails the work of a closed turn and promotes its answer", async () => {
    const view = await loadedTranscript(turn);

    const rail = shadow(view).querySelector(".turn-rail");
    expect(rail).not.toBeNull();
    expect(rail?.querySelectorAll("details.event-group")).toHaveLength(2);

    const prose = assistantProse(view);
    expect(prose.onRail.map(proseText)).toEqual(["partway there"]);
    expect(prose.onRail[0]?.classList.contains("interim")).toBe(true);
    expect(prose.promoted.map(proseText)).toEqual(["the answer"]);
    expect(prose.promoted[0]?.classList.contains("interim")).toBe(false);
  });

  it("keeps only actively streaming trailing prose on the rail", async () => {
    const view = await loadedTranscript(turn, true);

    const prose = assistantProse(view);
    expect(prose.promoted.map(proseText)).toEqual(["partway there"]);
    expect(prose.promoted[0]?.classList.contains("interim")).toBe(false);
    expect(prose.onRail.map(proseText)).toEqual(["the answer"]);
    expect(prose.onRail[0]?.classList.contains("interim")).toBe(true);
  });

  it("keeps the opener bubble off the rail", async () => {
    const view = await loadedTranscript(turn);

    const user = shadow(view).querySelector(".msg.user");
    expect(user).not.toBeNull();
    expect(user?.closest(".turn-rail")).toBeNull();
  });

  it("collects tool images into one gallery directly under the promoted answer", async () => {
    const view = await loadedTranscript([
      said("user", "question"),
      toolImage("FIRST"),
      said("assistant", "the answer"),
      toolImage("SECOND", "capture"),
    ]);

    const root = shadow(view);
    const gallery = root.querySelector<HTMLElement>(".turn-image-gallery");
    const answer = assistantProse(view).promoted[0];
    if (gallery === null || answer === undefined) throw new Error("expected a promoted answer and image gallery");

    expect(gallery.closest(".turn-rail")).toBeNull();
    expect(root.querySelectorAll(".turn-image-gallery-thumb")).toHaveLength(2);
    expect(root.querySelectorAll(".tool-image-output")).toHaveLength(0);
    expect(answer.compareDocumentPosition(gallery) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(gallery.getAttribute("aria-label")).toBe("2 images from this turn");
  });

  it("keeps the gallery under the settled answer while later prose streams", async () => {
    const view = await loadedTranscript([
      said("user", "question"),
      toolImage("FIRST"),
      said("assistant", "settled answer"),
      call("later work"),
      said("assistant", "new prose streaming"),
    ], true);

    const root = shadow(view);
    const gallery = root.querySelector<HTMLElement>(".turn-image-gallery");
    const prose = assistantProse(view);
    const answer = prose.promoted[0];
    const streaming = prose.onRail[0];
    if (gallery === null || answer === undefined || streaming === undefined) throw new Error("expected answer, gallery, and streaming continuation");

    expect(proseText(answer)).toBe("settled answer");
    expect(proseText(streaming)).toBe("new prose streaming");
    expect(answer.compareDocumentPosition(gallery) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(gallery.compareDocumentPosition(streaming) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it("keeps a user attachment inline instead of moving it into the gallery", async () => {
    const view = await loadedTranscript([
      { role: "user", parts: [{ type: "image", mimeType: "image/png", data: "USER" }] },
      said("assistant", "the answer"),
    ]);

    expect(shadow(view).querySelector(".msg.user .chat-image")).not.toBeNull();
    expect(shadow(view).querySelector(".turn-image-gallery")).toBeNull();
  });

  it("closes the rail with the turn's meta instead of stamping the fold", async () => {
    const closing: ChatLine = {
      role: "assistant",
      parts: [{ type: "text", text: "the answer" }],
      meta: { timestamp: "2026-08-20T10:00:00.000Z", model: { provider: "anthropic", id: "claude-opus-4" } },
    };
    const view = await loadedTranscript([said("user", "question"), call("a"), closing]);

    const railMeta = shadow(view).querySelector(".turn-rail .rail-meta .msg-meta");
    expect(railMeta?.textContent ?? "").not.toBe("");
    expect(shadow(view).querySelector("details.event-group summary .msg-meta")).toBeNull();
  });

  it("renders no rail for a turn without work", async () => {
    const view = await loadedTranscript([said("user", "question"), said("assistant", "the answer")]);

    expect(shadow(view).querySelector(".turn-rail")).toBeNull();
    expect(assistantProse(view).promoted).toHaveLength(1);
  });

  it("keeps the latest assistant prose promoted while later tool work runs", async () => {
    const answer: ChatLine = {
      role: "assistant",
      parts: [{ type: "text", text: "the answer" }],
      meta: { timestamp: "2026-08-20T10:00:00.000Z" },
    };
    const view = await loadedTranscript([said("user", "question"), answer, call("a")], true);
    view.activity = {
      sessionId: "session-1",
      phase: "active",
      label: "running tool",
      detail: "read",
      at: "2026-08-20T10:00:01.000Z",
    };
    await view.updateComplete;

    const prose = assistantProse(view);
    expect(prose.onRail).toEqual([]);
    expect(prose.promoted.map(proseText)).toEqual(["the answer"]);
    expect(prose.promoted[0]?.classList.contains("interim")).toBe(false);
    expect(shadow(view).querySelector(".turn-rail .rail-meta")).toBeNull();
  });

  it("keeps the latest assistant prose promoted when a question opens", async () => {
    const view = await loadedTranscript([said("user", "question"), said("assistant", "the answer")], true);
    view.pendingAsk = {
      askId: "ask-open",
      askedAt: "2026-08-20T10:00:00.000Z",
      questions: [{ id: "next", question: "What next?", options: [] }],
    };
    await view.updateComplete;

    expect(shadow(view).querySelector("ask-user-card.open-ask-card")).not.toBeNull();
    expect(assistantProse(view).promoted.map(proseText)).toEqual(["the answer"]);
  });

  it("keeps the latest assistant prose promoted while history compacts", async () => {
    const view = await loadedTranscript([said("user", "question"), said("assistant", "the answer")]);
    view.status = compactingStatus();
    view.isCompacting = true;
    await view.updateComplete;

    const prose = assistantProse(view);
    expect(prose.onRail).toEqual([]);
    expect(prose.promoted.map(proseText)).toEqual(["the answer"]);
  });
});
