import { useLayoutEffect, type RefObject } from "react";
import { mentionPlacement } from "../mentionSyntax";

/**
 * Keep a window-level panel beside its anchor: above or below, wherever there
 * is more room, as wide as the anchor (or `minWidthRem` when the anchor is
 * narrower), and within the visual viewport (so a touch keyboard counts). The
 * panel scrolls inside the height it gets. A host that keeps the panel
 * unmounted while closed passes `open`, so placement starts when it appears.
 */
export function usePanelPlacement(panel: RefObject<HTMLElement | null>, anchor: RefObject<HTMLElement | null>, cap: number, minWidthRem = 0, open = true) {
  useLayoutEffect(() => {
    if (!open) return;
    const element = panel.current;
    const target = anchor.current;
    if (!element || !target) return;
    const viewport = window.visualViewport;
    const position = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const plan = mentionPlacement(target.getBoundingClientRect(), {
        left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0,
        width: viewport?.width ?? window.innerWidth, height: viewport?.height ?? window.innerHeight,
      }, cap, minWidthRem * rem);
      // Measured window geometry, not theme decisions.
      Object.assign(element.style, { left: `${plan.left}px`, top: `${plan.top}px`, width: `${plan.width}px`,
        maxHeight: `${plan.maxHeight}px`, transform: plan.up ? "translateY(-100%)" : "none" });
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(target);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    viewport?.addEventListener("resize", position);
    viewport?.addEventListener("scroll", position);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      viewport?.removeEventListener("resize", position);
      viewport?.removeEventListener("scroll", position);
    };
  }, [panel, anchor, cap, minWidthRem, open]);
}
