import { useId, useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** System organism: a destructive decision at window level, with native focus containment and return. */
export function ConfirmDialog({ title, children, confirmLabel, onConfirm, onCancel }: {
  title: string; children: ReactNode; confirmLabel: string; onConfirm: () => void; onCancel: () => void;
}) {
  const titleId = useId();
  const bodyId = useId();
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const [opener] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
  useLayoutEffect(() => { if (dialog && !dialog.open) dialog.showModal?.(); }, [dialog]);
  useLayoutEffect(() => () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); }, [opener]);
  return createPortal(<dialog ref={setDialog} className="confirm-dialog" aria-labelledby={titleId} aria-describedby={bodyId}
    onCancel={(event) => { event.preventDefault(); onCancel(); }}>
    <h2 id={titleId}>{title}</h2>
    <div id={bodyId}>{children}</div>
    <div className="confirm-actions">
      <button type="button" className="plugin-button" autoFocus onClick={onCancel}>Cancel</button>
      <button type="button" className="plugin-button" data-tone="danger" onClick={onConfirm}>{confirmLabel}</button>
    </div>
  </dialog>, document.body);
}
