// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { ChatView } from "./ChatView";
import type { ChatPart } from "./shared";

afterEach(() => {
  document.body.replaceChildren();
});

describe("ChatView process notification records", () => {
  // A notification is one of the turn's steps, so it lives in the fold that
  // closes the turn rather than standing in the transcript behind its own role
  // label and border.
  it("stays inside the turn's fold until the reader opens it", async () => {
    const view = await renderNotification({
      type: "processNotification",
      kind: "failure",
      processName: "worker",
      summary: "Process failed",
      rawContent: "raw",
    }, { openFold: false });

    expect(view.shadowRoot?.querySelector(".process-notification")).toBeNull();
    const fold = requiredElement(view.shadowRoot?.querySelector("details.event-group"), "turn fold");
    expect(fold.textContent).toContain("1 step");
  });

  // The event names its own process, so the role label above it said only
  // "SYSTEM" -- a word that identifies nothing the reader could not already see.
  it("drops the role label from an event that names itself", async () => {
    const view = await renderNotification({
      type: "processNotification",
      kind: "log_match",
      processName: "dev-server",
      summary: "Server listening on port 3000",
      rawContent: "raw",
    });

    const section = requiredElement(view.shadowRoot?.querySelector(".group-msg"), "grouped event");
    expect(section.querySelector(".msg-header")).toBeNull();
    expect(section.textContent).toContain("dev-server");
  });

  it("renders a failed process without card chrome and with raw content collapsed", async () => {
    const view = await renderNotification({
      type: "processNotification",
      kind: "crash",
      processName: "web-server",
      summary: "Process crashed with exit code 1",
      status: "exited",
      exitCode: 1,
      rawContent: "<process_notification>verbose XML</process_notification>",
    });

    const card = requiredElement(view.shadowRoot?.querySelector(".process-notification"), "process notification card");
    expect(card.classList.contains("error")).toBe(true);
    expect(card.textContent).toContain("web-server");
    expect(card.textContent).toContain("Process crashed with exit code 1");
    expect(card.textContent).toContain("exit 1");

    const affordance = requiredElement(card.querySelector(".status-affordance"), "status affordance");
    expect(affordance.textContent).toBe("✖");
    expect(affordance.getAttribute("aria-label")).toBe("Process failed");

    const disclosure = requiredElement(card.querySelector("details"), "raw-content disclosure");
    expect(disclosure).toBeInstanceOf(HTMLDetailsElement);
    expect(disclosure.hasAttribute("open")).toBe(false);
    expect(disclosure.textContent).toContain("verbose XML");
  });

  it("renders success without failure styling or a null exit code", async () => {
    const view = await renderNotification({
      type: "processNotification",
      kind: "success",
      processName: "build-task",
      summary: "Build completed successfully",
      status: "exited",
      rawContent: "raw",
    });

    const card = requiredElement(view.shadowRoot?.querySelector(".process-notification"), "success notification card");
    expect(card.classList.contains("success")).toBe(true);
    expect(card.classList.contains("error")).toBe(false);
    expect(card.querySelector(".exit-code")).toBeNull();
    expect(card.querySelector(".status-affordance")?.textContent).toBe("✓");
  });

  it("renders log matches as informational updates", async () => {
    const view = await renderNotification({
      type: "processNotification",
      kind: "log_match",
      processName: "dev-server",
      summary: "Server listening on port 3000",
      rawContent: "raw",
    });

    const card = requiredElement(view.shadowRoot?.querySelector(".process-notification"), "log-match notification card");
    expect(card.textContent).toContain("Server listening on port 3000");
    expect(card.querySelector(".exit-code")).toBeNull();
    expect(card.querySelector(".status-affordance")?.textContent).toBe("ℹ");
  });

  it("renders killed processes with a stop affordance", async () => {
    const view = await renderNotification({
      type: "processNotification",
      kind: "killed",
      processName: "long-task",
      summary: "Process was stopped",
      rawContent: "raw",
    });

    const affordance = requiredElement(view.shadowRoot?.querySelector(".process-notification .status-affordance"), "stopped status affordance");
    expect(affordance.textContent).toBe("⏹");
    expect(affordance.getAttribute("aria-label")).toBe("Process stopped");
  });

  it("uses a disclosure to reveal the preserved model-facing content", async () => {
    const view = await renderNotification({
      type: "processNotification",
      kind: "failure",
      processName: "task",
      summary: "Task failed",
      rawContent: "Raw content here",
    });

    const disclosure = requiredElement(view.shadowRoot?.querySelector(".process-notification details"), "raw-content disclosure");
    expect(disclosure.hasAttribute("open")).toBe(false);
    disclosure.setAttribute("open", "");
    expect(disclosure.hasAttribute("open")).toBe(true);
    expect(disclosure.textContent).toContain("Raw content here");
  });

  it("allows long notification headers to wrap", async () => {
    const view = await renderNotification({
      type: "processNotification",
      kind: "crash",
      processName: "very-long-process-name-that-might-wrap",
      summary: "A long summary that should remain readable when the transcript narrows",
      exitCode: 1,
      rawContent: "raw",
    });

    const header = requiredElement(view.shadowRoot?.querySelector(".process-notification-header"), "notification header");
    expect(getComputedStyle(header).flexWrap).toBe("wrap");
  });
});

async function renderNotification(
  part: Extract<ChatPart, { type: "processNotification" }>,
  options: { openFold?: boolean } = {},
): Promise<ChatView> {
  const view = new ChatView();
  view.sessionId = "test-session";
  view.messages = [{ role: "system", parts: [part] }];
  document.body.append(view);
  await view.updateComplete;
  if (options.openFold !== false) await openTurnFold(view);
  return view;
}

/**
 * Open the turn's fold, the way a reader would.
 *
 * The fold renders its body only while open, so a notification is absent from
 * the DOM until this runs. Driving the real `toggle` event keeps the component
 * deciding what open means rather than the test asserting it.
 */
async function openTurnFold(view: ChatView): Promise<void> {
  const fold = requiredElement(view.shadowRoot?.querySelector("details.event-group"), "turn fold");
  fold.setAttribute("open", "");
  fold.dispatchEvent(new Event("toggle"));
  await view.updateComplete;
}

function requiredElement<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${label}`);
  return value;
}
