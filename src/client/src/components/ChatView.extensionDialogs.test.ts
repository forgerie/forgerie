// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { PendingExtensionDialog } from "../api";
import type { ClosedExtensionDialog } from "../appState";
import { ChatView } from "./ChatView";
import { ExtensionDialogCard } from "./ExtensionDialogCard";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("ChatView open extension dialogs", () => {
  it("renders the oldest pending dialog at the transcript foot", async () => {
    const view = await mountView();
    const oldest = openDialog("dlg-1", "Allow file writes?");
    view.pendingDialogs = [oldest, openDialog("dlg-2", "Pick a region", { kind: "select", options: ["eu", "us"] })];
    await view.updateComplete;

    const card = requiredElement(view.shadowRoot?.querySelector<ExtensionDialogCard>(".chat-content > extension-dialog-card.open-dialog-card"), "open dialog card");
    expect(card).toBeInstanceOf(ExtensionDialogCard);
    expect(card.dialog).toBe(oldest);
    expect(view.shadowRoot?.querySelector(".queued-dialogs")?.textContent).toContain("1 more extension dialog queued");
  });

  it("renders no queued affordance for a single pending dialog", async () => {
    const view = await mountView();
    view.pendingDialogs = [openDialog("dlg-1", "Allow file writes?")];
    await view.updateComplete;

    expect(view.shadowRoot?.querySelector(".chat-content > extension-dialog-card.open-dialog-card")).not.toBeNull();
    expect(view.shadowRoot?.querySelector(".queued-dialogs")).toBeNull();
  });

  it("forwards the answer and cancel callbacks to the open dialog card", async () => {
    const view = await mountView();
    const onAnswerDialog = vi.fn();
    const onCancelDialog = vi.fn();
    view.onAnswerDialog = onAnswerDialog;
    view.onCancelDialog = onCancelDialog;
    view.pendingDialogs = [openDialog("dlg-1", "Allow file writes?")];
    await view.updateComplete;

    const card = requiredElement(view.shadowRoot?.querySelector<ExtensionDialogCard>("extension-dialog-card.open-dialog-card"), "open dialog card");
    void card.onAnswer?.("dlg-1", true);
    void card.onCancel?.("dlg-1");

    expect(onAnswerDialog).toHaveBeenCalledWith("dlg-1", true);
    expect(onCancelDialog).toHaveBeenCalledWith("dlg-1");
  });
});

