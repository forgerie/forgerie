// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { AppPanelEdgeControl } from "./AppPanelEdgeControl";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("AppPanelEdgeControl", () => {
  it("renders nothing when panel resizing is unavailable", async () => {
    const control = await mount();

    expect(control.shadowRoot?.querySelector(".resize-handle")).toBeNull();
  });

  it("renders accessible resize limits and the current width", async () => {
    const control = await mount({ resizable: true, panelWidth: 340, minWidth: 200, maxWidth: 700, controls: "navigation-panel", resizeLabel: "Resize navigation" });
    const handle = resizeHandle(control);

    expect(handle.getAttribute("role")).toBe("separator");
    expect(handle.getAttribute("aria-label")).toBe("Resize navigation");
    expect(handle.getAttribute("aria-controls")).toBe("navigation-panel");
    expect(handle.getAttribute("aria-valuemin")).toBe("200");
    expect(handle.getAttribute("aria-valuemax")).toBe("700");
    expect(handle.getAttribute("aria-valuenow")).toBe("340");
  });

  it("resizes with keyboard commands and reports completion", async () => {
    const onResize = vi.fn<(width: number) => void>();
    const onResizeEnd = vi.fn();
    const control = await mount({ resizable: true, panelWidth: 300, minWidth: 200, maxWidth: 600, onResize, onResizeEnd });
    const handle = resizeHandle(control);

    handle.dispatchEvent(key("ArrowRight"));
    handle.dispatchEvent(key("ArrowLeft", true));
    handle.dispatchEvent(key("Home"));
    handle.dispatchEvent(key("End"));
    handle.dispatchEvent(key("Enter"));

    expect(onResize.mock.calls.map(([width]) => width)).toEqual([324, 228, 200, 600]);
    expect(onResizeEnd).toHaveBeenCalledTimes(4);
  });

  it("uses panel-relative keyboard directions for the workspace side", async () => {
    const onResize = vi.fn<(width: number) => void>();
    const control = await mount({ side: "workspace", resizable: true, panelWidth: 500, onResize });
    const handle = resizeHandle(control);

    handle.dispatchEvent(key("ArrowLeft"));
    handle.dispatchEvent(key("ArrowRight"));

    expect(onResize.mock.calls.map(([width]) => width)).toEqual([524, 476]);
  });

  it("drags from the callback width and completes pointer capture", async () => {
    const onResize = vi.fn();
    const onResizeEnd = vi.fn();
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    const control = await mount({ resizable: true, panelWidth: 300, onResizeStart: () => 320, onResize, onResizeEnd });
    const handle = resizeHandle(control);
    handle.setPointerCapture = setPointerCapture;
    handle.releasePointerCapture = releasePointerCapture;

    handle.dispatchEvent(pointer("pointerdown", { pointerId: 7, clientX: 100, button: 0 }));
    expect(control.hasAttribute("resizing")).toBe(true);
    expect(setPointerCapture).toHaveBeenCalledWith(7);

    handle.dispatchEvent(pointer("pointermove", { pointerId: 7, clientX: 103 }));
    expect(onResize).not.toHaveBeenCalled();
    handle.dispatchEvent(pointer("pointermove", { pointerId: 7, clientX: 140 }));
    expect(onResize).toHaveBeenCalledWith(360);

    handle.dispatchEvent(pointer("pointerup", { pointerId: 7, clientX: 140 }));
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    expect(control.hasAttribute("resizing")).toBe(false);
    expect(onResizeEnd).toHaveBeenCalledOnce();
  });

  it("cancels matching pointer drags and ignores unrelated pointers", async () => {
    const onResizeEnd = vi.fn();
    const control = await mount({ resizable: true, panelWidth: 300, onResizeEnd });
    const handle = resizeHandle(control);
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();

    handle.dispatchEvent(pointer("pointerdown", { pointerId: 2, clientX: 100, button: 0 }));
    handle.dispatchEvent(pointer("pointercancel", { pointerId: 3, clientX: 100 }));
    expect(control.hasAttribute("resizing")).toBe(true);
    handle.dispatchEvent(pointer("pointercancel", { pointerId: 2, clientX: 100 }));

    expect(control.hasAttribute("resizing")).toBe(false);
    expect(onResizeEnd).toHaveBeenCalledOnce();
  });

  it("resets on double-click and double-tap", async () => {
    const onReset = vi.fn();
    const now = vi.spyOn(Date, "now").mockReturnValueOnce(1_000).mockReturnValueOnce(1_200);
    const control = await mount({ resizable: true, panelWidth: 300, onReset });
    const handle = resizeHandle(control);
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();

    handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    expect(onReset).toHaveBeenCalledOnce();

    handle.dispatchEvent(pointer("pointerdown", { pointerId: 1, clientX: 100, button: 0 }));
    handle.dispatchEvent(pointer("pointerup", { pointerId: 1, clientX: 100 }));
    handle.dispatchEvent(pointer("pointerdown", { pointerId: 2, clientX: 100, button: 0 }));
    handle.dispatchEvent(pointer("pointerup", { pointerId: 2, clientX: 100 }));

    expect(now).toHaveBeenCalledTimes(2);
    expect(onReset).toHaveBeenCalledTimes(2);
  });

  it("does not start a drag for non-primary buttons or unavailable widths", async () => {
    const onResize = vi.fn();
    const control = await mount({ resizable: true, onResizeStart: () => undefined, onResize });
    const handle = resizeHandle(control);
    handle.setPointerCapture = vi.fn();

    handle.dispatchEvent(pointer("pointerdown", { pointerId: 1, clientX: 100, button: 1 }));
    handle.dispatchEvent(pointer("pointerdown", { pointerId: 2, clientX: 100, button: 0 }));
    handle.dispatchEvent(pointer("pointermove", { pointerId: 2, clientX: 140 }));

    expect(control.hasAttribute("resizing")).toBe(false);
    expect(onResize).not.toHaveBeenCalled();
  });
});

async function mount(patch: Partial<AppPanelEdgeControl> = {}): Promise<AppPanelEdgeControl> {
  const control = new AppPanelEdgeControl();
  Object.assign(control, patch);
  document.body.append(control);
  await control.updateComplete;
  return control;
}

function resizeHandle(control: AppPanelEdgeControl): HTMLElement {
  const handle = control.shadowRoot?.querySelector<HTMLElement>(".resize-handle");
  if (handle === null || handle === undefined) throw new Error("Expected resize handle");
  return handle;
}

function key(value: string, shiftKey = false): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true, composed: true });
}

function pointer(type: string, init: PointerEventInit): PointerEvent {
  return new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, ...init });
}
