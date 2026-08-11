// @vitest-environment happy-dom
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { describe, expect, it } from "vitest";
import { PanelPeekController, ownsHorizontalScroll } from "./panelPeekController";
import { PANEL_PEEK } from "./panelPeek";

const SHEET = 300;

describe("PanelPeekController", () => {
  it("pulls a sheet in as the finger travels", () => {
    const { controller, drag } = harness();

    drag.down(100, 100);
    drag.move(160, 100);

    expect(controller.panel).toBe("navigation");
    expect(controller.progress("navigation")).toBeCloseTo(0.2);
    expect(controller.isTracking).toBe(true);
  });

  it("opens the sheet when the finger let go past the commit point", () => {
    const { controller, drag } = harness();

    drag.down(100, 100);
    drag.move(100 + SHEET * 0.6, 100);
    drag.up();

    expect(controller.isOpen).toBe(true);
  });

  it("lets a half look fall back, which is what makes the gesture free", () => {
    const { controller, drag } = harness();

    drag.down(100, 100);
    drag.move(100 + SHEET * 0.2, 100);
    drag.up();

    expect(controller.panel).toBeUndefined();
  });

  it("gives a drag that starts in a sideways scroller back to it", () => {
    const { controller, drag } = harness();
    drag.scroller.scrollsSideways(true);

    drag.down(100, 100);
    drag.move(200, 100);

    expect(controller.panel).toBeUndefined();
  });

  it("gives up on a finger that rests before it travels, so a hold still selects", async () => {
    const { controller, drag } = harness();

    drag.down(100, 100);
    await wait(500);
    drag.move(200, 100);

    expect(controller.panel).toBeUndefined();
  });

  it("keeps a drag that started moving before the rest window closed", async () => {
    const { controller, drag } = harness();

    drag.down(100, 100);
    drag.move(100 + PANEL_PEEK.capturePx, 100);
    await wait(500);
    drag.move(200, 100);

    expect(controller.panel).toBe("navigation");
  });

  it("ignores a mouse, which has the edge control and a shortcut", () => {
    const { controller, drag } = harness();

    drag.down(100, 100, "mouse");
    drag.move(200, 100, "mouse");

    expect(controller.panel).toBeUndefined();
  });

  it("refuses to peek a panel that is already docked", () => {
    const { controller, drag } = harness({ peekable: () => false });

    drag.down(100, 100);
    drag.move(200, 100);

    expect(controller.panel).toBeUndefined();
  });

  it("reads two fingers on a trackpad as the same gesture", () => {
    const { controller, host } = harness();

    // A trackpad reports the content's movement, which runs against the finger.
    host.dispatchEvent(wheelEvent(-SHEET * 0.6, 0));

    expect(controller.panel).toBe("navigation");
    expect(controller.progress("navigation")).toBeCloseTo(0.6);
  });

  it("leaves a vertical scroll on a trackpad alone", () => {
    const { controller, host } = harness();

    host.dispatchEvent(wheelEvent(-4, 120));

    expect(controller.panel).toBeUndefined();
  });

  it("settles a trackpad gesture on a pause, since there is no release", async () => {
    const { controller, host } = harness();

    host.dispatchEvent(wheelEvent(-SHEET * 0.6, 0));
    await wait(200);

    expect(controller.isOpen).toBe(true);
    expect(controller.isTracking).toBe(false);
  });

  it("claims a horizontal drag, or the browser scrolls with it and cancels the pointer", () => {
    const { controller, drag } = harness();

    drag.down(100, 100);

    expect(touchMove(controller, 140, 104)).toBe(true);
  });

  it("leaves a vertical drag to the list it belongs to", () => {
    const { controller, drag } = harness();

    drag.down(100, 100);

    expect(touchMove(controller, 108, 240)).toBe(false);
  });

  it("yields to a selection that appears part-way through the press", () => {
    const { controller, drag } = harness();
    drag.down(100, 100);
    drag.move(140, 100);
    selectSomeText();

    drag.move(260, 100);

    expect(controller.progress("navigation")).toBeLessThan(0.2);
    expect(touchMove(controller, 300, 100)).toBe(false);
  });

  it("claims nothing when the gesture was never armed", () => {
    const { controller } = harness();

    expect(touchMove(controller, 300, 100)).toBe(false);
  });

  it("closes on request without touching what the user asked of the panel", () => {
    const { controller, drag } = harness();

    drag.down(100, 100);
    drag.move(100 + SHEET, 100);
    drag.up();
    controller.close();

    expect(controller.panel).toBeUndefined();
  });
});

