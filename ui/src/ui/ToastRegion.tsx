import { TOAST_REGION_MARK } from "./Toast";
import "./ToastRegion.css";

/**
 * Organism: the one place on the page where toasts appear, at the window's
 * top end, under the header, above the sheet and the thread. Mount it once,
 * at the entry. It holds nothing of its own: each `Toast` moves itself in.
 * New toasts stack under the older ones.
 */
export function ToastRegion({ label = "Notifications" }: { label?: string }) {
  return <section className="toast-region" aria-label={label} {...TOAST_REGION_MARK} />;
}
