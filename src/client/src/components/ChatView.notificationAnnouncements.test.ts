// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import type { SelectedSessionNotificationView } from "../sessionNotifications";
import { ChatView } from "./ChatView";

afterEach(() => {
  document.body.replaceChildren();
});

describe("ChatView session notification announcements", () => {
  it("announces arrivals without rendering the visible notification inbox", async () => {
    const view = new ChatView();
    view.sessionId = "session-1";
    view.notificationInbox = notificationInbox();
    document.body.append(view);
    await view.updateComplete;

    expect(view.shadowRoot?.querySelector(".notification-tray")).toBeNull();
    expect(view.shadowRoot?.querySelector("[aria-live='polite']")?.textContent).toContain("Warning notification received");
    expect(view.shadowRoot?.querySelector("[aria-live='assertive']")?.textContent).toContain("Error notification received");
  });
});

function notificationInbox(): SelectedSessionNotificationView {
  return {
    machineId: "local",
    sessionId: "session-1",
    cwd: "/repo",
    daemonInstanceId: "daemon-a",
    notifications: [
      { id: "daemon-a:2", message: "error", truncated: false, severity: "error", receivedAt: "2026-08-10T10:02:00.000Z", order: 2 },
      { id: "daemon-a:1", message: "warning", truncated: false, severity: "warning", receivedAt: "2026-08-10T10:01:00.000Z", order: 1 },
    ],
    retainedCount: 2,
    discardedCount: 0,
    highestSeverity: "error",
    dismissThrough: { order: 0, overflowWatermark: 0 },
    pendingDismissedIds: new Set(),
    dismissAllPending: false,
    announcements: [
      { id: "daemon-a:1", severity: "warning", message: "warning" },
      { id: "daemon-a:2", severity: "error", message: "error" },
    ],
  };
}
