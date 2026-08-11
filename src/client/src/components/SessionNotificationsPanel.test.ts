// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SelectedSessionNotificationView } from "../sessionNotifications";
import { SessionNotificationsPanel } from "./SessionNotificationsPanel";

afterEach(() => {
  document.body.replaceChildren();
});

describe("SessionNotificationsPanel", () => {
  it("renders the selected session inbox newest first", async () => {
    const panel = await renderPanel(notificationInbox());

    const rows = [...panel.shadowRoot?.querySelectorAll<HTMLElement>(".notification-row") ?? []];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("newest notice");
    expect(rows[1]?.textContent).toContain("older notice");
    expect(panel.shadowRoot?.textContent).toContain("2 older notifications not shown");
  });

  it("dismisses one notification and moves focus to the next row", async () => {
    const onDismissNotification = vi.fn();
    const panel = await renderPanel(notificationInbox(), { onDismissNotification });

    dismissButton(panel, "daemon-a:2").click();
    panel.inbox = { ...notificationInbox(), notifications: [notification(1, "older notice")], retainedCount: 1 };
    await panel.updateComplete;

    expect(onDismissNotification).toHaveBeenCalledExactlyOnceWith("daemon-a:2");
    expect(panel.shadowRoot?.activeElement).toBe(notificationRow(panel, "daemon-a:1"));
  });

  it("clears all notifications and keeps focus in the panel", async () => {
    const onDismissAllNotifications = vi.fn();
    const panel = await renderPanel(notificationInbox(), { onDismissAllNotifications });

    clearButton(panel).click();
    panel.inbox = emptyInbox();
    await panel.updateComplete;

    expect(onDismissAllNotifications).toHaveBeenCalledOnce();
    expect(panel.shadowRoot?.textContent).toContain("No notifications for this session");
    expect(panel.shadowRoot?.activeElement).toBe(panel.shadowRoot?.querySelector(".notification-header"));
  });
});

async function renderPanel(
  inbox: SelectedSessionNotificationView,
  callbacks: {
    onDismissNotification?: (notificationId: string) => void;
    onDismissAllNotifications?: () => void;
  } = {},
): Promise<SessionNotificationsPanel> {
  const panel = new SessionNotificationsPanel();
  panel.inbox = inbox;
  panel.onDismissNotification = callbacks.onDismissNotification;
  panel.onDismissAllNotifications = callbacks.onDismissAllNotifications;
  document.body.append(panel);
  await panel.updateComplete;
  return panel;
}

function notificationInbox(): SelectedSessionNotificationView {
  return {
    machineId: "local",
    sessionId: "session-1",
    cwd: "/repo",
    daemonInstanceId: "daemon-a",
    notifications: [notification(2, "newest notice"), notification(1, "older notice")],
    retainedCount: 2,
    discardedCount: 2,
    highestSeverity: "warning",
    dismissThrough: { order: 0, overflowWatermark: 0 },
    pendingDismissedIds: new Set(),
    dismissAllPending: false,
    announcements: [],
  };
}

function emptyInbox(): SelectedSessionNotificationView {
  const inbox = notificationInbox();
  delete inbox.highestSeverity;
  return {
    ...inbox,
    notifications: [],
    retainedCount: 0,
    discardedCount: 0,
  };
}

function notification(order: number, message: string): SelectedSessionNotificationView["notifications"][number] {
  return {
    id: `daemon-a:${String(order)}`,
    message,
    truncated: false,
    severity: "warning",
    receivedAt: `2026-08-10T10:0${String(order)}:00.000Z`,
    order,
  };
}

function dismissButton(panel: SessionNotificationsPanel, notificationId: string): HTMLButtonElement {
  const row = notificationRow(panel, notificationId);
  const button = row.querySelector<HTMLButtonElement>(".notification-row-dismiss");
  if (button === null) throw new Error(`Missing dismiss button for ${notificationId}`);
  return button;
}

function notificationRow(panel: SessionNotificationsPanel, notificationId: string): HTMLElement {
  const row = [...panel.shadowRoot?.querySelectorAll<HTMLElement>("[data-notification-id]") ?? []]
    .find((candidate) => candidate.dataset["notificationId"] === notificationId);
  if (row === undefined) throw new Error(`Missing notification row ${notificationId}`);
  return row;
}

function clearButton(panel: SessionNotificationsPanel): HTMLButtonElement {
  const button = panel.shadowRoot?.querySelector<HTMLButtonElement>(".notification-clear");
  if (button === null || button === undefined) throw new Error("Missing clear button");
  return button;
}
