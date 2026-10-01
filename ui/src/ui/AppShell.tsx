import { PanelLeftIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { SessionFrameLeading } from "./SessionFrame";

/**
 * Dock rule A (user, 2026-09-29): the picker slides over the thread in every
 * Fold posture and docks beside it only when the shell is at least this wide.
 * Measured on the shell, not the viewport. A guess until measured on the Tab
 * Ultra 11 and a desktop window.
 */
export const DOCK_MIN_WIDTH = 1000;
export type ShellLayout = "docked" | "overlay";
export function shellLayout(width: number): ShellLayout { return width >= DOCK_MIN_WIDTH ? "docked" : "overlay"; }

/**
 * The picker is mounted once and moved between the dock and the sheet by CSS,
 * so its scroll position and preferences survive a fold, unfold, or rotate.
 */
export function AppShell({ picker, thread, open, onOpenChange, attention }: {
  picker: (layout: ShellLayout) => ReactNode;
  thread: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  attention?: "blocked" | "unread" | undefined;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<ShellLayout>("overlay");
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setLayout(shellLayout(element.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const hidden = layout === "overlay" && !open;
  const opener = layout === "overlay" ? <button className="app-opener" aria-label="Sessions" title="Sessions" aria-expanded={open}
    aria-controls="app-picker" data-attention={attention} onClick={() => onOpenChange(true)}>
    <PanelLeftIcon aria-hidden size={16} />
  </button> : null;
  return <div ref={ref} className="app-shell" data-layout={layout} data-sheet={hidden ? "closed" : "open"}>
    <aside id="app-picker" className="app-picker" aria-hidden={hidden} inert={hidden}>{picker(layout)}</aside>
    {layout === "overlay" && open ? <div className="app-scrim" aria-hidden="true" onClick={() => onOpenChange(false)} /> : null}
    <div className="app-thread"><SessionFrameLeading.Provider value={opener}>{thread}</SessionFrameLeading.Provider></div>
  </div>;
}
