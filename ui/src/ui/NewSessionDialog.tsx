import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ComposerPrimitive, unstable_useTriggerPopoverRootContext } from "@assistant-ui/react";
import { AnvilIcon, ChevronRightIcon, CircleAlertIcon, CircleCheckIcon, LoaderIcon, PaperclipIcon, XIcon, ZapIcon } from "lucide-react";
import type { Launch } from "../launches";
import type { MentionSource } from "../mentionSource";
import { MAX_ATTACHMENTS } from "../attachments";
import { PortalLayerProvider } from "./portalLayer";
import { AttachmentErrors, ComposerAttachments } from "./Attachments";
import { ComposerDictation } from "./ComposerDictation";
import { MentionPopover, type MentionInputSnapshot } from "./MentionPopover";
import { ModelPicker, type ModelBinding, type PickerOpen } from "./ModelPicker";
import { SlashCommands, type CommandBinding } from "./SlashCommands";

export type StartPhase = { type: "ready" } | { type: "starting"; progress: string } | { type: "failed"; message: string };

/**
 * System organism: the new-session window, after Paperclip's new-task dialog.
 * A titled window with sections: the header names it, a sentence says where
 * and with what the session starts, the writing area takes the room, a row of
 * labelled chips holds what the first message carries, and the footer holds
 * the decision. It is the portal layer for its pickers, so they stay usable
 * while everything behind it is inert.
 */
export function NewSessionDialog({ destination, model, mentions, commands, rapidfire, phase, tray, onRapidfire, onDiscard, onClose }: {
  /** The destination chip and its picker. */
  destination: ReactNode;
  model: ModelBinding;
  mentions: MentionSource;
  commands: CommandBinding;
  rapidfire: boolean;
  phase: StartPhase;
  /** Sessions started from here in Rapidfire. */
  tray?: ReactNode;
  onRapidfire: () => void;
  onDiscard: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const pressedBackdrop = useRef(false);
  const busy = phase.type === "starting";
  // Read before showModal moves focus, so closing returns it where it was.
  const [opener] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
  useLayoutEffect(() => {
    if (dialog && !dialog.open && typeof dialog.showModal === "function") dialog.showModal();
  }, [dialog]);
  useLayoutEffect(() => () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); }, [opener]);
  const close = () => { if (!busy) onClose(); };
  return createPortal(<dialog ref={setDialog} className="ns-dialog" aria-labelledby={titleId}
    // Nested dialogs (the image viewer) send their own cancel and close events up through React. Only ours count.
    onCancel={(event) => { if (event.target !== event.currentTarget) return; event.preventDefault(); close(); }}
    // The browser can still close it (a second Escape). While a start runs, its outcome must be seen.
    onClose={(event) => { if (event.target !== event.currentTarget) return; if (busy) dialog?.showModal(); else onClose(); }}
    onPointerDown={(event) => { pressedBackdrop.current = event.target === event.currentTarget; }}
    onClick={(event) => {
      if (pressedBackdrop.current && event.target === event.currentTarget) close();
      pressedBackdrop.current = false;
    }}>
    <PortalLayerProvider value={dialog}>
      <ComposerPrimitive.Unstable_TriggerPopoverRoot>
        <Window titleId={titleId} destination={destination} model={model} mentions={mentions} commands={commands}
          rapidfire={rapidfire} phase={phase} tray={tray} onRapidfire={onRapidfire} onDiscard={onDiscard} onClose={close} />
      </ComposerPrimitive.Unstable_TriggerPopoverRoot>
    </PortalLayerProvider>
  </dialog>, document.body);
}

