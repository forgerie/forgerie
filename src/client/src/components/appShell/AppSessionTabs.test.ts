// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { AppSessionTabs, type AppSessionTab } from "./AppSessionTabs";

afterEach(() => {
  document.body.replaceChildren();
});

const CHAT: AppSessionTab = { id: "chat", label: "Chat", closeable: false };
const TERMINAL: AppSessionTab = { id: "core:workspace.terminal", label: "Terminal", closeable: true };
const GIT: AppSessionTab = { id: "core:workspace.git", label: "Git", closeable: true };

describe("AppSessionTabs", () => {
  it("renders every tab's label and marks the selected one active", async () => {
    const tabs = await mountTabs({ tabs: [CHAT, TERMINAL, GIT], selected: TERMINAL.id });
    const rendered = [...root(tabs).querySelectorAll(".tab")];

    expect(rendered.map((tab) => tab.querySelector(".label")?.textContent)).toEqual(["Chat", "Terminal", "Git"]);
    expect(rendered.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
    expect(rendered[1]?.classList.contains("active")).toBe(true);
  });

  it("shows the close control only on the active closeable tab", async () => {
    const tabs = await mountTabs({ tabs: [CHAT, TERMINAL, GIT], selected: TERMINAL.id });
    const closeButtons = [...root(tabs).querySelectorAll(".tab .close")];

    expect(closeButtons).toHaveLength(1);
    expect(closeButtons[0]?.closest(".tab")?.textContent).toContain("Terminal");
  });

  it("never shows a close control on the permanent chat tab, even active", async () => {
    const tabs = await mountTabs({ tabs: [CHAT, TERMINAL], selected: "chat" });
    expect(root(tabs).querySelector(".tab.active .close")).toBeNull();
  });

  it("selects a tab on click and on Enter", async () => {
    const selected: string[] = [];
    const tabs = await mountTabs({ tabs: [CHAT, TERMINAL], selected: "chat", onSelect: (id) => selected.push(id) });
    const terminalTab = root(tabs).querySelectorAll<HTMLElement>(".tab")[1];

    terminalTab?.click();
    terminalTab?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(selected).toEqual([TERMINAL.id, TERMINAL.id]);
  });

  it("closes without selecting when the close control is clicked", async () => {
    const selected: string[] = [];
    const closed: string[] = [];
    const tabs = await mountTabs({
      tabs: [CHAT, TERMINAL],
      selected: TERMINAL.id,
      onSelect: (id) => selected.push(id),
      onClose: (id) => closed.push(id),
    });

    root(tabs).querySelector<HTMLButtonElement>(".tab.active .close")?.click();
    expect(closed).toEqual([TERMINAL.id]);
    expect(selected).toEqual([]);
  });
});

interface MountOptions {
  tabs: AppSessionTab[];
  selected: AppSessionTabs["selected"];
  onSelect?: (id: string) => void;
  onClose?: (id: string) => void;
}

async function mountTabs(options: MountOptions): Promise<AppSessionTabs> {
  const tabs = new AppSessionTabs();
  tabs.tabs = options.tabs;
  tabs.selected = options.selected;
  if (options.onSelect !== undefined) tabs.onSelect = options.onSelect;
  if (options.onClose !== undefined) tabs.onClose = options.onClose;
  document.body.append(tabs);
  await tabs.updateComplete;
  return tabs;
}

function root(tabs: AppSessionTabs): ShadowRoot {
  const shadowRoot = tabs.shadowRoot;
  if (shadowRoot === null) throw new Error("AppSessionTabs did not render a shadow root");
  return shadowRoot;
}
