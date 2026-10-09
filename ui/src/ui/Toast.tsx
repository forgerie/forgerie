import { ChevronDownIcon, ChevronUpIcon, CircleAlertIcon, XIcon } from "lucide-react";
import { useEffect, useEffectEvent, useId, useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./Toast.css";

/** Marks the one element that every `Toast` moves into. `ToastRegion` carries it. */
export const TOAST_REGION_MARK = { "data-toast-region": "" } as const;

export interface ToastAction { label: string; onPress: () => void }

/**
 * Molecule: a short message that does not stop the reader. The message takes
 * the full width, with dismiss in its corner. A footer row holds the detail on
 * the left and the one action on the right.
 *
 * The detail shows as its own first words, faded. When it is longer than its
 * line, it ends in "…" and a chevron, and a tap opens the whole text. A detail
 * that fits shows in full and opens nothing. So write a detail with the useful
 * words first. The alert tone marks a failure with a mark beside the message.
 *
 * It always shows in the page's `ToastRegion`, wherever it is rendered. With
 * no region on the page (a test, a part), it shows in place.
 */
export function Toast({ tone = "plain", message, detail, action, onDismiss, dismissLabel = "Dismiss", lessLabel = "Less", durationMs, timerKey = message }: {
  tone?: "plain" | "alert";
  /** The title. Keep the one fact that matters here, so a closed detail hides nothing the reader must act on. */
  message: ReactNode;
  /** More about the message, useful words first. */
  detail?: ReactNode;
  action?: ToastAction | undefined;
  onDismiss?: (() => void) | undefined;
  dismissLabel?: string;
  /** Closes an open detail. */
  lessLabel?: string;
  /** Persistent unless the caller supplies a reading interval. Hover and focus pause it. */
  durationMs?: number;
  /** A new notice can restart the interval even when its words repeat. */
  timerKey?: unknown;
}) {
  // undefined until looked up; null when the page has no region.
  const [region, setRegion] = useState<Element | null>();
  const [open, setOpen] = useState(false);
  // Whether the closed detail is longer than its line. Measured, so it follows the toast's width.
  const [cut, setCut] = useState(false);
  const [preview, setPreview] = useState<HTMLElement | null>(null);
  const detailId = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const dismiss = useEffectEvent(() => onDismiss?.());
  useEffect(() => {
    if (durationMs === undefined || hovered || focused) return;
    const timer = setTimeout(() => dismiss(), durationMs);
    return () => clearTimeout(timer);
  }, [durationMs, timerKey, hovered, focused]);
  useLayoutEffect(() => { setRegion(document.querySelector("[data-toast-region]")); }, []);
  useLayoutEffect(() => {
    if (!preview) return;
    const measure = () => setCut(preview.scrollWidth > preview.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(preview);
    return () => observer.disconnect();
  }, [preview, detail]);
  if (region === undefined) return null;
  const hasDetail = detail !== undefined && detail !== null && detail !== "";
  const closed = <span ref={setPreview} className="toast-preview-text">{detail}</span>;
  const disclosure = !hasDetail ? null
    : open ? <button type="button" className="toast-more" aria-expanded aria-controls={detailId} onClick={() => setOpen(false)}>
      {lessLabel}<ChevronUpIcon aria-hidden /></button>
    : cut ? <button type="button" className="toast-more" aria-expanded={false} aria-controls={detailId} onClick={() => setOpen(true)}>
      {closed}<ChevronDownIcon aria-hidden /></button>
    : <p className="toast-preview">{closed}</p>;
  const card = <div className="toast" data-tone={tone} role={tone === "alert" ? "alert" : "status"}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
    {tone === "alert" ? <span className="toast-mark" aria-hidden><CircleAlertIcon /></span> : null}
    <p className="toast-message" tabIndex={durationMs === undefined ? undefined : 0}>{message}</p>
    {onDismiss ? <button type="button" className="toast-dismiss" aria-label={dismissLabel} title={dismissLabel} onClick={onDismiss}><XIcon aria-hidden /></button> : null}
    {hasDetail ? <p id={detailId} className="toast-detail" hidden={!open}>{detail}</p> : null}
    {disclosure || action ? <div className="toast-foot">
      {disclosure}
      {action ? <button type="button" className="toast-action" onClick={action.onPress}>{action.label}</button> : null}
    </div> : null}
  </div>;
  return region ? createPortal(card, region) : card;
}
