// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { GuidancePicker } from "./GuidancePicker";

afterEach(() => {
  document.body.replaceChildren();
});

describe("GuidancePicker", () => {
  it("shows public names, descriptions, and selected state", async () => {
    const picker = new GuidancePicker();
    picker.activeIds = ["technical-english"];
    document.body.append(picker);
    await picker.updateComplete;

    const option = required(picker.shadowRoot?.querySelector<HTMLButtonElement>("[data-guidance-id='technical-english']"));
    expect(option.textContent).toContain("Technical English");
    expect(option.textContent).toContain("Use short, direct sentences and consistent terms.");
    expect(option.getAttribute("aria-pressed")).toBe("true");
    expect(picker.shadowRoot?.textContent).not.toContain("ASD-STE100");
  });

  it("supports keyboard movement, selection, and Escape", async () => {
    const picker = new GuidancePicker();
    const onToggle = vi.fn();
    const onClose = vi.fn();
    picker.onToggle = onToggle;
    picker.onClose = onClose;
    document.body.append(picker);
    await picker.updateComplete;

    const option = required(picker.shadowRoot?.querySelector<HTMLButtonElement>("[data-guidance-id='technical-english']"));
    option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onToggle).toHaveBeenCalledWith("technical-english", true);

    option.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).toHaveBeenCalledWith(true);
  });

});

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected guidance option");
  return value;
}
