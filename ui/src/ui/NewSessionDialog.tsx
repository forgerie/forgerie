import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ComposerPrimitive, unstable_useTriggerPopoverRootContext, useAuiState } from "@assistant-ui/react";
import { ChevronRightIcon, XIcon, ZapIcon } from "lucide-react";
import type { MentionSource } from "../mentionSource";
import { MAX_ATTACHMENTS } from "../attachments";
import { PortalLayerProvider } from "./portalLayer";
import { LogoMark } from "./LogoMark";
import { AttachButton, AttachmentErrors, ComposerAttachments } from "./Attachments";
import { ComposerDictation } from "./ComposerDictation";
import { MentionPopover, type MentionInputSnapshot } from "./MentionPopover";
import { ModelPicker, type ModelBinding, type PickerOpen } from "./ModelPicker";
import { SlashCommands, type CommandBinding } from "./SlashCommands";
import { useComposerKeyboard } from "./useComposerKeyboard";
import { ComposerEditor, type ComposerInputElement } from "./ComposerEditor";

/** `progress` names the step under way. Without one, the start button's "Starting…" says it all. */
export type StartPhase = { type: "ready" } | { type: "starting"; progress?: string | undefined } | { type: "failed"; message: string };

/**
 * System organism: the new-session window, after Paperclip's new-task dialog.
 * A titled window with sections: the header names it, a sentence says where
 * and with what the session starts, the writing area takes the room, a row of
 * labelled chips holds what the first message carries, and the footer holds
 * the decision. It is the portal layer for its pickers, so they stay usable
 * while everything behind it is inert.
 */
/** What rides with the first message besides its text: a backlog item. */
export interface Carry {
  /** The card at the top of the writing area, and anything said about it. */
  card: ReactNode;
  /** A line under the chips about what starting does with it. */
  note?: ReactNode;
  placeholder?: string | undefined;
  /** Start may go with no typed words: the item is the message. */
  onSendEmpty?: (() => void) | undefined;
  /** Nothing may start while this holds, for example while another session holds the item. */
  blocked?: boolean | undefined;
}

export function NewSessionDialog({ destination, model, mentions, commands, rapidfire, phase, carry, onRapidfire, onDiscard, onClose, hidden = false }: {
  hidden?: boolean;
  /** The destination chip and its picker. */
  destination: ReactNode;
  carry?: Carry | undefined;
  model: ModelBinding;
  mentions: MentionSource;
  commands: CommandBinding;
  rapidfire: boolean;
  phase: StartPhase;
  onRapidfire: () => void;
  onDiscard: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const pressedBackdrop = useRef(false);
  // Native close events are queued. A fast failure can reopen this dialog before its hide event arrives.
  const hiding = useRef(false);
  const busy = phase.type === "starting";
  // Read before showModal moves focus, so closing returns it where it was.
  const [opener] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
  useLayoutEffect(() => {
    if (!dialog) return;
    if (hidden) { if (dialog.open) { hiding.current = true; dialog.close(); } }
    else if (!dialog.open && typeof dialog.showModal === "function") dialog.showModal();
  }, [dialog, hidden]);
  useLayoutEffect(() => () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); }, [opener]);
  const close = () => { if (!busy) onClose(); };
  return createPortal(<dialog ref={setDialog} hidden={hidden} className="ns-dialog" aria-labelledby={titleId}
    // Nested dialogs (the image viewer) send their own cancel and close events up through React. Only ours count.
    onCancel={(event) => { if (event.target !== event.currentTarget) return; event.preventDefault(); close(); }}
    // The browser can still close it (a second Escape). While a start runs, its outcome must be seen.
    onClose={(event) => {
      if (event.target !== event.currentTarget) return;
      if (hiding.current) { hiding.current = false; return; }
      if (hidden) return;
      if (busy) dialog?.showModal(); else onClose();
    }}
    onPointerDown={(event) => { pressedBackdrop.current = event.target === event.currentTarget; }}
    onClick={(event) => {
      if (pressedBackdrop.current && event.target === event.currentTarget) close();
      pressedBackdrop.current = false;
    }}>
    <PortalLayerProvider value={dialog}>
      <ComposerPrimitive.Unstable_TriggerPopoverRoot>
        <Window titleId={titleId} destination={destination} model={model} mentions={mentions} commands={commands}
          rapidfire={rapidfire} phase={phase} carry={carry} onRapidfire={onRapidfire} onDiscard={onDiscard} onClose={close} />
      </ComposerPrimitive.Unstable_TriggerPopoverRoot>
    </PortalLayerProvider>
  </dialog>, document.body);
}

