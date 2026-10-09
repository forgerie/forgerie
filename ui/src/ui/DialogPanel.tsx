import { useId, useLayoutEffect, useRef, type ReactNode } from "react";
import "./DialogPanel.css";
/** A window-level modal; the header remains visible while its collection scrolls. */
export function DialogPanel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    const opener = document.activeElement;
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal?.();
    return () => { if (opener instanceof HTMLElement && opener.isConnected) opener.focus(); };
  }, []);
  // Native showModal promotes the dialog to the window's top layer, even
  // inside a clipped pane. Keeping its DOM here also makes previews measurable.
  return <dialog className="dialog-panel" ref={ref} aria-labelledby={id} onKeyDown={(event) => event.stopPropagation()} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header className="dialog-panel-head"><h2 className="dialog-panel-title" id={id}>{title}</h2><button className="dialog-panel-close" type="button" onClick={onClose}>Close</button></header>
    <div className="dialog-panel-body" role="region" aria-label={`${title} content`} tabIndex={0}>{children}</div>
  </dialog>;
}
