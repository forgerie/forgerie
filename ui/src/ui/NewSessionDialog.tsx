import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CircleAlertIcon, CircleCheckIcon, LoaderIcon, XIcon, ZapIcon } from "lucide-react";
import type { Launch } from "../launches";
import { PortalLayerProvider } from "./portalLayer";

/**
 * System organism: the new-session dialog. A frameless window holding one
 * composer card, with the destination on a tab above it (after Paperclip's
 * new-task dialog). The dialog is the portal layer for the composer's pickers,
 * so they stay usable while everything behind it is inert.
 */
export function NewSessionDialog({ context, card, tray, busy, onClose }: {
  /** The destination row on the tab above the card. */
  context: ReactNode;
  /** The composer, and any notice that belongs to it. */
  card: ReactNode;
  /** Sessions this browser started from here. */
  tray?: ReactNode;
  /** A start is in flight: Escape, the backdrop, and Close wait for it. */
  busy: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const pressedBackdrop = useRef(false);
  // Read before showModal moves focus, so closing returns it where it was.
  const [opener] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
  useLayoutEffect(() => {
    if (dialog && !dialog.open && typeof dialog.showModal === "function") dialog.showModal();
  }, [dialog]);
  useLayoutEffect(() => () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); }, [opener]);
  const close = () => { if (!busy) onClose(); };
  return createPortal(<dialog ref={setDialog} className="ns-dialog" aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); close(); }}
    // The browser can still close it (a second Escape). While a start runs, its outcome must be seen.
    onClose={() => { if (busy) dialog?.showModal(); else onClose(); }}
    onPointerDown={(event) => { pressedBackdrop.current = event.target === event.currentTarget; }}
    onClick={(event) => {
      if (pressedBackdrop.current && event.target === event.currentTarget) close();
      pressedBackdrop.current = false;
    }}>
    <PortalLayerProvider value={dialog}>
      <div className="ns-stack">
        <h2 id={titleId} className="sr-only">New session</h2>
        <div className="ns-context" role="group" aria-label="Where the session starts">
          {context}
          <button type="button" className="icon-button quiet-button ns-close" aria-label="Close new session" title="Close"
            disabled={busy} onClick={close}><XIcon aria-hidden size={16} /></button>
        </div>
        <div className="ns-card">{card}</div>
        {tray}
      </div>
    </PortalLayerProvider>
  </dialog>, document.body);
}

/**
 * Rapidfire, after the legacy client: Send starts the session in the
 * background and keeps the dialog open for the next one. Off: Send opens it.
 */
export function RapidfireToggle({ on, disabled, onToggle }: { on: boolean; disabled: boolean; onToggle: () => void }) {
  return <button type="button" className="ns-mode" aria-pressed={on} disabled={disabled} onClick={onToggle}
    title={on ? "Rapidfire: each Send starts a session and keeps this open" : "Rapidfire: start several sessions without leaving"}>
    <ZapIcon aria-hidden size={14} />Rapidfire</button>;
}

/** The sessions started from this dialog, newest first. Each one says how it went and what you can do next. */
export function LaunchTray<D>({ launches, onOpen, onRestore, onDismiss }: {
  launches: readonly Launch<D>[];
  onOpen: (launch: Launch<D>) => void;
  onRestore: (launch: Launch<D>) => void;
  onDismiss: (launch: Launch<D>) => void;
}) {
  if (launches.length === 0) return null;
  return <section className="ns-tray" aria-label="Sessions started here">
    <ul>{[...launches].reverse().map((launch) => {
      const { state } = launch;
      return <li key={launch.id} className="ns-launch" data-state={state.type}>
        <span className="ns-launch-mark" aria-hidden>
          {state.type === "starting" ? <LoaderIcon size={14} /> : state.type === "started" ? <CircleCheckIcon size={14} /> : <CircleAlertIcon size={14} />}
        </span>
        <span className="ns-launch-text">
          <span className="ns-launch-title">{launch.title}</span>
          <span className="ns-launch-status" role={state.type === "failed" || state.type === "unsent" ? "alert" : "status"}>
            {state.type === "starting" ? state.progress ?? "Starting…" : state.type === "started" ? "Started" : state.error}</span>
        </span>
        <span className="ns-launch-actions">
          {(state.type === "started" || state.type === "unsent") && <button type="button" onClick={() => onOpen(launch)}>Open</button>}
          {state.type === "failed" && <button type="button" onClick={() => onRestore(launch)}>Put back</button>}
          {state.type !== "starting" && <button type="button" className="icon-button quiet-button" aria-label={`Dismiss ${launch.title}`}
            onClick={() => onDismiss(launch)}><XIcon aria-hidden size={14} /></button>}
        </span>
      </li>;
    })}</ul>
  </section>;
}
