import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * System hook: a menu under a header button. A press outside it or Escape closes it.
 * A menu drawn elsewhere, such as at window level, passes its element so a press on it counts as inside.
 */
export function useMenu(detached?: RefObject<HTMLElement | null>) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: Event) => {
      if (event.target instanceof Node && !anchor.current?.contains(event.target) && !detached?.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("keydown", onKey); };
  }, [open, detached]);
  return { open, setOpen, anchor };
}