function Window({ titleId, destination, model, mentions, commands, rapidfire, phase, carry, onRapidfire, onDiscard, onClose }: {
  titleId: string; destination: ReactNode; carry?: Carry | undefined; model: ModelBinding; mentions: MentionSource; commands: CommandBinding;
  rapidfire: boolean; phase: StartPhase; onRapidfire: () => void; onDiscard: () => void; onClose: () => void;
}) {
  const [picker, setPicker] = useState<PickerOpen>();
  const context = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const input = useRef<ComposerInputElement>(null);
  const keyboard = useComposerKeyboard(input);
  const snapshot = useRef<MentionInputSnapshot>(null);
  const triggers = unstable_useTriggerPopoverRootContext();
  const busy = phase.type === "starting";
  const empty = useAuiState((state) => state.composer.isEmpty);
  // The composer sends nothing empty. With an item riding along, empty is a whole message.
  const sendEmpty = empty && !busy && !carry?.blocked ? carry?.onSendEmpty : undefined;
  const remember = () => { if (input.current) snapshot.current = { text: input.current.value, cursor: input.current.selectionStart }; };
  function onKeyDown(event: KeyboardEvent) {
    if (keyboard.isComposing(event)) { if (event.key === "Enter") event.preventDefault(); return; }
    const shiftKey = keyboard.enterShift(event);
    if (busy) return;
    if (event.key === "Enter" && (event.altKey || event.getModifierState("AltGraph"))) { event.preventDefault(); return; }
    if (event.key === "Enter" && shiftKey) {
      if (!event.shiftKey) keyboard.insertNewline(event);
      return;
    }
    remember();
    // An open suggestion list takes Enter and Escape first.
    for (const trigger of triggers.getTriggers().values()) {
      if (trigger.resource.handleKeyDown({ key: event.key, shiftKey, preventDefault: () => event.preventDefault() })) return;
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (sendEmpty) sendEmpty();
      else if (!carry?.blocked) input.current?.closest("form")?.requestSubmit();
    }
  }
  const startLabel = busy ? "Starting…" : rapidfire ? "Start in background" : "Start session";
  return <ComposerPrimitive.Root className="ns-window composer">
    <header className="ns-head">
      <span className="ns-crumb">
        <span className="ns-badge" aria-hidden><LogoMark /></span>
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
    <ComposerPrimitive.AttachmentDropzone ref={body} className="ns-body" disabled={busy}>
      {carry?.card}
      <ComposerEditor inputRef={input} label="First message" className="ns-input"
        placeholder={carry?.placeholder ?? "Describe what the agent should do first…"}
        keyShortcuts="Control+Alt+I Control+Enter Meta+Enter"
        onKeyDown={onKeyDown} onKeyUp={keyboard.onKeyUp} onBlur={keyboard.onBlur}
        onCompositionStart={keyboard.onCompositionStart} onCompositionEnd={keyboard.onCompositionEnd}
        onEdit={keyboard.onChange} onSelectionChange={remember} />
      {/* What the message carries sits under the words, beside the chip that added it. */}
      <ComposerAttachments />
      <AttachmentErrors />
    </ComposerPrimitive.AttachmentDropzone>
    <div className="ns-chips" role="group" aria-label="What the first message carries">
      <AttachButton disabled={busy} settingDisabled={busy} title={`Attach up to ${MAX_ATTACHMENTS} files`} />
      <button type="button" className="ns-chip" aria-pressed={rapidfire} disabled={busy} onClick={onRapidfire}
        title={rapidfire ? "Rapidfire: each start opens its pending session" : "Rapidfire: start in background and show progress"}>
        <ZapIcon aria-hidden size={14} />Rapidfire</button>
      <ComposerDictation disabled={busy} />
    </div>
    {carry?.note}

    {phase.type === "failed" && <p className="ns-error" role="alert">{phase.message}</p>}
    </div>
    <footer className="ns-foot">
      <button type="button" className="ns-discard" disabled={busy} onClick={onDiscard}>Discard draft</button>
      {sendEmpty ? <button type="button" className="ns-start primary" aria-keyshortcuts="Control+Enter Meta+Enter"
        title={`${startLabel} (Ctrl+Enter)`} onClick={sendEmpty}>{startLabel}</button>
        : carry?.blocked ? <button type="button" className="ns-start primary" disabled>{startLabel}</button>
        : <ComposerPrimitive.Send className="ns-start primary" aria-keyshortcuts="Control+Enter Meta+Enter"
          title={`${startLabel} (Ctrl+Enter)`}>{startLabel}</ComposerPrimitive.Send>}
    </footer>
    {/* Above the writing area, so the list never covers the line being typed. */}
    <SlashCommands binding={commands} anchor={body} />
    {(["@", "!@", "#"] as const).map((char) => <MentionPopover key={`${mentions.key}:${char}`}
      source={mentions} char={char} input={input} snapshot={snapshot} enabled={!busy} />)}
  </ComposerPrimitive.Root>;
}
