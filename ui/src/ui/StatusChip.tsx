import { useEffect, useId, useRef, type ReactNode } from "react";
import { ChevronDownIcon, XIcon } from "lucide-react";
import { useMenu } from "./useMenu";
import "./StatusChip.css";

/**
 * How loud the status reads. `quiet` is the healthy resting state: screen
 * readers still hear it, but nothing is drawn. Every other tone draws a chip
 * with a dot, so the status never reads as one more icon.
 */
export type StatusTone = "quiet" | "neutral" | "live" | "attention" | "warn" | "bad";

export interface StatusChipAction { label: string; onPress: () => void }
export interface StatusChipPanel {
  title: string;
  /** Quiet text actions in the panel's head, before close. */
  actions?: readonly StatusChipAction[];
  children: ReactNode;
}

/**
 * Molecule: a header's one status word, as a chip. With a panel, the chip is
 * a button with a chevron, and the panel opens under the header at the
 * window's end: the long story lives there, never above the page's content.
 * A count rides along for things that wait in the panel. A new `ring` value
 * rings the chip twice, the one motion that asks for a look.
 */
export function StatusChip({ label, tone, count = 0, countLabel, ring, panel }: {
  label: string;
  tone: StatusTone;
  count?: number;
  /** The count in words, such as "2 problems". Read with the label. */
  countLabel?: string | undefined;
  /** Changes when something new arrives that the reader should look at. */
  ring?: number | undefined;
  panel?: StatusChipPanel | undefined;
}) {
  const { open, setOpen, anchor } = useMenu();
  const face = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const titleId = useId();
  const hasPanel = panel !== undefined;
  // Nothing left to show closes the panel; the next panel starts closed.
  useEffect(() => { if (!hasPanel) setOpen(false); }, [hasPanel, setOpen]);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) { wasOpen.current = true; sheet.current?.focus({ preventScroll: true }); return; }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    // The panel took focus with it when it closed. A press elsewhere keeps focus where it landed.
    const focused = document.activeElement;
    if (!focused || focused === document.body || anchor.current?.contains(focused)) face.current?.focus({ preventScroll: true });
  }, [open, anchor]);
  const spoken = count > 0 && countLabel ? `${label}, ${countLabel}` : label;
  const drawn = tone !== "quiet" || hasPanel;
  const inner = <>
    <span className="status-chip-dot" />
    <span className="status-chip-label">{label}</span>
    {count > 0 && <span className="status-chip-count">{count}</span>}
    {ring ? <span key={ring} className="status-chip-ring" /> : null}
  </>;
  return <div className="status-chip" data-tone={tone} data-drawn={drawn || undefined} ref={anchor}>
    {/* The live region stays mounted while quiet, so the next change is announced. */}
    <span className="status-chip-live" role="status">{spoken}</span>
    {drawn && (hasPanel
      ? <button ref={face} type="button" className="status-chip-face" aria-haspopup="dialog" aria-expanded={open}
        aria-label={`${spoken}. Show details`} onClick={() => setOpen(!open)}>
        {inner}<ChevronDownIcon className="status-chip-chevron" aria-hidden size={12} />
      </button>
      : <span className="status-chip-face" aria-hidden="true">{inner}</span>)}
    {open && panel && <>
      <div className="status-chip-scrim" aria-hidden="true" onClick={() => setOpen(false)} />
      <section ref={sheet} className="status-chip-panel" role="dialog" aria-labelledby={titleId} tabIndex={-1}>
        <header className="status-chip-head">
          <h2 id={titleId} className="status-chip-title">{panel.title}</h2>
          {panel.actions?.map((action) => <button key={action.label} type="button" className="status-chip-action"
            onClick={action.onPress}>{action.label}</button>)}
          <button type="button" className="status-chip-close" aria-label="Close" title="Close" onClick={() => setOpen(false)}>
            <XIcon aria-hidden size={16} />
          </button>
        </header>
        <div className="status-chip-body">{panel.children}</div>
      </section>
    </>}
  </div>;
}
