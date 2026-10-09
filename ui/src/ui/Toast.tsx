import { XIcon } from "lucide-react";
import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./Toast.css";

/** Marks the one element that every `Toast` moves into. `ToastRegion` carries it. */
export const TOAST_REGION_MARK = { "data-toast-region": "" } as const;

export interface ToastAction { label: string; onPress: () => void }

/**
 * Molecule: a short message that does not stop the reader, with at most one
 * action and a dismiss button. A detail line, such as a reason, takes its own
 * full-width line under them. The alert tone marks a failure.
 *
 * It always shows in the page's `ToastRegion`, wherever it is rendered. With
 * no region on the page (a test, a part), it shows in place.
 */
export function Toast({ tone = "plain", message, detail, action, onDismiss, dismissLabel = "Dismiss" }: {
  tone?: "plain" | "alert";
  message: ReactNode;
  detail?: ReactNode;
  action?: ToastAction | undefined;
  onDismiss?: (() => void) | undefined;
  dismissLabel?: string;
}) {
  // undefined until looked up; null when the page has no region.
  const [region, setRegion] = useState<Element | null>();
  useLayoutEffect(() => { setRegion(document.querySelector("[data-toast-region]")); }, []);
  if (region === undefined) return null;
  const card = <div className="toast" data-tone={tone} role={tone === "alert" ? "alert" : "status"}>
    <p className="toast-message">{message}</p>
    {action ? <button type="button" className="toast-action" onClick={action.onPress}>{action.label}</button> : null}
    {onDismiss ? <button type="button" className="toast-dismiss" aria-label={dismissLabel} title={dismissLabel} onClick={onDismiss}><XIcon aria-hidden /></button> : null}
    {detail ? <p className="toast-detail">{detail}</p> : null}
  </div>;
  return region ? createPortal(card, region) : card;
}
