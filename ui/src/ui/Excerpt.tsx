import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";
import { scrollParent } from "./scrollParent";
import "./Excerpt.css";

/**
 * Molecule: long content cut to its first few lines, fading out where it is
 * cut, with a toggle to read the rest. The toggle shows only when the content
 * is longer than the cut. Opened, the content scrolls inside a share of the
 * pane, and the toggle stays where the reader pressed it: the content grows
 * upward, so whatever follows the excerpt, such as a card's choices, never
 * moves out of view.
 */
export function Excerpt({ label, children, moreLabel = "Show more", lessLabel = "Show less", lines }: {
  /** The content's accessible name, used for the opened region. */
  label: string;
  /** Lines shown before the toggle. Absent: the stylesheet's default. A short pane still shows fewer. */
  lines?: number | undefined;
  children: ReactNode;
  moreLabel?: string;
  lessLabel?: string;
}) {
  const [opened, setOpened] = useState(false);
  const [cut, setCut] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  /** Where the toggle stood when pressed, until the new size is laid out. */
  const pressedAt = useRef<number | undefined>(undefined);
  const id = useId();
  useLayoutEffect(() => {
    const frame = box.current;
    const inner = content.current;
    if (opened || frame === null || inner === null) return;
    const measure = () => { setCut(inner.offsetHeight > frame.clientHeight + 1); };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    observer.observe(inner);
    return () => { observer.disconnect(); };
  }, [opened]);
  useLayoutEffect(() => {
    const toggle = toggleRef.current;
    const before = pressedAt.current;
    pressedAt.current = undefined;
    if (toggle === null || before === undefined) return;
    const moved = toggle.getBoundingClientRect().top - before;
    if (Math.abs(moved) >= 1) scrollParent(toggle)?.scrollBy({ top: moved });
  }, [opened]);
  const toggle = opened || cut;
  return <div className="excerpt">
    <div className="excerpt-box" id={id} ref={box} data-cut={!opened && cut ? "" : undefined} data-opened={opened ? "" : undefined}
      role={opened ? "region" : undefined} aria-label={opened ? label : undefined} tabIndex={opened ? 0 : undefined}
      style={{ "--excerpt-lines": lines }}>
      <div ref={content}>{children}</div>
    </div>
    {toggle && <button type="button" className="excerpt-toggle" ref={toggleRef} aria-expanded={opened} aria-controls={id}
      onClick={(event) => { pressedAt.current = event.currentTarget.getBoundingClientRect().top; setOpened(!opened); }}>
      <ChevronDownIcon className="excerpt-toggle-mark" aria-hidden />{opened ? lessLabel : moreLabel}
    </button>}
  </div>;
}
