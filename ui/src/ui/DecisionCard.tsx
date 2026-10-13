import { useLayoutEffect, useRef, type ReactNode } from "react";
import { CircleAlertIcon, ExternalLinkIcon } from "lucide-react";
import { scrollParent } from "./scrollParent";
import "./DecisionCard.css";

/**
 * Molecule: something in a thread that waits on the reader's decision. It is
 * not a box: a rule on its start edge marks it, live while open, and its
 * title is set in the live ink. Its footer holds the choices. A choice that failed says why above them; the
 * reason grows the card upward, so the choices stay where the reader pressed
 * them. Once decided it goes quiet and says what was decided in one line,
 * where the choices stood; that line can open what the decision made.
 *
 * A card whose decision is made elsewhere, such as in a sheet it opens, has
 * one `action` instead. It sits under the footer while the container has
 * room. In a short container (under 30rem tall, as a phone on its side) the
 * card compacts: the action moves to the end of the title line and the body
 * and footer yield, so the action is in view without a scroll.
 */
export function DecisionCard({ title, meta, open, closed, closedHref, problem, focusClosed = false, children, footer, action }: {
  title: string;
  /** A short fact about the subject, such as the file it concerns: at the end of the title line, or under the title when they do not fit together. */
  meta?: ReactNode;
  open: boolean;
  /** What was decided, shown once the card is closed. */
  closed?: string | undefined;
  /** Where the closed line leads, such as the thing the decision made. It opens in a new tab. */
  closedHref?: string | undefined;
  /** Why the last choice failed, shown above the choices while the card is open. */
  problem?: string | undefined;
  /**
   * Set when the reader's own choice closes the card: focus moves to the closed
   * line, since the button they pressed is gone. Leave it unset for a card that
   * closes from elsewhere, so a background update never moves focus.
   */
  focusClosed?: boolean;
  children?: ReactNode;
  /** The choices, shown while the card is open. */
  footer?: ReactNode;
  /** The card's one action while open, which opens where the decision is made. It stays in view in a short container. */
  action?: { label: string; onPress: () => void } | undefined;
}) {
  const card = useRef<HTMLElement>(null);
  const choices = useRef<HTMLDivElement>(null);
  /** Where the choices sat in the card at the last layout. In the card, so scrolling does not change it. */
  const choicesAt = useRef<number | undefined>(undefined);
  const closedLine = useRef<HTMLElement | null>(null);
  const holdClosed = (element: HTMLElement | null) => { closedLine.current = element; };
  const wasOpen = useRef(open);
  useLayoutEffect(() => {
    if (wasOpen.current && !open && focusClosed) closedLine.current?.focus();
    wasOpen.current = open;
  }, [open, focusClosed]);
  const shown = open ? problem : undefined;
  useLayoutEffect(() => {
    const frame = card.current;
    const element = choices.current;
    if (frame === null || element === null) { choicesAt.current = undefined; return; }
    const at = () => element.getBoundingClientRect().top - frame.getBoundingClientRect().top;
    const before = choicesAt.current;
    const now = at();
    choicesAt.current = now;
    const scroller = before !== undefined && Math.abs(now - before) >= 1 ? scrollParent(frame) : undefined;
    if (scroller !== undefined && before !== undefined) {
      const rest = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      // A shrink at the end is already absorbed: the browser pulls the scroll back with the content.
      if (now > before || rest() > 1) scroller.scrollBy({ top: now - before });
      // Close to the end, as the last row of a thread is: show the end, so the choices clear what floats over it.
      const left = rest();
      if (left > 1 && left < element.offsetHeight) scroller.scrollBy({ top: left });
    }
    // Other growth above the choices (an excerpt that opens) keeps its own place; only remember where the choices are.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => { choicesAt.current = at(); });
    observer.observe(frame);
    return () => { observer.disconnect(); };
  }, [shown]);
  return <section className="decision-card" ref={card} data-open={open || undefined} aria-label={title}>
    <header className="decision-card-head">
      <span className="decision-card-title">{title}</span>
      {meta !== undefined && <span className="decision-card-meta">{meta}</span>}
    </header>
    {children !== undefined && <div className="decision-card-body">{children}</div>}
    {shown !== undefined && <p className="decision-card-problem" role="alert">
      <CircleAlertIcon className="decision-card-problem-mark" aria-hidden />{shown}
    </p>}
    {open ? footer !== undefined && footer !== null && footer !== false && <div className="decision-card-foot" ref={choices}>{footer}</div>
      : closed !== undefined && <p className="decision-card-closed" ref={closedHref === undefined ? holdClosed : undefined}
        tabIndex={closedHref === undefined && focusClosed ? -1 : undefined}>
        {closedHref === undefined ? closed : <a className="decision-card-link" ref={holdClosed} href={closedHref} target="_blank" rel="noreferrer">
          {closed}<ExternalLinkIcon className="decision-card-link-mark" aria-hidden />
        </a>}
      </p>}
    {open && action !== undefined && <button type="button" className="decision-card-action" onClick={action.onPress}>{action.label}</button>}
  </section>;
}
