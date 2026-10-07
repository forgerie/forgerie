// Adapted from assistant-ui's homepage demo. See THIRD_PARTY_NOTICES.md.
import { useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { AuiIf, ComposerPrimitive, useAui, useAuiState, unstable_useTriggerPopoverRootContext } from "@assistant-ui/react";
import type { MentionSource } from "../mentionSource";
import { MentionPopover, type MentionInputSnapshot } from "./MentionPopover";
import { ArrowUpIcon, ChevronLeftIcon, CornerDownLeftIcon, InfoIcon, PuzzleIcon, SquareIcon, TerminalIcon } from "lucide-react";
import { OTHER_TEXT_MAX_LENGTH } from "../askDraft";
import { useDictation } from "../DictationProvider";
import { ComposerDictation } from "./ComposerDictation";
import { useAskMode, type AskBinding, type AskControl } from "./useAskMode";
import { SlashCommands, type CommandBinding } from "./SlashCommands";
import { AddAttachment, AttachmentErrors, ComposerAttachments } from "./Attachments";
import { MAX_ATTACHMENTS } from "../attachments";
import { isCompactCommand } from "../compaction";
import type { CompactionBinding } from "./CompactionNotice";
import { createChatDraft, type ChatDraft } from "../chatDraft";
import { shellDraftOf, type ShellAvailability } from "../shellDraft";
import { isCommand } from "../commands";
import type { WorkingSend } from "../queue";
import { ModelPicker, type ModelBinding, type PickerOpen } from "./ModelPicker";
import { modelCommandQuery } from "../modelChoice";
import { DialogLayer, useDialogMode, type DialogBinding } from "./DialogLayer";
import { NoteTray, type NotesBinding } from "./NoteTray";

/** `!` commands. The binding owns the server rules; the bar adds its own blockers. */
export interface ShellBinding { availability: ShellAvailability; onRun: (text: string) => Promise<void> }

const sendsNow: WorkingSend = { queue: false, steer: false };

/**
 * System molecule: the one input bar. While an ask is open it gains a question
 * layer on top, and its own input answers the current question. There is never
 * a second input. Input capabilities belong to this bar in both modes.
 * An attached file routes the input as chat, never as a text-only ask submission.
 */
type ComposerProps = { ask?: AskBinding; mentions?: MentionSource | undefined; commands?: CommandBinding; compaction?: CompactionBinding | undefined;
  shell?: ShellBinding | undefined;
  /** What a draft can do while the session works. Without it, sending waits for the run. */
  working?: WorkingSend | undefined;
  /** Pi holds queued work that Stop would return to the draft. */
  queued?: boolean;
  /** The session's model and thinking level. Without it, the bar shows no picker. */
  model?: ModelBinding | undefined;
  /** The oldest open extension dialog. An open ask goes first. */
  dialog?: DialogBinding | undefined;
  /** Files can be attached. Off where nothing can store them yet, such as a session that does not exist. */
  attachments?: boolean;
  /** Notes on diff lines that go with the next chat message. */
  notes?: NotesBinding | undefined;
  /** A readout at the start of the action row, such as the session's branch. It gives way before any button. */
  context?: ReactNode;
  chatDraft?: ChatDraft | undefined };
export function Composer(props: ComposerProps) {
  const aui = useAui();
  const latest = useRef(aui);
  latest.current = aui;
  const [localDraft] = useState(() => createChatDraft(() => latest.current.composer));
  return <ComposerPrimitive.Unstable_TriggerPopoverRoot><ComposerBar {...props} chatDraft={props.chatDraft ?? localDraft} /></ComposerPrimitive.Unstable_TriggerPopoverRoot>;
}
function ComposerBar({ ask, mentions, commands, compaction, shell, working = sendsNow, queued = false, model, dialog, attachments = true, notes, context, chatDraft }: ComposerProps & { chatDraft: ChatDraft }) {
  const [picker, setPicker] = useState<PickerOpen>();
  const aui = useAui();
  const text = useAuiState((s) => s.composer.text);
  const canSend = useAuiState((s) => s.composer.canSend);
  const running = useAuiState((s) => s.thread.isRunning);
  const disabled = useAuiState((s) => s.thread.isDisabled);
  const preparing = useAuiState((s) => s.composer.submission !== undefined);
  const count = useAuiState((s) => s.composer.attachments.length);
  const tooMany = count > MAX_ATTACHMENTS;
  const dictating = useAuiState((s) => s.composer.dictation != null);
  const { state } = useDictation();
  const control = useAskMode(ask, chatDraft);
  const input = useRef<HTMLTextAreaElement>(null);
  // An open ask goes first. A dialog waits behind it, and the bar says so.
  const dialogControl = useDialogMode(control ? undefined : dialog, chatDraft, input);
  const dialogInput = dialogControl?.isInput === true;
  // An ask answer or a dialog answer is literal text: no command, shell, or queue routing.
  const literal = !!control || dialogInput;
  const compactDraft = !!compaction && !literal && count === 0 && !preparing && isCompactCommand(text);
  // Pi has no `/model` command for the web. The bar opens the picker instead,
  // with any text after the command as its search.
  const modelQuery = model && !literal && count === 0 && !preparing ? modelCommandQuery(text) : undefined;
  function chooseModel() {
    if (modelQuery === undefined || !model || model.disabled) return;
    aui.composer.setText("");
    setPicker({ query: modelQuery });
  }
  const compactBlocked = disabled || dictating || compaction?.disabled || compaction?.state.type === "checking" || compaction?.state.type === "queued" || compaction?.state.type === "running";
  async function sendCompaction() {
    if (!compactDraft || compactBlocked || !compaction) return;
    aui.composer.setText("");
    try { await compaction.onSend(text); }
    catch {
      chatDraft.restore(text, "if-empty");
    }
  }
  // Ask mode routes shell text itself, through its chat action.
  const shellDraft = shell && !literal ? shellDraftOf(text) : { type: "chat" as const };
  const shellMode = shellDraft.type !== "chat";
  const shellReason = !shellMode || !shell ? undefined : count > 0 ? "Remove attachments to run a shell command."
    : shellDraft.type === "empty" ? "Type a command after !."
    : shell.availability.type === "blocked" ? shell.availability.reason : undefined;
  const shellBlocked = disabled || preparing || dictating || shellReason !== undefined;
  // Notes go with a chat message, or alone when the draft is empty. Commands leave them waiting.
  const noteCount = notes?.notes.length ?? 0;
  const notesAlone = noteCount > 0 && !literal && !preparing && count === 0 && text.trim() === "";
  const notesWait = noteCount > 0 && !literal && (shellMode || compactDraft || modelQuery !== undefined || isCommand(text));
  const [sendingNotes, setSendingNotes] = useState(false);
  async function sendNotesAlone(steer: boolean) {
    if (!notes || !notesAlone || disabled || dictating || sendingNotes) return;
    setSendingNotes(true);
    try { await notes.onSendAlone(steer); } catch { /* The binding shows the error; the notes stay. */ } finally { setSendingNotes(false); }
  }
  async function runShell() {
    if (shellDraft.type !== "shell" || shellBlocked || !shell) return;
    aui.composer.setText("");
    try { await shell.onRun(shellDraft.text); }
    catch { chatDraft.restore(shellDraft.text, "if-empty"); }
  }
  // While the agent works, an ordinary draft can wait as a follow-up or steer
  // the current response. Pi owns that queue. Commands and shell commands keep
  // their own rules, and attachments must wait, because Stop can return only
  // queued text.
  // `working` is the one rule for "the session works", shared with the store,
  // so the buttons always match what a send does.
  const workingDraft = working.queue && !literal && !compactDraft && !shellMode && !preparing
    && !isCommand(text) && (text.trim() !== "" || count > 0 || notesAlone);
  const queueBlocked = disabled || dictating || tooMany || count > 0 || (notesAlone ? sendingNotes : !canSend);
  function sendWhileWorking(steer: boolean) {
    if (!workingDraft || queueBlocked || (steer && !working.steer)) return;
    if (notesAlone) void sendNotesAlone(steer);
    else void aui.composer.send(steer ? { steer: true } : undefined);
    // The buttons unmount with the draft. Keep focus, and the touch keyboard, in the input.
    input.current?.focus({ preventScroll: true });
  }
  const anchor = useRef<HTMLDivElement>(null);
  const snapshot = useRef<MentionInputSnapshot>(null);
  const rememberInput = () => { if (input.current) snapshot.current = { text: input.current.value, cursor: input.current.selectionStart }; };
  const triggers = unstable_useTriggerPopoverRootContext();
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    rememberInput();
    // `/model` typed in full opens the picker on the first Enter, even while the
    // slash list offers it: completing it to "/model " would only ask for a second Enter.
    if (modelQuery !== undefined && event.key === "Enter" && !event.shiftKey) { event.preventDefault(); chooseModel(); return; }
    // Input's custom handler runs before SDK plugins. Trigger selection consumes
    // Enter before ask mode can advance or submit the current question.
    for (const trigger of triggers.getTriggers().values()) {
      if (trigger.resource.handleKeyDown(event)) return;
    }
    if (shellMode && event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void runShell(); return; }
    if (compactDraft && event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendCompaction(); return; }
    // assistant-ui's keys: Enter queues, Ctrl or Cmd+Shift+Enter steers, Shift+Enter is a new line.
    if (workingDraft && event.key === "Enter") {
      const steer = event.shiftKey && (event.ctrlKey || event.metaKey);
      if (event.shiftKey && !steer) return;
      event.preventDefault();
      sendWhileWorking(steer);
      return;
    }
    if (notesAlone && !running && event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendNotesAlone(false); return; }
    if (dialogControl?.isInput) { dialogControl.onKeyDown(event); return; }
    if (!tooMany) control?.onKeyDown(event);
  }
  const scopeKey = `${mentions?.key}:${control?.ask.askId ?? "chat"}:${control?.question.id ?? ""}`;
  return <ComposerPrimitive.Root className="composer">
    {/* Always mounted, so each new dialog is announced. The countdown stays silent. */}
    <span className="sr-only" role="status">{dialogControl ? `An extension asks: ${dialogControl.dialog.title}`
      : control && dialog ? "An extension also asks something. It shows after these questions." : ""}</span>
    <ComposerPrimitive.AttachmentDropzone ref={anchor} className="composer-shell" data-mode={control ? "ask" : dialogControl ? "dialog" : "chat"} data-shell={shellMode || undefined}
      disabled={disabled || preparing || !!control?.sending}>
      {model?.context?.type === "known" && <ContextBar percent={model.context.percent} high={model.context.high} />}
      {control && <AskQuestions control={control} />}
      {dialogControl && <DialogLayer control={dialogControl} />}
      {control && dialog && <p className="composer-hint">
        <PuzzleIcon aria-hidden size={14} />An extension also asks something. It shows after these questions.
      </p>}
      <ComposerAttachments />
      {notes && noteCount > 0 && <NoteTray binding={notes} disabled={sendingNotes} />}
      <AttachmentErrors />
      {tooMany && <p role="alert" className="attachment-notice">Send at most 16 attachments. Remove a file to continue.</p>}
      {control?.route === "chat" && <p className="ask-route" role="status">
        <InfoIcon aria-hidden size={14} />{count > 0 || preparing
          ? "Attachments run as chat messages. Sending closes these questions."
          : "Commands run in Pi. Questions stay open unless Pi closes them."}
      </p>}
      {workingDraft && count > 0 && <p className="ask-route" role="status">
        <InfoIcon aria-hidden size={14} />Queued messages are text only. Remove the attachments to queue this message.
      </p>}
      {notesWait && <p className="composer-hint" role="status">
        <InfoIcon aria-hidden size={14} />Commands do not carry notes. Your notes wait for your next message.
      </p>}
      {control?.error && <p className="ask-error" role="alert">{control.error}</p>}
      {state.type === "failed" && <p className="ask-error" role="alert">{state.message}</p>}
      {shellDraft.type !== "chat" && <p className="composer-hint" role="status" data-blocked={shellReason !== undefined || undefined}>
        <TerminalIcon aria-hidden size={14} />{shellReason ?? (shellDraft.excludeFromContext
          ? "Shell command. Its output stays out of the agent's context." : "Shell command. The agent sees its output.")}
      </p>}
      <ComposerPrimitive.Input ref={input} aria-label={dialogInput ? "Answer" : "Message"} rows={1} className="composer-input"
        placeholder={control?.placeholder ?? (dialogInput ? dialogControl.placeholder : "Send a message...")}
        aria-describedby={control?.headingId ?? (dialogInput ? dialogControl.headingId : undefined)}
        enterKeyHint={control && !control.last && control.route === "answer" ? "next" : "send"}
        maxLength={control ? OTHER_TEXT_MAX_LENGTH : undefined}
        submitMode={control || dialogInput || tooMany || compactDraft || modelQuery !== undefined || shellMode || running || working.queue || notesAlone ? "none" : "enter"}
        // Escape stops the run only from an empty draft, so it never throws typing into the queue path.
        cancelOnEscape={!dialogInput && text.trim() === "" && count === 0} onKeyDown={onKeyDown} onChange={rememberInput} onSelect={rememberInput}
        disabled={control?.sending || undefined} />
      <div className="composer-actions">
        {context}
        {attachments && <AddAttachment disabled={disabled || preparing || !!control?.sending || dialogInput || count >= MAX_ATTACHMENTS} />}
        {model && <ModelPicker binding={model} anchor={anchor} open={picker} onOpenChange={setPicker} />}
        <ComposerDictation disabled={disabled || preparing || !!control?.sending} />
        {preparing ? <ComposerPrimitive.Cancel className="primary icon-button" aria-label="Cancel attachment preparation" title="Cancel attachment preparation">
          <SquareIcon aria-hidden size={12} fill="currentColor" />
        </ComposerPrimitive.Cancel> : control ? <AskActions control={{ ...control, blocked: control.blocked || tooMany }}
          chatLabel={shellDraftOf(text).type === "shell" ? "Run command" : "Send message"} />
        : dialogInput ? <button type="button" className="primary ask-primary" disabled={dialogControl.inputBlocked || tooMany || count > 0}
          onClick={dialogControl.submitInput}>{dialogControl.sending ? "Sending…" : "Send answer"}<ArrowUpIcon aria-hidden size={16} /></button> : <>
          {compactDraft ? <button type="button" className="primary compact-send" disabled={compactBlocked} onClick={() => void sendCompaction()}>
            {compaction?.waits ?? running ? "Queue compaction" : "Compact history"}
          </button> : modelQuery !== undefined ? <button type="button" className="primary compact-send" disabled={model?.disabled} onClick={chooseModel}>
            Choose model
          </button> : shellMode ? <button type="button" className="primary compact-send" disabled={shellBlocked} onClick={() => void runShell()}>
            Run command
          </button> : running || workingDraft ? null : notesAlone ? <button type="button" className="primary icon-button" aria-label="Send notes"
            title="Send the notes without a message" disabled={disabled || dictating || sendingNotes} onClick={() => void sendNotesAlone(false)}>
            <ArrowUpIcon aria-hidden size={16} />
          </button> : <ComposerPrimitive.Send disabled={disabled || dictating || tooMany} className="primary icon-button" aria-label="Send message" title="Send message">
            <ArrowUpIcon aria-hidden size={16} />
          </ComposerPrimitive.Send>}
          {workingDraft && <>
            {working.steer && <button type="button" className="steer-send" disabled={queueBlocked} onClick={() => sendWhileWorking(true)}
              aria-keyshortcuts="Control+Shift+Enter Meta+Shift+Enter"
              title="Send now. The agent reads it after its current step. Ctrl or Cmd+Shift+Enter">Steer</button>}
            <button type="button" className="icon-button queue-send" aria-label="Queue message" disabled={queueBlocked} aria-keyshortcuts="Enter"
              onClick={() => sendWhileWorking(false)} title="Send when the current work finishes. Enter">
              <ArrowUpIcon aria-hidden size={16} />
            </button>
          </>}
          <AuiIf condition={(s) => s.thread.isRunning}>
            <ComposerPrimitive.Cancel disabled={disabled} className="primary icon-button" aria-label={compaction?.state.type === "running" ? "Stop compaction" : "Stop generating"}
              title={queued ? "Stop and return queued messages to the draft" : compaction?.state.type === "running" ? "Stop compaction" : "Stop generating"}>
              <SquareIcon aria-hidden size={12} fill="currentColor" />
            </ComposerPrimitive.Cancel>
          </AuiIf>
        </>}
      </div>
    </ComposerPrimitive.AttachmentDropzone>
    {commands && !dialogInput && <SlashCommands binding={commands} anchor={anchor} />}
    {mentions && (["@", "!@", "#"] as const).map((char) => <MentionPopover key={`${scopeKey}:${char}`}
      source={mentions} char={char} input={input} snapshot={snapshot} enabled={!disabled && !control?.sending && !shellMode} />)}
  </ComposerPrimitive.Root>;

}

