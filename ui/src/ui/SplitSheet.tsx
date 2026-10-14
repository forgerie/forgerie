import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowLeftIcon, XIcon } from "lucide-react";
import { PortalLayerProvider } from "./portalLayer";
import "./SplitSheet.css";

/**
 * Organism: a modal sheet with a document and a rail beside it. The sheet's own size picks the layout, so a narrow
 * window and a narrow pane read the same:
 * - 50rem wide or more: two panes. The document on the start side, at a reading measure; the rail on the end side,
 *   with the foot under it.
 * - Narrower: one column that scrolls as one. The lead first, then the document and the rail in the order the host
 *   asks for, and the foot pinned at the bottom.
 * The foot is in view at every size. With `detail`, the document pane holds a view that scrolls on its own, such as a
 * record and a box to reply; in one column it takes the rail's place. Pickers opened inside mount in the dialog, so
 * the modal does not make them inert.
 */
export function SplitSheet({ title, subtitle, closeLabel, onClose, back, lead, document, documentLabel, busy = false, detail = false, railFirst = false,
  rail, railLabel, foot }: {
  title: string;
  subtitle?: ReactNode;
  closeLabel: string;
  onClose: () => void;
  /** A step back to where the sheet was opened from. */
  back?: { label: string; onPress: () => void } | undefined;
  /** What the reader must see first, such as a decision that waits: above the document, and in one column above everything. */
  lead?: ReactNode;
  document: ReactNode;
  documentLabel: string;
  /** The document is still on its way. */
  busy?: boolean;
  detail?: boolean;
  /** In one column, the rail comes before the document. */
  railFirst?: boolean;
  rail: ReactNode;
  railLabel: string;
  foot: ReactNode;
}) {
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (dialog === null) return;
    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    // As SheetDialog does: the sheet takes focus, so no control wears a ring until the reader moves.
    frame.current?.focus({ preventScroll: true });
  }, [dialog]);
  const hasLead = lead !== undefined && lead !== null && lead !== false;
  return <dialog ref={setDialog} className="split-sheet" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <PortalLayerProvider value={dialog}>
      <div ref={frame} className="split-sheet-frame" tabIndex={-1}>
        <div className="split-sheet-grid" data-detail={detail || undefined} data-rail-first={railFirst || undefined}>
          <header className="split-sheet-head">
            {back !== undefined && <button type="button" className="split-sheet-control" aria-label={back.label} title={back.label} onClick={back.onPress}>
              <ArrowLeftIcon aria-hidden /></button>}
            <div className="split-sheet-titles">
              <h2 id={titleId} className="split-sheet-title" title={title}>{title}</h2>
              {subtitle !== undefined && <p className="split-sheet-subtitle">{subtitle}</p>}
            </div>
            <button type="button" className="split-sheet-control" aria-label={closeLabel} title={closeLabel} onClick={onClose}><XIcon aria-hidden /></button>
          </header>
          <div className="split-sheet-body">
            <div className="split-sheet-main">
              {hasLead && <div className="split-sheet-lead">{lead}</div>}
              <article className="split-sheet-document" aria-label={documentLabel} aria-busy={busy || undefined}>{document}</article>
            </div>
            <aside className="split-sheet-rail" aria-label={railLabel}>{rail}</aside>
          </div>
          <footer className="split-sheet-foot">{foot}</footer>
        </div>
      </div>
    </PortalLayerProvider>
  </dialog>;
}
