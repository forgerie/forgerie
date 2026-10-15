// @vitest-environment happy-dom
import { Activity, act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReaderAnchor } from "./useReaderAnchor";

// These controlled measurements test scroll ownership and rounding, not layout.
// fast-chat-open-acceptance.mjs proves the geometry in real Chromium.
let root: Root;
let viewport: HTMLDivElement;
let above: HTMLDivElement;
let reader: HTMLDivElement;
let growth: number;
let resized: () => void;
const disconnect = vi.fn();
const box = (top: number, height: number) => new DOMRect(0, top, 600, height);
function Fixture() {
  const column = useRef<HTMLDivElement>(null);
  useReaderAnchor(column);
  return <div ref={(node) => { if (node) viewport = node; }}>
    <div ref={column}>
      <div data-message-id="above" ref={(node) => { if (node) above = node; }}>Earlier reply</div>
      <div data-message-id="reader" ref={(node) => { if (node) reader = node; }}>The reply being read</div>
    </div>
  </div>;
}
const scroll = (top: number) => { viewport.scrollTop = top; viewport.dispatchEvent(new Event("scroll")); };
const y = () => reader.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
beforeEach(async () => {
  growth = 0;
  disconnect.mockClear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resized = callback; }
    observe() {}
    disconnect = disconnect;
  });
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Activity mode="visible"><Fixture /></Activity>));
  Object.defineProperties(viewport, {
    clientHeight: { configurable: true, value: 200 },
    scrollHeight: { configurable: true, get: () => 600 + growth },
  });
  vi.spyOn(viewport, "getBoundingClientRect").mockImplementation(() => box(100, 200));
  vi.spyOn(above, "getBoundingClientRect").mockImplementation(() => box(100 - viewport.scrollTop, 200 + growth));
  vi.spyOn(reader, "getBoundingClientRect").mockImplementation(() => box(300 + growth - viewport.scrollTop, 400));
  vi.spyOn(viewport, "scrollTo").mockImplementation((options: ScrollToOptions | number) => {
    if (typeof options === "object") viewport.scrollTop = Math.round(options.top ?? 0);
  });
  scroll(250);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("reader anchoring", () => {
  it("keeps the reader's message at its offset when earlier media grows", () => {
    const before = y();
    growth = 137;
    resized();
    expect(y()).toBe(before);
    expect(viewport.scrollTop).toBe(387);
  });

  it("leaves following the tail to the viewport", () => {
    scroll(400);
    growth = 137;
    resized();
    expect(viewport.scrollTo).not.toHaveBeenCalled();
  });

  it("yields to a prepend correction or native anchoring before its scroll event", () => {
    growth = 137;
    viewport.scrollTop += 137;
    resized();
    expect(y()).toBe(-50);
    expect(viewport.scrollTo).not.toHaveBeenCalled();
  });

  it("uses a user's new scroll position, even before its scroll event arrives", () => {
    viewport.scrollTop = 290;
    resized();
    const before = y();
    growth = 60;
    resized();
    expect(y()).toBe(before);
  });

  it("does not accumulate subpixel errors through correction scroll events", () => {
    const before = y();
    for (let draw = 1; draw <= 6; draw++) {
      growth = 31.484375 * draw;
      resized();
      viewport.dispatchEvent(new Event("scroll"));
      expect(Math.abs(y() - before)).toBeLessThanOrEqual(0.5);
    }
  });

  it("releases the old offset on the reader's next scroll", () => {
    growth = 50;
    resized();
    scroll(350);
    const before = y();
    growth = 110;
    resized();
    expect(y()).toBe(before);
  });

  it("disconnects while Activity hides it and captures again on return", async () => {
    await act(async () => root.render(<Activity mode="hidden"><Fixture /></Activity>));
    expect(disconnect).toHaveBeenCalledOnce();
    await act(async () => root.render(<Activity mode="visible"><Fixture /></Activity>));
    const before = y();
    growth = 137;
    resized();
    expect(y()).toBe(before);
  });
});
