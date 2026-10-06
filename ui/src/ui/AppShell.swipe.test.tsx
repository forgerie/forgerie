// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

let root: Root;
let onOpenChange: ReturnType<typeof vi.fn<(open: boolean) => void>>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // Every box is a 300 px sheet in a phone-wide shell: overlay layout, and a sheet to pull.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ width: 300, height: 600, x: 0, y: 0, top: 0, left: 0, right: 300, bottom: 600, toJSON: () => ({}) });
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function Harness({ initial }: { initial: boolean }) {
  const [open, setOpen] = useState(initial);
  return <AppShell open={open} onOpenChange={(next) => { onOpenChange(next); setOpen(next); }}
    picker={() => <nav>Sessions</nav>}
    thread={<main><p className="words">Transcript</p><pre className="code" style={{ overflowX: "auto" }}>wide code</pre></main>} />;
}
const render = (open = false) => {
  onOpenChange = vi.fn();
  return act(async () => root.render(<Harness initial={open} />));
};
const shell = () => document.querySelector<HTMLElement>(".app-shell")!;
const pointer = (type: string, target: Element, x: number, y = 100, pointerType = "touch", pointerId = 1) => act(async () => {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId, pointerType, isPrimary: pointerId === 1 }));
});
/** A drag from x0 through each x, then up. */
async function drag(target: Element, x0: number, xs: number[], options: { y?: number[]; pointerType?: string } = {}) {
  await pointer("pointerdown", target, x0, 100, options.pointerType);
  for (const [index, x] of xs.entries()) await pointer("pointermove", target, x, options.y?.[index] ?? 100, options.pointerType);
  const during = { drag: shell().dataset.drag, progress: shell().style.getPropertyValue("--sheet-progress") };
  await pointer("pointerup", target, xs.at(-1) ?? x0, 100, options.pointerType);
  return during;
}

describe("swiping the session sheet", () => {
  it("follows a rightward swipe and opens past the commit point", async () => {
    await render();
    const during = await drag(document.querySelector(".words")!, 20, [60, 140, 160]);
    expect(during).toEqual({ drag: "opening", progress: String(140 / 300) });
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(shell().dataset.sheet).toBe("open");
    // The finger lifted, so the CSS transition takes the sheet the rest of the way.
    expect(shell().dataset.drag).toBeUndefined();
  });

  it("slides a short swipe back closed", async () => {
    await render();
    await drag(document.querySelector(".words")!, 20, [60, 100]);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(shell().dataset.sheet).toBe("closed");
  });

  it("pushes an open sheet back with a leftward swipe", async () => {
    await render(true);
    await drag(document.querySelector("nav")!, 250, [220, 180]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(shell().dataset.sheet).toBe("closed");
  });

  it("finishes the first finger's drag when a second finger lands", async () => {
    await render();
    const words = document.querySelector(".words")!;
    await pointer("pointerdown", words, 20);
    await pointer("pointermove", words, 160);
    await pointer("pointerdown", words, 200, 100, "touch", 2);
    await pointer("pointermove", words, 180);
    await pointer("pointerup", words, 180);
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(shell().dataset.drag).toBeUndefined();
  });

  it("puts the sheet back where it was when the system takes the touch", async () => {
    await render();
    const words = document.querySelector(".words")!;
    await pointer("pointerdown", words, 20);
    await pointer("pointermove", words, 200);
    await pointer("pointercancel", words, 200);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(shell().dataset.drag).toBeUndefined();
    expect(shell().dataset.sheet).toBe("closed");
  });

  it("drops the click that ends a drag, but not the next press's own click", async () => {
    await render();
    const words = document.querySelector(".words")!;
    await drag(words, 20, [200]);
    const clicked = vi.fn();
    words.addEventListener("click", clicked);
    await act(async () => { words.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(clicked).not.toHaveBeenCalled();
    await drag(document.querySelector("nav")!, 250, [220, 180]);
    await pointer("pointerdown", words, 50);
    await act(async () => { words.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(clicked).toHaveBeenCalledOnce();
  });

  it("leaves a vertical scroll, a mouse, and sideways-scrolling code alone", async () => {
    await render();
    await drag(document.querySelector(".words")!, 20, [40, 60], { y: [160, 260] });
    await drag(document.querySelector(".words")!, 20, [200], { pointerType: "mouse" });
    const code = document.querySelector<HTMLElement>(".code")!;
    Object.defineProperty(code, "scrollWidth", { value: 900 });
    Object.defineProperty(code, "clientWidth", { value: 300 });
    await drag(code, 20, [200]);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
