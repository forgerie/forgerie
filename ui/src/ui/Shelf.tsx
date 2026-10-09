import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ChevronDownIcon } from "lucide-react";
import "./Shelf.css";

export interface ShelfMessage {
  text: string;
  /** A failure, announced at once. Otherwise a quiet status. */
  alert?: boolean;
  action?: { label: string; onPress: () => void } | undefined;
}

/** Calls `onRoom` with the height of the element the shelf sits in, now and whenever it changes. */
function useRoom(ref: RefObject<HTMLElement | null>, onRoom: ((height: number) => void) | undefined) {
  useEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent || !onRoom) return;
    onRoom(parent.clientHeight);
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(() => onRoom(parent.clientHeight));
    observer.observe(parent);
    return () => observer.disconnect();
  }, [ref, onRoom]);
}

/** Whether a scroller has more below its fold: checked on scroll, on resize, and after every render, which is when its content changes. */
function useMoreBelow(ref: RefObject<HTMLElement | null>): boolean {
  const [more, setMore] = useState(false);
  const check = useCallback(() => {
    const node = ref.current;
    if (node) setMore(node.scrollHeight - node.scrollTop - node.clientHeight > 1);
  }, [ref]);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.addEventListener("scroll", check, { passive: true });
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(check) : undefined;
    observer?.observe(node);
    return () => { node.removeEventListener("scroll", check); observer?.disconnect(); };
  }, [ref, check]);
  useEffect(check);
  return more;
}

/**
 * System organism: a section at the foot of a list. A group header (chevron,
 * title, a rule to the edge, an optional status) switches it between its two
 * forms; the body scrolls on its own and fades its last line while there is
 * more below. It takes at most half of the element it sits in, and reports
 * that element's height so its owner can choose what fits.
 */
export function Shelf({ title, label, open, onToggle, toggleHint, status, statusHint, message, onRoom, children }: {
  title: string;
  /** The section's accessible name. */
  label: string;
  open: boolean;
  onToggle: () => void;
  /** What pressing the header does, for hover. */
  toggleHint: string;
  status?: string | undefined;
  statusHint?: string | undefined;
  /** Said instead of the body, such as while loading or after a failure. */
  message?: ShelfMessage | undefined;
  onRoom?: ((height: number) => void) | undefined;
  children?: ReactNode;
}) {
  const section = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useRoom(section, onRoom);
  const more = useMoreBelow(body);
  return <section ref={section} className="shelf" aria-label={label}>
    <button type="button" className="shelf-header" aria-expanded={open} onClick={onToggle} title={toggleHint}>
      <ChevronDownIcon className="shelf-chevron" aria-hidden /><span>{title}</span><span className="shelf-rule" aria-hidden="true" />
      {status ? <span className="shelf-status" title={statusHint}>{status}</span> : null}
    </button>
    <div ref={body} className="shelf-body" data-more={more || undefined}>
      {message ? <p className="shelf-message" role={message.alert ? "alert" : "status"}>{message.text}
        {message.action ? <button type="button" onClick={message.action.onPress}>{message.action.label}</button> : null}</p> : children}
    </div>
  </section>;
}
