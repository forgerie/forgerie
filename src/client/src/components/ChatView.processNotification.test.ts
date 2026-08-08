// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { ChatView } from "./ChatView";
import type { ChatPart } from "./shared";

afterEach(() => {
  document.body.replaceChildren();
});

describe("ChatView process notification records", () => {
  it("renders a failed process as a compact card with raw content collapsed", async () => {
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

    const affordance = requiredElement(view.shadowRoot?.querySelector(".status-affordance"), "stopped status affordance");
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

    const disclosure = requiredElement(view.shadowRoot?.querySelector("details"), "raw-content disclosure");
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

async function renderNotification(part: Extract<ChatPart, { type: "processNotification" }>): Promise<ChatView> {
  const view = new ChatView();
  view.sessionId = "test-session";
  view.messages = [{ role: "system", parts: [part] }];
  document.body.append(view);
  await view.updateComplete;
  return view;
}

function requiredElement<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${label}`);
  return value;
}
