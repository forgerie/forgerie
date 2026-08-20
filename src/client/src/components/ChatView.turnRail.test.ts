// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { ChatView } from "./ChatView";
import type { ChatLine } from "./shared";

afterEach(() => {
  document.body.replaceChildren();
});

const said = (role: ChatLine["role"], text: string): ChatLine => ({ role, parts: [{ type: "text", text }] });
const call = (summary: string): ChatLine => ({ role: "assistant", parts: [{ type: "toolCall", toolName: "read", summary }] });

async function loadedTranscript(messages: ChatLine[], live = false): Promise<ChatView> {
  const view = new ChatView();
  view.sessionId = "session-1";
  view.messages = messages;
  view.isSendingPrompt = live;
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

  it("keeps every text block on the rail while the turn is running", async () => {
    const view = await loadedTranscript(turn, true);

    const prose = assistantProse(view);
    expect(prose.promoted).toEqual([]);
    expect(prose.onRail.map(proseText)).toEqual(["partway there", "the answer"]);
    expect(prose.onRail.every((article) => article.classList.contains("interim"))).toBe(true);
  });

  it("keeps the opener bubble off the rail", async () => {
    const view = await loadedTranscript(turn);

    const user = shadow(view).querySelector(".msg.user");
    expect(user).not.toBeNull();
    expect(user?.closest(".turn-rail")).toBeNull();
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

  it("holds the answer back when a closed turn ends in tool work", async () => {
    const view = await loadedTranscript([said("user", "question"), said("assistant", "working"), call("a")]);

    const prose = assistantProse(view);
    expect(prose.promoted).toEqual([]);
    expect(prose.onRail.map(proseText)).toEqual(["working"]);
  });
});
