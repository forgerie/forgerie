// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { TERMINAL_SOFT_KEYS, terminalSoftKeySequence } from "../terminalKeys";
import { TerminalSoftKeys, type TerminalSoftKeyInputOptions } from "./TerminalSoftKeys";

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("TerminalSoftKeys", () => {
  it("renders the terminal key catalog as an accessible toolbar", async () => {
    const element = await mount();

    const toolbar = element.shadowRoot?.querySelector("[role='toolbar']");
    const buttons = element.shadowRoot?.querySelectorAll("button");

    expect(toolbar?.getAttribute("aria-label")).toBe("Terminal soft keys");
    expect(buttons).toHaveLength(TERMINAL_SOFT_KEYS.length);
    expect(buttons?.[0]?.getAttribute("aria-label")).toBe(firstKey().ariaLabel);
  });

  it("sends keyboard clicks with the configured refocus policy", async () => {
    const inputs: { data: string; options: TerminalSoftKeyInputOptions }[] = [];
    const element = await mount((data, options) => { inputs.push({ data, options }); });
    element.refocusOnClick = false;
    await element.updateComplete;

    firstButton(element).click();

    expect(inputs).toEqual([{
      data: terminalSoftKeySequence(firstKey().id, undefined),
      options: { refocus: false },
    }]);
  });

  it("sends a touch tap once and suppresses its synthetic click", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T00:00:00.000Z"));
    const inputs: { data: string; options: TerminalSoftKeyInputOptions }[] = [];
    const element = await mount((data, options) => { inputs.push({ data, options }); });
    const button = firstButton(element);

    button.dispatchEvent(pointerEvent("pointerdown", { pointerId: 1, pointerType: "touch", clientX: 10, clientY: 10 }));
    button.dispatchEvent(pointerEvent("pointerup", { pointerId: 1, pointerType: "touch", clientX: 12, clientY: 12 }));
    button.click();

    expect(inputs).toEqual([{
      data: terminalSoftKeySequence(firstKey().id, undefined),
      options: { refocus: false },
    }]);
  });

  it("cancels a touch gesture that becomes a horizontal scroll", async () => {
    const onInput = vi.fn();
    const element = await mount(onInput);
    const button = firstButton(element);

    button.dispatchEvent(pointerEvent("pointerdown", { pointerId: 2, pointerType: "touch", clientX: 10, clientY: 10 }));
    button.dispatchEvent(pointerEvent("pointermove", { pointerId: 2, pointerType: "touch", clientX: 30, clientY: 10 }));
    button.dispatchEvent(pointerEvent("pointerup", { pointerId: 2, pointerType: "touch", clientX: 30, clientY: 10 }));

    expect(onInput).not.toHaveBeenCalled();
  });

  it("cancels the tracked pointer and ignores unrelated pointer events", async () => {
    const onInput = vi.fn();
    const element = await mount(onInput);
    const button = firstButton(element);

    button.dispatchEvent(pointerEvent("pointerdown", { pointerId: 3, pointerType: "touch", clientX: 10, clientY: 10 }));
    button.dispatchEvent(pointerEvent("pointerup", { pointerId: 4, pointerType: "touch", clientX: 10, clientY: 10 }));
    button.dispatchEvent(pointerEvent("pointercancel", { pointerId: 3, pointerType: "touch", clientX: 10, clientY: 10 }));

    expect(onInput).not.toHaveBeenCalled();
  });

  it("ignores non-primary mouse presses but keeps normal click behavior", async () => {
    const onInput = vi.fn();
    const element = await mount(onInput);
    const button = firstButton(element);

    button.dispatchEvent(pointerEvent("pointerdown", { pointerId: 5, pointerType: "mouse", button: 2, clientX: 10, clientY: 10 }));
    button.dispatchEvent(pointerEvent("pointerup", { pointerId: 5, pointerType: "mouse", button: 2, clientX: 10, clientY: 10 }));
    button.click();

    expect(onInput).toHaveBeenCalledOnce();
    expect(onInput).toHaveBeenCalledWith(terminalSoftKeySequence(firstKey().id, undefined), { refocus: true });
  });
});

async function mount(onInput: TerminalSoftKeys["onInput"] = () => undefined): Promise<TerminalSoftKeys> {
  const element = new TerminalSoftKeys();
  element.onInput = onInput;
  document.body.append(element);
  await element.updateComplete;
  return element;
}

function firstButton(element: TerminalSoftKeys): HTMLButtonElement {
  const button = element.shadowRoot?.querySelector("button");
  if (!(button instanceof HTMLButtonElement)) throw new Error("Terminal soft keys did not render a button");
  return button;
}

function firstKey() {
  const key = TERMINAL_SOFT_KEYS[0];
  if (key === undefined) throw new Error("Terminal soft key catalog is empty");
  return key;
}

function pointerEvent(
  type: string,
  values: { pointerId: number; pointerType: string; clientX: number; clientY: number; button?: number },
): Event {
  const event = new Event(type, { bubbles: true, composed: true, cancelable: true });
  Object.assign(event, { button: 0, ...values });
  return event;
}
