import { useLayoutEffect, useRef, useState } from "react";

/** The root size a plan's thresholds assume, in CSS px. */
export const PLAN_ROOT = 16;

/**
 * An element's content width, scaled to a 16 px root so a plan's px thresholds
 * follow the reader's text size. 0 until laid out; a plan treats 0 as unknown.
 * The element must be mounted with the hook's owner: the ref is read once, at
 * the first layout.
 */
export function useInnerWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = () => {
      const style = getComputedStyle(element);
      const root = Number.parseFloat(getComputedStyle(element.ownerDocument.documentElement).fontSize) || PLAN_ROOT;
      const content = element.clientWidth - (Number.parseFloat(style.paddingInlineStart) || 0) - (Number.parseFloat(style.paddingInlineEnd) || 0);
      setWidth(Math.max(0, content) * PLAN_ROOT / root);
    };
    measure();
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}
