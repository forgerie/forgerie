import { forwardRef, type HTMLAttributes } from "react";
import "./FloatingPanel.css";

/**
 * Atom: the surface of a window-level panel, such as a picker or a suggestion
 * list. It stacks its children and scrolls inside the height it gets. Its host
 * places it: the host measures the anchor and sets the position. It forwards
 * its ref and props, so a primitive can render through it with `asChild`.
 */
export const FloatingPanel = forwardRef<HTMLDivElement, Omit<HTMLAttributes<HTMLDivElement>, "className" | "style">>(
  function FloatingPanel(props, ref) {
    return <div ref={ref} className="floating-panel" {...props} />;
  });
