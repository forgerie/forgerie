// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
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
});