/** The question layer: step row, question, and options. It scrolls inside a height budget. */
function AskQuestions({ control }: { control: AskControl }) {
  const { ask, question, index, count } = control;
  const kind = question.multiple ? "checkbox" : "radio";
  return <section className="ask" aria-label="Questions from the agent" aria-busy={control.sending}
    data-folded={control.route === "chat" || undefined}>
    {/* Like the homepage branch picker (hideWhenSingleBranch), the step row
        appears only when there is more than one question, or when a command
        folds the questions to it. */}
    {(count > 1 || control.route === "chat") && <div className="ask-head">
      {count > 1 && <button type="button" className="icon-button quiet-button" aria-label="Previous question" title="Previous question"
        disabled={index === 0 || control.sending} onClick={() => control.go(index - 1)}>
        <ChevronLeftIcon aria-hidden size={16} />
      </button>}
      {count > 1 && <ol className="ask-rail" aria-label="Questions">
        {ask.questions.map((item, position) => {
          const answered = control.answered(position);
          return <li key={item.id}>
            <button type="button" className="ask-step" data-answered={answered || undefined} disabled={control.sending}
              aria-current={position === index ? "step" : undefined} onClick={() => control.go(position)}
              aria-label={`Question ${position + 1}, ${answered ? "answered" : "not answered"}`} />
          </li>;
        })}
      </ol>}
      <span className="ask-count" aria-hidden>{index + 1} of {count}</span>
    </div>}
    <div className="ask-body">
      <h2 className="ask-question" id={control.headingId}>{question.question}</h2>
      {question.detail && <p className="ask-detail">{question.detail}</p>}
      {question.options.length > 0 && <div className="ask-options" role="group" aria-labelledby={control.headingId} data-kind={kind}>
        {question.options.map((option) => <label key={option.value} className="ask-option">
          <input type={kind} name={`${ask.askId}-${question.id}`} checked={control.values.includes(option.value)}
            disabled={control.sending} onChange={() => control.pick(option.value)} />
          <span className="ask-option-text">
            <span>{option.label}</span>
            {option.detail && <small>{option.detail}</small>}
          </span>
        </label>)}
      </div>}
    </div>
  </section>;
}

