// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { AppMobileMainTabs } from "./AppMobileMainTabs";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("AppMobileMainTabs", () => {
  it("renders selected tabs, badges, accessible labels, and callback selection", async () => {
    const onSelect = vi.fn();
    const tabs = new AppMobileMainTabs();
    tabs.selectedView = "chat";
    tabs.onSelect = onSelect;
    tabs.tabs = [
      { id: "chat", label: "Chat", badge: 3, badgeLabel: "3 unread", badgeTone: "unread" },
      { id: "navigation", label: "Navigation", className: "navigation-tab" },
    ];
    document.body.append(tabs);
    await tabs.updateComplete;

    const buttons = tabs.shadowRoot?.querySelectorAll<HTMLButtonElement>("button");
    expect(buttons).toHaveLength(2);
    expect(buttons?.[0]?.classList.contains("selected")).toBe(true);
    expect(buttons?.[0]?.getAttribute("aria-label")).toBe("Chat, 3 unread");
    expect(tabs.shadowRoot?.querySelector(".tab-badge.unread")?.textContent).toBe("3");

    buttons?.[1]?.click();
    expect(onSelect).toHaveBeenCalledWith("navigation");
  });

  it("uses distinct fallback labels when initials collide", async () => {
    const tabs = new AppMobileMainTabs();
    tabs.tabs = [
      { id: "chat", label: "Code Review" },
      { id: "navigation", label: "Change Requests" },
      { id: "core:workspace.files", label: "" },
    ];
    document.body.append(tabs);
    await tabs.updateComplete;

    expect(Array.from(tabs.shadowRoot?.querySelectorAll(".tab-fallback") ?? [], (node) => node.textContent)).toEqual([
      "Code Review",
      "Change Requests",
      "?",
    ]);
  });

  it("observes strip resizes and disconnects the observer", async () => {
    let resize: (() => void) | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    class TestResizeObserver {
      constructor(callback: () => void) { resize = callback; }
      observe = observe;
      disconnect = disconnect;
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    const tabs = new AppMobileMainTabs();
    tabs.tabs = [{ id: "chat", label: "Chat" }];
    document.body.append(tabs);
    await tabs.updateComplete;

    expect(observe).toHaveBeenCalledOnce();
    resize?.();
    tabs.remove();
    expect(disconnect).toHaveBeenCalled();
  });

  it("tracks horizontal scroll affordances", async () => {
    const tabs = new AppMobileMainTabs();
    tabs.tabs = [{ id: "chat", label: "Chat" }];
    document.body.append(tabs);
    await tabs.updateComplete;
    const strip = tabs.shadowRoot?.querySelector<HTMLElement>(".mobile-tabs");
    if (strip === null || strip === undefined) throw new Error("Expected mobile tabs strip");
    Object.defineProperties(strip, {
      scrollWidth: { configurable: true, value: 300 },
      clientWidth: { configurable: true, value: 100 },
      scrollLeft: { configurable: true, writable: true, value: 50 },
    });

    strip.dispatchEvent(new Event("scroll"));
    await tabs.updateComplete;
    expect(tabs.shadowRoot?.querySelector(".mobile-tabs-frame")?.className).toContain("can-scroll-left");
    expect(tabs.shadowRoot?.querySelector(".mobile-tabs-frame")?.className).toContain("can-scroll-right");

    strip.scrollLeft = 200;
    strip.dispatchEvent(new Event("scroll"));
    await tabs.updateComplete;
    expect(tabs.shadowRoot?.querySelector(".mobile-tabs-frame")?.className).toContain("can-scroll-left");
    expect(tabs.shadowRoot?.querySelector(".mobile-tabs-frame")?.className).not.toContain("can-scroll-right");
  });
});