function Window({ titleId, destination, model, mentions, commands, rapidfire, phase, tray, onRapidfire, onDiscard, onClose }: {
  titleId: string; destination: ReactNode; model: ModelBinding; mentions: MentionSource; commands: CommandBinding;
  rapidfire: boolean; phase: StartPhase; tray?: ReactNode; onRapidfire: () => void; onDiscard: () => void; onClose: () => void;
}) {
  const [picker, setPicker] = useState<PickerOpen>();
  const context = useRef<HTMLDivElement>(null);
  const chips = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const snapshot = useRef<MentionInputSnapshot>(null);
  const triggers = unstable_useTriggerPopoverRootContext();
  const busy = phase.type === "starting";
  const remember = () => { if (input.current) snapshot.current = { text: input.current.value, cursor: input.current.selectionStart }; };
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    remember();
    // An open suggestion list takes Enter and Escape first.
    for (const trigger of triggers.getTriggers().values()) {
      if (trigger.resource.handleKeyDown(event)) return;
    }
  }
  const startLabel = busy ? "Starting…" : rapidfire ? "Start in background" : "Start session";
  return <ComposerPrimitive.Root className="ns-window composer">
    <header className="ns-head">
      <span className="ns-crumb">
        <span className="ns-badge" aria-hidden><AnvilIcon size={14} /></span>
        <ChevronRightIcon aria-hidden size={14} className="ns-crumb-sep" />
        <h2 id={titleId}>New session</h2>
      </span>
      <button type="button" className="icon-button quiet-button ns-close" aria-label="Close new session" title="Close"
        disabled={busy} onClick={onClose}><XIcon aria-hidden size={18} /></button>
    </header>
    {/* Between the pinned header and the decision. With height to spare only the writing
        area grows; in a short window (a keyboard, folded landscape) this scrolls as one. */}
    <div className="ns-scroll">
    <div ref={context} className="ns-context" role="group" aria-label="Where and how the session starts">
      {destination}
      {/* "with" travels with its chip, so a wrap never leaves it alone at a line end. */}
      <span className="ns-with">with<ModelPicker binding={model} anchor={context} open={picker} onOpenChange={setPicker} /></span>
    </div>
    <ComposerPrimitive.AttachmentDropzone className="ns-body" disabled={busy}>
      <ComposerAttachments />
      <AttachmentErrors />
      <ComposerPrimitive.Input ref={input} aria-label="First message" rows={4} className="ns-input"
        placeholder="Describe what the agent should do first…" submitMode="ctrlEnter" cancelOnEscape={false}
        onKeyDown={onKeyDown} onChange={remember} onSelect={remember} />
    </ComposerPrimitive.AttachmentDropzone>
    {tray}
    <div ref={chips} className="ns-chips" role="group" aria-label="What the first message carries">
      <ComposerPrimitive.AddAttachment className="ns-chip" multiple disabled={busy} title={`Attach up to ${MAX_ATTACHMENTS} files`}>
        <PaperclipIcon aria-hidden size={14} />Attach</ComposerPrimitive.AddAttachment>
      <button type="button" className="ns-chip" aria-pressed={rapidfire} disabled={busy} onClick={onRapidfire}
        title={rapidfire ? "Rapidfire: each start runs in the background and this stays open" : "Rapidfire: start several sessions without leaving"}>
        <ZapIcon aria-hidden size={14} />Rapidfire</button>
      <ComposerDictation disabled={busy} />
    </div>
    {phase.type === "starting" && <p className="ns-status" role="status">{phase.progress}</p>}
    {phase.type === "failed" && <p className="ns-error" role="alert">{phase.message}</p>}
    </div>
    <footer className="ns-foot">
      <button type="button" className="ns-discard" disabled={busy} onClick={onDiscard}>Discard draft</button>
      <ComposerPrimitive.Send className="ns-start primary" aria-keyshortcuts="Control+Enter Meta+Enter"
        title={`${startLabel} (Ctrl+Enter)`}>{startLabel}</ComposerPrimitive.Send>
    </footer>
    <SlashCommands binding={commands} anchor={chips} />
    {(["@", "!@", "#"] as const).map((char) => <MentionPopover key={`${mentions.key}:${char}`}
      source={mentions} char={char} input={input} snapshot={snapshot} enabled={!busy} />)}
  </ComposerPrimitive.Root>;
}

/** The sessions started from this window, newest first. Each one says how it went and what you can do next. */
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
