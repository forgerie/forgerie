// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { AutocompleteMenu } from "./AutocompleteMenu";
import { autocompleteStyles, type CompletionItem } from "./shared";

const items: CompletionItem[] = Array.from({ length: 12 }, (_, index) => ({
  kind: "command",
  replaceFrom: 0,
  replaceTo: 3,
  insertText: `/command-${String(index + 1)}`,
  detail: "prompt resource",
  description: index === 0 ? "Review <script>alert(1)</script>" : `Description ${String(index + 1)}`,
}));

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("AutocompleteMenu", () => {
  it("renders escaped listbox options with selected state and stable option ids", async () => {
    const menu = await mountMenu({ selectedIndex: 2 });
    const listbox = menu.shadowRoot?.querySelector("[role='listbox']");
    const options = Array.from(menu.shadowRoot?.querySelectorAll<HTMLElement>("[role='option']") ?? []);

    expect(listbox?.id).toBe("completion-listbox");
    expect(options).toHaveLength(12);
    expect(options[2]?.id).toBe("completion-option-2");
    expect(options[2]?.getAttribute("aria-selected")).toBe("true");
    expect(options[1]?.getAttribute("aria-selected")).toBe("false");
    expect(options[0]?.textContent).toContain("Review <script>alert(1)</script>");
    expect(menu.shadowRoot?.querySelector("script")).toBeNull();
  });

  it("keeps focus out of the option buttons and picks by pointer without browser focus theft", async () => {
    const onPick = vi.fn();
    const menu = await mountMenu({ selectedIndex: 0, onPick });
    const selected = menu.shadowRoot?.querySelector<HTMLElement>("[role='option'][aria-selected='true']");
    if (selected === null || selected === undefined) throw new Error("Expected selected option");
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true, composed: true });

    selected.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(selected.getAttribute("tabindex")).toBe("-1");
    expect(onPick).toHaveBeenCalledExactlyOnceWith(items[0]);
  });

  it("typesets command completions as a two-tone command mark, leaving other kinds plain", async () => {
    const menu = new AutocompleteMenu();
    menu.items = [
      { kind: "command", replaceFrom: 0, replaceTo: 3, insertText: "/tree", detail: "builtin" },
      { kind: "model", replaceFrom: 0, replaceTo: 3, insertText: "#anthropic/claude", detail: "anthropic" },
    ];
    document.body.append(menu);
    await menu.updateComplete;

    const options = Array.from(menu.shadowRoot?.querySelectorAll("[role='option']") ?? []);
    const mark = options[0]?.querySelector(".command-mark");
    expect(mark?.querySelector(".command-sigil")?.textContent).toBe("/");
    expect(mark?.querySelector(".command-name")?.textContent).toBe("tree");
    expect(options[1]?.querySelector(".command-mark")).toBeNull();
    expect(options[1]?.querySelector("strong")?.textContent).toBe("#anthropic/claude");
  });

  it("uses an internally scrolling bounded menu block", () => {
    const styles = autocompleteStyles.cssText.replaceAll(/\s+/g, " ");

    expect(styles).toContain("max-block-size: var(--composer-completion-menu-max-block-size, 260px);");
    expect(styles).not.toContain("min(260px");
    expect(styles).toContain("overflow: auto;");
    expect(styles).not.toContain("@media");
  });
});

async function mountMenu(options: {
  selectedIndex: number;
  onPick?: (item: CompletionItem) => void;
}): Promise<AutocompleteMenu> {
  const menu = new AutocompleteMenu();
  menu.items = items;
  menu.selectedIndex = options.selectedIndex;
  menu.listboxId = "completion-listbox";
  menu.optionIdPrefix = "completion-option-";
  if (options.onPick !== undefined) menu.onPick = options.onPick;
  document.body.append(menu);
  await menu.updateComplete;
  return menu;
}
