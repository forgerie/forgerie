// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { AppPanelOpener } from "./AppPanelOpener";

afterEach(() => {
  document.body.replaceChildren();
});

describe("AppPanelOpener attention", () => {
  it.each([
    ["blocked", "Blocked on you"],
    ["unread", "Unread sessions"],
  ] as const)("shows a %s circle and announces it", async (attention, announcement) => {
    const opener = new AppPanelOpener();
    opener.side = "navigation";
    opener.label = "Show sessions";
    opener.attention = attention;
    document.body.append(opener);
    await opener.updateComplete;

    const marker = opener.shadowRoot?.querySelector("[data-attention]");
    const button = opener.shadowRoot?.querySelector("button");

    expect(marker?.getAttribute("data-attention")).toBe(attention);
    expect(button?.getAttribute("aria-label")).toBe(`Show sessions, ${announcement}`);
  });

  it("stays unmarked without attention", async () => {
    const opener = new AppPanelOpener();
    opener.side = "navigation";
    opener.label = "Show sessions";
    document.body.append(opener);
    await opener.updateComplete;

    expect(opener.shadowRoot?.querySelector("[data-attention]")).toBeNull();
    expect(opener.shadowRoot?.querySelector("button")?.getAttribute("aria-label")).toBe("Show sessions");
  });

  it("reports panel state and invokes the press callback", async () => {
    const onPress = vi.fn();
    const opener = new AppPanelOpener();
    opener.side = "workspace";
    opener.label = "Show workspace";
    opener.controls = "workspace-panel";
    opener.open = true;
    opener.onPress = onPress;
    document.body.append(opener);
    await opener.updateComplete;

    const button = opener.shadowRoot?.querySelector<HTMLButtonElement>("button");
    expect(button?.getAttribute("aria-controls")).toBe("workspace-panel");
    expect(button?.getAttribute("aria-expanded")).toBe("true");
    expect(opener.shadowRoot?.querySelector("rect")).not.toBeNull();

    button?.click();
    expect(onPress).toHaveBeenCalledOnce();
  });
});