describe("ownsHorizontalScroll", () => {
  it("finds a diff that still has somewhere to go", () => {
    expect(ownsHorizontalScroll([elementWithScroll(900, 400, "auto")])).toBe(true);
  });

  it("passes over content that fits", () => {
    expect(ownsHorizontalScroll([elementWithScroll(400, 400, "auto")])).toBe(false);
  });

  it("passes over a turn whose content spills but cannot scroll", () => {
    // Every transcript turn looks like this. Reading width alone hands each one
    // a gesture it has no way to use, and the sheet never arms over a session.
    expect(ownsHorizontalScroll([elementWithScroll(900, 400, "visible")])).toBe(false);
  });

  it("treats a pixel or two of sub-pixel rounding as nothing to scroll", () => {
    expect(ownsHorizontalScroll([elementWithScroll(402, 400, "auto")])).toBe(false);
  });

  it("passes over an empty path", () => {
    expect(ownsHorizontalScroll([])).toBe(false);
  });
});

function elementWithScroll(scrollWidth: number, clientWidth: number, overflowX = "auto"): Element {
  const element = document.createElement("div");
  element.style.overflowX = overflowX;
  Object.defineProperty(element, "scrollWidth", { value: scrollWidth, configurable: true });
  Object.defineProperty(element, "clientWidth", { value: clientWidth, configurable: true });
  document.body.append(element);
  return element;
}

function harness(overrides: { peekable?: (panel: "navigation" | "workspace") => boolean } = {}) {
  const host = document.createElement("div");
  const scrollerElement = elementWithScroll(0, 400);
  host.append(scrollerElement);
  document.body.append(host);

  const recordingHost = new RecordingHost();
  const controller = new PanelPeekController(recordingHost, {
    peekable: overrides.peekable ?? (() => true),
    sheetWidth: () => SHEET,
  });

  host.addEventListener("pointerdown", (event) => { controller.onPointerDown(event); });
  host.addEventListener("pointermove", (event) => { controller.onPointerMove(event); });
  host.addEventListener("pointerup", (event) => { controller.onPointerUp(event); });
  host.addEventListener("wheel", (event) => { controller.onWheel(event); });

  const source = () => scrollerElement;
  const drag = {
    scroller: {
      scrollsSideways(yes: boolean): void {
        Object.defineProperty(scrollerElement, "scrollWidth", { value: yes ? 900 : 0, configurable: true });
      },
    },
    down(x: number, y: number, pointerType = "touch"): void {
      source().dispatchEvent(pointerEvent("pointerdown", { clientX: x, clientY: y, pointerType }));
    },
    move(x: number, y: number, pointerType = "touch"): void {
      source().dispatchEvent(pointerEvent("pointermove", { clientX: x, clientY: y, pointerType }));
    },
    up(pointerType = "touch"): void {
      source().dispatchEvent(pointerEvent("pointerup", { clientX: 0, clientY: 0, pointerType }));
    },
  };

  return { controller, host, drag };
}

/** happy-dom has no PointerEvent; a real Event carrying the same fields serves. */
function pointerEvent(type: string, init: { clientX: number; clientY: number; pointerType: string }): Event {
  const event = new Event(type, { bubbles: true, composed: true });
  Object.assign(event, init, { pointerId: 1 });
  return event;
}

/**
 * Whether the controller took the gesture from the browser. A real browser
 * steals a horizontal drag inside a scrolling area at its own slop distance and
 * sends `pointercancel`, so refusing to claim means the sheet never moves.
 */
function touchMove(controller: PanelPeekController, clientX: number, clientY: number): boolean {
  let claimed = false;
  controller.onTouchMove({
    touches: [{ clientX, clientY }],
    cancelable: true,
    preventDefault: () => { claimed = true; },
  });
  return claimed;
}

function wheelEvent(deltaX: number, deltaY: number): Event {
  const event = new Event("wheel", { bubbles: true, composed: true, cancelable: true });
  Object.assign(event, { deltaX, deltaY });
  return event;
}

/** A real selection over real text, which is what the controller asks about. */
function selectSomeText(): void {
  const paragraph = document.createElement("p");
  paragraph.textContent = "selected words";
  document.body.append(paragraph);
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

class RecordingHost implements ReactiveControllerHost {
  readonly updateComplete = Promise.resolve(true);
  controller: ReactiveController | undefined;
  updateCount = 0;

  addController(controller: ReactiveController): void {
    this.controller = controller;
  }

  removeController(controller: ReactiveController): void {
    if (this.controller === controller) this.controller = undefined;
  }

  requestUpdate(): void {
    this.updateCount += 1;
  }
}