describe("ChatView closed extension dialogs", () => {
  it("groups accumulated outcomes in one collapsed disclosure without hiding the pending question", async () => {
    const view = await mountView();
    view.closedDialogs = [
      closedDialog("dlg-0", "Allow reads?", "answered", true),
      closedDialog("dlg-1", "Still playing?", "answered", "Just started a new song"),
      closedDialog("dlg-2", "Pick a region", "cancelled"),
      closedDialog("dlg-3", "Continue?", "timeout"),
    ];
    view.pendingDialogs = [openDialog("dlg-4", "Allow file writes?")];
    await view.updateComplete;

    const history = completedQuestions(view);
    expect(history.open).toBe(false);
    expect(history.querySelector("summary")?.textContent).toContain("Completed questions (4)");
    expect(history.querySelectorAll("extension-dialog-card")).toHaveLength(4);
    expect(view.shadowRoot?.querySelectorAll("details.completed-dialogs")).toHaveLength(1);
    expect(view.shadowRoot?.querySelector(".chat-content > .closed-dialog-card")).toBeNull();
    expect(view.shadowRoot?.querySelector(".chat-content > .open-dialog-card")).not.toBeNull();
  });

  it("opens the answers and dismisses individual cards through their real buttons", async () => {
    const view = await mountView();
    const dismissed: string[] = [];
    view.onDismissClosedDialog = (dialogId) => {
      dismissed.push(dialogId);
      view.closedDialogs = view.closedDialogs.filter((closed) => closed.dialog.dialogId !== dialogId);
    };
    view.closedDialogs = [
      closedDialog("dlg-0", "Allow reads?", "answered", true),
      closedDialog("dlg-1", "Still playing?", "answered", "Just started a new song"),
    ];
    await view.updateComplete;

    const history = completedQuestions(view);
    requiredElement(history.querySelector("summary"), "history summary").click();
    expect(history.open).toBe(true);
    const cards = [...history.querySelectorAll<ExtensionDialogCard>("extension-dialog-card")];
    for (const card of cards) await card.updateComplete;
    expect(cards[0]?.shadowRoot?.querySelector(".closed-summary")?.textContent).toBe("Answered: Yes");
    expect(cards[1]?.shadowRoot?.querySelector(".closed-summary")?.textContent).toBe("Answered: Just started a new song");

    requiredElement(cards[0]?.shadowRoot?.querySelector("button"), "first Dismiss button").click();
    await view.updateComplete;
    expect(dismissed).toEqual(["dlg-0"]);
    expect(history.querySelector("summary")?.textContent).toContain("Completed questions (1)");
    expect(history.open).toBe(true);

    requiredElement(cards[1]?.shadowRoot?.querySelector("button"), "last Dismiss button").click();
    await view.updateComplete;
    expect(view.shadowRoot?.querySelector("details.completed-dialogs")).toBeNull();
  });

  it("keeps the reader's expansion choice as messages and completed questions arrive", async () => {
    const view = await mountView();
    view.closedDialogs = [closedDialog("dlg-0", "Allow reads?", "answered", true)];
    await view.updateComplete;
    requiredElement(completedQuestions(view).querySelector("summary"), "history summary").click();
    // happy-dom toggles `open` on click but does not emit the native toggle event.
    completedQuestions(view).dispatchEvent(new Event("toggle"));
    await view.updateComplete;

    view.messages = [{ role: "user", parts: [{ type: "text", text: "Next question" }] }];
    view.closedDialogs = [...view.closedDialogs, closedDialog("dlg-1", "Still playing?", "answered", "Yes")];
    await view.updateComplete;
    expect(completedQuestions(view).open).toBe(true);
    expect(completedQuestions(view).querySelector("summary")?.textContent).toContain("Completed questions (2)");

    requiredElement(completedQuestions(view).querySelector("summary"), "history summary").click();
    completedQuestions(view).dispatchEvent(new Event("toggle"));
    await view.updateComplete;
    view.closedDialogs = [...view.closedDialogs, closedDialog("dlg-2", "Continue?", "answered", false)];
    await view.updateComplete;
    expect(completedQuestions(view).open).toBe(false);
  });

  it("starts collapsed for another session and after the history is emptied", async () => {
    const view = await mountView();
    view.closedDialogs = [closedDialog("dlg-0", "Allow reads?", "answered", true)];
    await view.updateComplete;
    requiredElement(completedQuestions(view).querySelector("summary"), "history summary").click();
    completedQuestions(view).dispatchEvent(new Event("toggle"));
    await view.updateComplete;

    view.sessionId = "session-2";
    view.closedDialogs = [closedDialog("dlg-1", "Still playing?", "answered", true)];
    await view.updateComplete;
    expect(completedQuestions(view).open).toBe(false);

    requiredElement(completedQuestions(view).querySelector("summary"), "history summary").click();
    completedQuestions(view).dispatchEvent(new Event("toggle"));
    await view.updateComplete;
    view.closedDialogs = [];
    await view.updateComplete;
    expect(view.shadowRoot?.querySelector("details.completed-dialogs")).toBeNull();
    view.closedDialogs = [closedDialog("dlg-2", "Continue?", "answered", true)];
    await view.updateComplete;
    expect(completedQuestions(view).open).toBe(false);
  });

  it("renders no completed-question group for an empty history", async () => {
    const view = await mountView();
    expect(view.shadowRoot?.querySelector("details.completed-dialogs")).toBeNull();
  });
});

function completedQuestions(view: ChatView): HTMLDetailsElement {
  return requiredElement(view.shadowRoot?.querySelector<HTMLDetailsElement>("details.completed-dialogs"), "completed questions disclosure");
}

async function mountView(): Promise<ChatView> {
  const view = new ChatView();
  view.sessionId = "session-1";
  document.body.append(view);
  await view.updateComplete;
  return view;
}

function requiredElement<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${label}`);
  return value;
}

function openDialog(dialogId: string, title: string, overrides: Partial<PendingExtensionDialog> = {}): PendingExtensionDialog {
  return {
    dialogId,
    kind: "confirm",
    title,
    askedAt: "2026-07-27T10:00:00.000Z",
    runScoped: false,
    ...overrides,
  };
}

function closedDialog(
  dialogId: string,
  title: string,
  reason: ClosedExtensionDialog["reason"],
  answer?: ClosedExtensionDialog["answer"],
): ClosedExtensionDialog {
  return {
    dialog: openDialog(dialogId, title),
    reason,
    ...(answer === undefined ? {} : { answer }),
  };
}
