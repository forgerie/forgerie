// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { ChatView } from "./ChatView";
import type { ChatLine } from "./shared";

afterEach(() => {
  document.body.replaceChildren();
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
  return Reflect.get(view, "followMode");
}

/** Pull the transcript back the way a reader does, from somewhere above its foot. */
async function readerScrollsUp(view: ChatView): Promise<void> {
  const chat = scroller(view);
  chat.scrollTop = 400;
  chat.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, bubbles: true }));
  await view.updateComplete;
}

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
    chat.scrollTop = 0;
    chat.dispatchEvent(new Event("scroll"));
    await view.updateComplete;

    expect(followMode(view)).toEqual({ kind: "tail" });
    expect(reservedTurnKeys(view)).toEqual(["turn:m:1"]);
  });
});
