import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * System organism: a destructive decision at window level. It is the Land and
 * Discard window's card, so every confirmation in Forgerie looks the same.
 * Cancel holds focus first; Escape and a press outside the card cancel.
 * `plain` is for a decision that cannot be undone but loses nothing.
 * `busy` holds the card while the decision is carried out: the confirm button
 * says `busyLabel` and takes no second press. `held` disables it when the
 * decision cannot be made now; the body says why.
 */
export function ConfirmDialog({ title, icon, children, confirmLabel, busyLabel, tone = "danger", busy = false, held = false, onConfirm, onCancel }: {
  title: string; icon?: ReactNode; children: ReactNode; confirmLabel: string; busyLabel?: string; tone?: "danger" | "plain";
  busy?: boolean; held?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  const titleId = useId();
  const bodyId = useId();
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [opener] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
  // showModal moves focus to the first focusable element, and a body that scrolls is one. Cancel takes it back.
  useLayoutEffect(() => {
    if (dialog && !dialog.open) dialog.showModal?.();
    cancel.current?.focus({ preventScroll: true });
  }, [dialog]);
  useLayoutEffect(() => () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); }, [opener]);
  return createPortal(<dialog ref={setDialog} className="wt-dialog" aria-labelledby={titleId} aria-describedby={bodyId}
    onCancel={(event) => { event.preventDefault(); onCancel(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <div className="wt-card" aria-busy={busy || undefined}>
      <header className="wt-head">
        {icon ? <span className="wt-mark" aria-hidden>{icon}</span> : null}
        <h2 id={titleId}>{title}</h2>
      </header>
      <div className="wt-body" id={bodyId}>{children}</div>
      <footer className="wt-foot">
        <button ref={cancel} type="button" className="wt-secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary wt-primary" data-tone={tone === "danger" ? "danger" : undefined} disabled={busy || held}
          onClick={onConfirm}>{busy ? busyLabel ?? confirmLabel : confirmLabel}</button>
      </footer>
    </div>
  </dialog>, document.body);
}