function AskActions({ control, chatLabel }: { control: AskControl; chatLabel: string }) {
  const { phase, route, last, count } = control;
  const sending = (action: "submit" | "dismiss") => phase.type === "sending" && phase.action === action;
  if (route === "chat") {
    return <button type="button" className="primary ask-primary" disabled={control.blocked} onClick={control.primary}>
      {chatLabel}<ArrowUpIcon aria-hidden size={16} />
    </button>;
  }
  return <>
    <button type="button" className="ask-skip" disabled={control.blocked} onClick={control.dismiss}
      title="Close these questions without answering them">{sending("dismiss") ? "Skipping…" : "Skip"}</button>
    <button type="button" className="primary ask-primary" disabled={control.blocked} onClick={control.primary}>
      {!last ? <>Next<CornerDownLeftIcon aria-hidden size={14} className="ask-key" /></>
        : sending("submit") ? "Sending…" : count > 1 ? "Send answers" : "Send answer"}
    </button>
  </>;
}

/**
 * How full the context window is, drawn on the input's top edge between its
 * rounded corners. The edge is a line the eye crosses every turn anyway.
 */
function ContextBar({ percent, high }: { percent: number; high: boolean }) {
  return <div className="context-bar" role="progressbar" aria-label="Context used" aria-valuemin={0} aria-valuemax={100}
    aria-valuenow={percent} title={`${percent}% of the context window used`} data-high={high || undefined}
    style={{ "--context-used": `${percent}%` } as CSSProperties} />;
}
