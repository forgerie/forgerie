// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerPopover } from "./ComposerPopover";
import "./ComposerChoiceList";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/**
 * A popover is not a modal: it raises no scrim, traps no focus, and answers
 * Escape by handing the caret back to the draft. Placement is measured, so the
 * measurement is injectable and the applied result is what the tests read.
 */
describe("composer-popover", () => {
  it("applies the computed placement, and says which side it opened", async () => {
    const popover = await mount({ space: { above: 400, below: 120 } });
    const panel = required(popover, ".popover-panel");

    expect(popover.dataset["side"]).toBe("above");
    expect(panel.style.left).toBe("216px");
    expect(panel.style.maxWidth).toBe("348px");
  });

  it("caps its width without setting one, and holds that across updates", async () => {
    const popover = await mount({ space: { above: 400, below: 120 } });
    const panel = required(popover, ".popover-panel");

    // Setting a measured width would shrink the panel a little on every pass.
    expect(panel.style.width).toBe("");
    popover.reposition();
    popover.reposition();
    await popover.updateComplete;

    expect(panel.style.width).toBe("");
    expect(panel.style.maxWidth).toBe("348px");
  });

  it("flips below when there is no room above, without changing its width", async () => {
    const popover = await mount({ space: { above: 60, below: 400 } });
    const panel = required(popover, ".popover-panel");

    expect(popover.dataset["side"]).toBe("below");
    expect(panel.style.maxWidth).toBe("348px");
  });

  it("raises no scrim and holds no focus trap", async () => {
    const popover = await mount({});

    expect(popover.shadowRoot?.querySelector(".backdrop, .scrim")).toBeNull();
    expect(popover.shadowRoot?.querySelector("[aria-modal]")).toBeNull();
  });

  it("returns to the draft on Escape", async () => {
    const onClose = vi.fn();
    const popover = await mount({ onClose });

    popover.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(onClose).toHaveBeenCalledWith(true);
  });

  it("closes when a press lands outside, and stays open for one inside", async () => {
    const onClose = vi.fn();
    const popover = await mount({ onClose });

    required(popover, ".popover-panel").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, composed: true }));
    expect(onClose).not.toHaveBeenCalled();

    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, composed: true }));
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it("closes without swallowing the activation that closed it", async () => {
    const onClose = vi.fn();
    const outsideClick = vi.fn();
    const outside = document.createElement("button");
    outside.addEventListener("click", outsideClick);
    await mount({ onClose });
    document.body.append(outside);

    outside.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, composed: true }));
    outside.click();

    expect(onClose).toHaveBeenCalledWith(false);
    expect(outsideClick).toHaveBeenCalledOnce();
  });

  it("stays open for a press on a row inside the content it holds", async () => {
    const onClose = vi.fn();
    const popover = await mount({ onClose });
    const list = document.createElement("composer-choice-list");
    list.groups = [{ items: [{ value: "anthropic/claude-opus-4-8", label: "claude-opus-4-8" }] }];
    popover.append(list);
    await list.updateComplete;

    // The row lives in the list's shadow root, one tree below the popover's.
    // A containment check inside a single tree cannot see it.
    const row = list.shadowRoot?.querySelector("[data-value]");
    row?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, composed: true }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("names itself for a screen reader", async () => {
    const popover = await mount({ label: "Thinking level" });
    const panel = required(popover, ".popover-panel");

    expect(panel.getAttribute("role")).toBe("dialog");
    expect(panel.getAttribute("aria-label")).toBe("Thinking level");
  });
});

async function mount(options: {
  space?: { above: number; below: number };
  onClose?: (restoreFocus: boolean) => void;
  label?: string;
} = {}): Promise<ComposerPopover> {
  const popover = new ComposerPopover();
  popover.label = options.label ?? "Model";
  popover.measure = () => ({
    anchor: { left: 216, width: 120 },
    space: options.space ?? { above: 400, below: 120 },
    host: { width: 680 },
    panel: { height: 180 },
  });
  if (options.onClose !== undefined) popover.onClose = options.onClose;
  document.body.append(popover);
  await popover.updateComplete;
  return popover;
}

function required(popover: ComposerPopover, selector: string): HTMLElement {
  const found = popover.shadowRoot?.querySelector(selector);
  if (!(found instanceof HTMLElement)) throw new Error(`Expected ${selector}`);
  return found;
}
