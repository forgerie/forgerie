import { describe, expect, it, vi } from "vitest";
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
