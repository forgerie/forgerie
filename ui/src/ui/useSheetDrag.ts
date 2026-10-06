import { useEffect, useRef, type RefObject } from "react";
import { flushSync } from "react-dom";
import { releaseSheet, SHEET_DRAG, SHEET_IDLE, trackSheet, withinAngle, type SheetDrag } from "../sheetDrag";
import { ROW_PRESS } from "../picker/press";

/**
 * A resting finger gives the drag up at the row hold, so a long press on a
 * picker row passes straight from this gesture to the row menu, with no gap.
 */
const STILL_MS = ROW_PRESS.holdMs;
/** Sub-pixel layout leaves a pixel or two of slack on elements with nowhere to scroll. */
const SLACK_PX = 2;

interface Origin { x: number; y: number; pointerId: number; open: boolean; width: number }

/**
 * Binds a sideways finger drag on the shell to the session sheet: rightward
 * pulls it in, leftward pushes it back. The sheet follows the finger, so a
 * drag that was not meant is undone by letting go.
 *
 * During the drag the hook writes `--sheet-progress` and `data-drag` on the
 * shell directly. A React render per frame would trail the finger. On release
 * it commits the open state in one synchronous render, then lets the CSS
 * transition carry the sheet the rest of the way from where the finger left it.
 *
 * Touch only. A mouse selects text and a trackpad scrolls; the opener button
 * covers both.
 */
export function useSheetDrag(shell: RefObject<HTMLElement | null>, sheet: RefObject<HTMLElement | null>,
  options: { enabled: boolean; open: boolean; onOpenChange: (open: boolean) => void }) {
  const latest = useRef(options);
  useEffect(() => { latest.current = options; });

  useEffect(() => {
    const element = shell.current;
    if (!element || !options.enabled) return undefined;
    let origin: Origin | undefined;
    let drag: SheetDrag = SHEET_IDLE;
    let stillTimer: ReturnType<typeof setTimeout> | undefined;
    const show = (next: SheetDrag) => {
      drag = next;
      if (next.type === "idle") { element.removeAttribute("data-drag"); element.style.removeProperty("--sheet-progress"); return; }
      element.setAttribute("data-drag", next.gesture);
      element.style.setProperty("--sheet-progress", String(next.progress));
    };
    const disarm = () => { clearTimeout(stillTimer); stillTimer = undefined; origin = undefined; };
    /** The OS took the touch (an edge-back gesture, a call): the sheet goes back where it was. */
    const abandon = () => { disarm(); show(SHEET_IDLE); };
    const finish = () => {
      const keep = releaseSheet(drag);
      disarm();
      if (keep !== undefined) {
        // The sheet just moved under the finger; the tap that ends a drag is not a tap.
        swallowNextClick();
        if (keep !== latest.current.open) flushSync(() => latest.current.onOpenChange(keep));
      }
      show(SHEET_IDLE);
    };

    const onPointerDown = (event: PointerEvent) => {
      // A second finger during a drag is not a new drag. Leaving it alone keeps the first finger's release.
      if (event.pointerType !== "touch" || !event.isPrimary) return;
      abandon();
      if (scrollsSideways(event) || hasSelection()) return;
      origin = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, open: latest.current.open,
        width: sheet.current?.getBoundingClientRect().width ?? 0 };
      stillTimer = setTimeout(() => { if (drag.type === "idle") disarm(); }, STILL_MS);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (origin?.pointerId !== event.pointerId) return;
      // A selection can start part-way through a press. Then the drag moves its handles.
      if (drag.type === "idle" && hasSelection()) { disarm(); return; }
      const next = trackSheet({ current: drag, open: origin.open, dx: event.clientX - origin.x, dy: event.clientY - origin.y, sheetWidthPx: origin.width });
      if (next.type !== "idle") { clearTimeout(stillTimer); stillTimer = undefined; }
      if (next !== drag) show(next);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (origin?.pointerId !== event.pointerId) return;
      finish();
    };
    const onPointerCancel = (event: PointerEvent) => {
      if (origin?.pointerId === event.pointerId) abandon();
    };
    /**
     * Claim a sideways drag before the browser scrolls with it. Without this the
     * browser takes the gesture and sends pointercancel. `touch-action: pan-y`
     * would also work, but it would stop a code block or table from scrolling
     * sideways under a finger.
     */
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!origin || !touch || !event.cancelable) return;
      if (drag.type !== "idle") { event.preventDefault(); return; }
      const dx = touch.clientX - origin.x;
      const dy = Math.abs(touch.clientY - origin.y);
      // Only a drag the sheet can take: its direction, and its angle. A steeper drag stays a scroll.
      if (withinAngle(dx, dy, SHEET_DRAG) && (origin.open ? dx < 0 : dx > 0) && !hasSelection()) event.preventDefault();
    };

    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", onPointerUp);
    element.addEventListener("pointercancel", onPointerCancel);
    element.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      disarm();
      show(SHEET_IDLE);
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", onPointerUp);
      element.removeEventListener("pointercancel", onPointerCancel);
      element.removeEventListener("touchmove", onTouchMove);
    };
  }, [shell, sheet, options.enabled]);
}

function hasSelection(): boolean {
  const selection = typeof window.getSelection === "function" ? window.getSelection() : null;
  return selection !== null && !selection.isCollapsed;
}

/**
 * A drag that starts in something that scrolls sideways (a code block, a wide
 * table) belongs to it. Wider content alone is not a scroller: a box whose
 * overflow is visible cannot scroll at all.
 */
function scrollsSideways(event: Event): boolean {
  return event.composedPath().some((target) => target instanceof Element
    && target.scrollWidth - target.clientWidth > SLACK_PX
    && ["auto", "scroll"].includes(getComputedStyle(target).overflowX));
}

/**
 * Drops the click that can follow a drag's lift. A drag often fires no click at
 * all, so the guard also ends at the next press: that press's own tap is real.
 */
function swallowNextClick() {
  const swallow = (event: MouseEvent) => { event.stopPropagation(); event.preventDefault(); stop(); };
  const stop = () => {
    window.removeEventListener("click", swallow, { capture: true });
    window.removeEventListener("pointerdown", stop, { capture: true });
    clearTimeout(timer);
  };
  window.addEventListener("click", swallow, { capture: true });
  window.addEventListener("pointerdown", stop, { capture: true });
  const timer = setTimeout(stop, 400);
}
