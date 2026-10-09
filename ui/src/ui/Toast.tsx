import { ChevronDownIcon, XIcon } from "lucide-react";
import { useId, useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./Toast.css";

/** Marks the one element that every `Toast` moves into. `ToastRegion` carries it. */
export const TOAST_REGION_MARK = { "data-toast-region": "" } as const;

export interface ToastAction { label: string; onPress: () => void }

/**
 * Molecule: a short message that does not stop the reader, with at most one
 * action and a dismiss button. A detail, such as a reason, starts closed: a
 * chevron after the message opens it on its own full-width line, so the toast
 * stays one line until the reader asks for more. The alert tone marks a failure.
 *
 * It always shows in the page's `ToastRegion`, wherever it is rendered. With
 * no region on the page (a test, a part), it shows in place.
 */
export function Toast({ tone = "plain", message, detail, action, onDismiss, dismissLabel = "Dismiss" }: {
  tone?: "plain" | "alert";
  /** The title. Keep the one fact that matters here, so a closed detail hides nothing the reader must act on. */
  message: ReactNode;
  /** More about the message, shown on request. */
  detail?: ReactNode;
  action?: ToastAction | undefined;
  onDismiss?: (() => void) | undefined;
  dismissLabel?: string;
}) {
  // undefined until looked up; null when the page has no region.
  const [region, setRegion] = useState<Element | null>();
  const [open, setOpen] = useState(false);
  const detailId = useId();
  useLayoutEffect(() => { setRegion(document.querySelector("[data-toast-region]")); }, []);
  if (region === undefined) return null;
  const card = <div className="toast" data-tone={tone} role={tone === "alert" ? "alert" : "status"}>
    <p className="toast-message">{message}</p>
    {detail ? <button type="button" className="toast-more" aria-expanded={open} aria-controls={detailId}
      aria-label={open ? "Hide details" : "Show details"} title={open ? "Hide details" : "Show details"}
      onClick={() => setOpen(!open)}><ChevronDownIcon aria-hidden /></button> : null}
    {action ? <button type="button" className="toast-action" onClick={action.onPress}>{action.label}</button> : null}
    {onDismiss ? <button type="button" className="toast-dismiss" aria-label={dismissLabel} title={dismissLabel} onClick={onDismiss}><XIcon aria-hidden /></button> : null}
    {detail ? <p id={detailId} className="toast-detail" hidden={!open}>{detail}</p> : null}
  </div>;
  return region ? createPortal(card, region) : card;
}
