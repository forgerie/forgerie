// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { AskUserOutcome } from "../../../shared/apiTypes";
import type { PendingExtensionDialog } from "../api";
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
  });

  it("renders the open extension dialog inside the turn that raised it", async () => {
    const view = await loadedTranscript([said("user", "question")]);
    view.pendingDialogs = [openDialog];
    await view.updateComplete;

    const card = view.shadowRoot?.querySelector("extension-dialog-card.open-dialog-card");
    expect(card?.closest(".turn")?.getAttribute("data-turn-key")).toBe("turn:m:0");
  });

  it("keeps the tail reachable in a session with no turns yet", async () => {
    const view = await loadedTranscript([]);
    view.pendingAsk = askedQuestion;
    await view.updateComplete;

    expect(view.shadowRoot?.querySelector(".chat > ask-user-card.open-ask-card")).not.toBeNull();
  });

  it("does not mistake a past question in the transcript for the open one", async () => {
    const view = await loadedTranscript([{ role: "assistant", parts: [{ type: "askUserRecord", outcome: answeredQuestion }] }]);

    expect(view.shadowRoot?.querySelector("ask-user-card")).not.toBeNull();
    expect(view.shadowRoot?.querySelector("ask-user-card.open-ask-card")).toBeNull();
  });
});
