import { useEffect, useId, useRef, type ReactNode } from "react";
import { ArrowLeftIcon, XIcon } from "lucide-react";
import "./SheetDialog.css";

export interface SheetAction { label: string; onPress: () => void; disabled?: boolean | undefined }

/**
 * Organism: a modal sheet over the page. It is a card while the window has
 * room around it; as the room runs out, each axis gives up its own margin and
 * the card meets that edge, so no width or height flips the layout. A header
 * holds an optional back control, the title, a subtitle, text actions, and
 * close. The body scrolls on its own; the footer stays in view. On open, the
 * sheet itself takes focus, so no control wears a focus ring until the reader
 * moves to it.
 */
export function SheetDialog({ title, subtitle, onClose, closeLabel, back, actions = [], footer, children }: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  /** Accessible name of the close control. */
  closeLabel: string;
  /** A step back inside the sheet, such as from one item to the list. */
  back?: { label: string; onPress: () => void } | undefined;
  /** Text actions in the header, before close. */
  actions?: readonly SheetAction[];
  footer?: ReactNode;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) {
      if (typeof node.showModal === "function") node.showModal();
      else node.setAttribute("open", "");
    }
    frame.current?.focus({ preventScroll: true });
  }, []);
  // A modal dialog draws in the top layer wherever it sits, so it needs no portal.
  return <dialog ref={dialog} className="sheet-dialog" aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div ref={frame} className="sheet-dialog-frame" tabIndex={-1}>
      <header className="sheet-dialog-head">
        {back && <button type="button" className="sheet-dialog-control" aria-label={back.label} title={back.label} onClick={back.onPress}>
          <ArrowLeftIcon aria-hidden /></button>}
        <div className="sheet-dialog-titles">
          <h2 id={titleId} className="sheet-dialog-title">{title}</h2>
          {subtitle !== undefined && <span className="sheet-dialog-subtitle">{subtitle}</span>}
        </div>
        {actions.map((action) => <button key={action.label} type="button" className="sheet-dialog-action" disabled={action.disabled}
          onClick={action.onPress}>{action.label}</button>)}
        <button type="button" className="sheet-dialog-control" aria-label={closeLabel} title={closeLabel} onClick={onClose}>
          <XIcon aria-hidden /></button>
      </header>
      <div className="sheet-dialog-body">{children}</div>
      {footer !== undefined && <footer className="sheet-dialog-foot">{footer}</footer>}
    </div>
  </dialog>;
}
