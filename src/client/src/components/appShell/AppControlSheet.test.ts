import { describe, expect, it, vi } from "vitest";
import type { SessionStatus } from "../../api";
import { templateClickHandlerForText, templateText } from "../../templateInspection.testSupport";
import { AppControlSheet } from "./AppControlSheet";
import type { AppMobileMainTab } from "./AppMobileMainTabs";

describe("AppControlSheet", () => {
  it("stays out of the way until it is asked for", () => {
    const sheet = new AppControlSheet();
    sheet.open = false;

    expect(sheet.render()).toBeNull();
  });

  it("hands back every destination the retired bands used to offer", () => {
    const sheet = openSheet();

    const rendered = templateText(requireTemplate(sheet.render()));
    expect(rendered).toContain("app-context-bar");
    expect(rendered).toContain("app-mobile-main-tabs");
  });

  it("reports what is waiting without spending a band on it", () => {
    const sheet = openSheet();
    sheet.notificationCount = 2;

    expect(templateText(requireTemplate(sheet.render()))).toContain("2 notifications");
  });

  it("says nothing about notifications when none are waiting", () => {
    const sheet = openSheet();
    sheet.notificationCount = 0;

    expect(templateText(requireTemplate(sheet.render()))).not.toContain("notifications");
  });

  it("carries the readings the status bar used to spend a row on", () => {
    const sheet = openSheet();
    sheet.status = status();

    const rendered = templateText(requireTemplate(sheet.render()));
    expect(rendered).toContain("12k");
    expect(rendered).toContain("1.2k");
    expect(rendered).toContain("$1.40");
  });

  it("reports queued messages only while some are waiting", () => {
    const sheet = openSheet();
    sheet.status = { ...status(), pendingMessageCount: 3 };
    expect(templateText(requireTemplate(sheet.render()))).toContain("3 queued");

    sheet.status = status();
    expect(templateText(requireTemplate(sheet.render()))).not.toContain("queued");
  });

  it("says the session has not reported yet rather than showing empty readings", () => {
    const sheet = openSheet();

    const rendered = templateText(requireTemplate(sheet.render()));
    expect(rendered).toContain("No session status yet");
    expect(rendered).not.toContain("$0");
  });

  it("opens the warning area from the sheet, the way the bar used to", () => {
    const sheet = openSheet();
    const onToggleWarnings = vi.fn();
    sheet.status = status();
    sheet.warningCount = 2;
    sheet.onToggleWarnings = onToggleWarnings;

    templateClickHandlerForText(requireTemplate(sheet.render()), "2 warnings")(new Event("click"));

    expect(onToggleWarnings).toHaveBeenCalledOnce();
  });

  it("offers no warning control on a session with nothing to warn about", () => {
    const sheet = openSheet();
    sheet.status = status();
    sheet.warningCount = 0;

    expect(templateText(requireTemplate(sheet.render()))).not.toContain("warning");
  });

  it("starts an attachment and leaves, so the file picker is not behind a sheet", () => {
    const sheet = openSheet();
    const onAttachFiles = vi.fn();
    const onClose = vi.fn();
    sheet.onAttachFiles = onAttachFiles;
    sheet.onClose = onClose;

    templateClickHandlerForText(requireTemplate(sheet.render()), "Attach files")(new Event("click"));

    expect(onAttachFiles).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes from the scrim, leaving the conversation as it was", () => {
    const sheet = openSheet();
    const onClose = vi.fn();
    sheet.onClose = onClose;

    templateClickHandlerForText(requireTemplate(sheet.render()), "Close session controls")(new Event("click"));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes after a destination is chosen so the sheet never lingers", () => {
    const sheet = openSheet();
    const onSelectView = vi.fn();
    const onClose = vi.fn();
    sheet.onSelectView = onSelectView;
    sheet.onClose = onClose;

    sheet.selectView("core:files");

    expect(onSelectView).toHaveBeenCalledExactlyOnceWith("core:files");
    expect(onClose).toHaveBeenCalledOnce();
  });
});

function openSheet(): AppControlSheet {
  const sheet = new AppControlSheet();
  sheet.open = true;
  sheet.tabs = tabs();
  return sheet;
}

function status(): SessionStatus {
  return {
    sessionId: "session-1",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 12_345, output: 1234, cacheRead: 0, cacheWrite: 0, total: 13_579 },
    cost: 1.4,
  };
}

function tabs(): AppMobileMainTab[] {
  return [
    { id: "chat", label: "Chat" },
    { id: "core:files", label: "Files" },
  ];
}

function requireTemplate<T>(value: T | null): T {
  if (value === null) throw new Error("expected the sheet to render");
  return value;
}
