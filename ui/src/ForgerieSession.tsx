import { contextUse } from "./contextUse";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AssistantRuntimeProvider, useExternalStoreRuntime, type AppendMessage, type AssistantRuntime } from "@assistant-ui/react";
import { browserTransport, createSessionStore, isBashRunning, NotSentError, shellAvailabilityOf } from "./sessionStore";
import type { Session } from "./contracts";
import { useThreadMessages } from "./useThreadMessages";
import { Thread } from "./ui/Thread";
import { SessionFrame } from "./ui/SessionFrame";
import type { AskBinding } from "./ui/useAskMode";
import type { CommandResult } from "./commands";
import { createMentionSource } from "./mentionSource";
import { ForgerieDictationAdapter } from "./speech/ForgerieDictationAdapter";
import { DictationProvider } from "./DictationProvider";
import { createAttachmentAdapter, type PromptAttachment } from "./attachments";
import { sendMessage } from "./sendMessage";
import { createChatDraft } from "./chatDraft";
import type { HandoffDoor } from "./handoffDoor";
import { SessionDoorsProvider } from "./ui/SessionDoor";
import type { DraftStore } from "./draftStore";
import { workingSend } from "./queue";
import { phaseFor } from "./dialog";
import type { DialogBinding } from "./ui/DialogLayer";
import type { TreeOutcome } from "./sessionTree";
import { SessionTreeNavigator, TreeOpener } from "./ui/SessionTreeNavigator";
import { ArchiveNextButton } from "./ui/ArchiveNext";
import type { ArchiveAvailability } from "./picker/archiveNext";
import { createNoteTray } from "./changes/noteTray";
import { annotationsOf, carriesNotes } from "./changes/diffNotes";
import { createChangesSource } from "./changes/changesSource";
import { ChangesOpener, ChangesReview } from "./ui/ChangesReview";
import type { NotesBinding } from "./ui/NoteTray";
import type { WorktreeApi, WorktreeInfo } from "./worktrees/worktreeApi";
import { useSessionWorktree } from "./worktrees/useSessionWorktree";
import { visibleSetup } from "./worktrees/worktreeModel";
import { WorktreeChip } from "./ui/WorktreeChip";
import { SessionMenu, WorktreeDialog, type WorktreeCommand } from "./ui/WorktreeActions";
import { WorktreeReceipt, WorktreeSetupCard } from "./ui/WorktreeSetupCard";

// Binding: the only React component that reads the Forgerie transport/store.
export function ForgerieSession({ id, known, initialDraft, initialError, drafts, onSwitchSession, archive, worktree: catalogWorktree, worktrees, onNewSession }: {
  id: string; known?: Session | undefined; initialDraft?: string | undefined;
  /** The catalog's live view of this session's worktree: state, setup, and branch as events report them. */
  worktree?: WorktreeInfo | undefined;
  /** Worktree reads and Land/Discard. Absent: the session shows no worktree controls. */
  worktrees?: WorktreeApi | undefined;
  /** Start a new session, offered once this one can no longer continue. */
  onNewSession?: (() => void) | undefined;
  /** Shown once on open, such as a new session whose first message may not have gone out. */
  initialError?: string | undefined;
  /** "Archive and next" from the catalog's view of this session. Absent: no button. */
  archive?: { availability: ArchiveAvailability; onArchive: () => void } | undefined;
  /** Where unsent drafts outlive this view. Without it, they last only while the view is mounted. */
  drafts?: DraftStore | undefined;
  onSwitchSession: (session: Session, draft?: string) => void;
}) {
  const [store] = useState(() => createSessionStore(id, browserTransport, {}, known));
  const [dictation] = useState(() => new ForgerieDictationAdapter());
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const runtimeRef = useRef<AssistantRuntime | null>(null);
  const [saved] = useState(() => drafts?.session(id));
  const [chatDraft] = useState(() => createChatDraft(() => runtimeRef.current?.thread.composer, saved));
  const sessionId = state.session?.id;
  const cwd = state.session?.cwd;
  const mentions = useMemo(() => sessionId && cwd ? createMentionSource({ id: sessionId, cwd }, browserTransport.request) : undefined,
    [sessionId, cwd]);
  const [attachments] = useState(() => createAttachmentAdapter(store.saveAttachment));
  const [sendError, setSendError] = useState<string | undefined>(initialError);
  useEffect(() => { void store.start(); return () => { attachments.dispose(); store.dispose(); }; }, [store, attachments]);
  const applyResult = useCallback((result: CommandResult | void) => {
    if (!runtimeRef.current || result?.type !== "done") return;
    if (result.session && result.session.id !== id) onSwitchSession(result.session, result.promptDraft);
    else if (result.promptDraft !== undefined) runtimeRef.current.thread.composer.setText(result.promptDraft);
  }, [id, onSwitchSession]);
  // A fork opens as its own session. Continuing reloads this one and returns the entry's text to the message box.
  const applyTree = useCallback((outcome: TreeOutcome) => {
    if (outcome.type === "forked") onSwitchSession(outcome.session, outcome.promptDraft);
    else if (outcome.type === "continued") runtimeRef.current?.thread.composer.setText(outcome.editorText);
  }, [onSwitchSession]);
  const openDoor = useCallback((door: HandoffDoor) => onSwitchSession({ id: door.sessionId, cwd: door.cwd }), [onSwitchSession]);
  const send = useCallback(async (text: string, images?: PromptAttachment[], options?: { steer?: boolean }) => {
    applyResult(await store.send(text, images, options));
  }, [store, applyResult]);
  // Notes on diff lines wait here, saved with the drafts, until a chat message carries them.
  const [tray] = useState(() => createNoteTray(saved));
  const notes = useSyncExternalStore(tray.subscribe, tray.notes);
  const [review, setReview] = useState<{ focusNoteId?: string }>();
  const changes = useMemo(() => cwd ? createChangesSource(cwd, browserTransport.request) : undefined, [cwd]);
  /** Send a chat message with every waiting note. Only the notes it carried leave the tray, and only once Pi accepted it. */
  const sendWithNotes = useCallback(async (text: string, images: PromptAttachment[] | undefined, steer: boolean) => {
    const carried = carriesNotes(text) ? tray.notes() : [];
    applyResult(await store.send(text, images, { steer, diffAnnotations: annotationsOf(carried) }));
    tray.drop(carried.map((note) => note.id));
  }, [store, tray, applyResult]);
  const onNew = useCallback(async (message: AppendMessage) => {
    setSendError(undefined);
    // assistant-ui marks a steer on the message itself (composer.send({ steer: true })).
    await sendMessage(message, (text, images) => sendWithNotes(text, images, message.steer === true),
      () => runtimeRef.current?.thread.composer, setSendError);
  }, [sendWithNotes]);
  const notesBinding: NotesBinding = {
    notes, onRemove: tray.remove, onOpen: (noteId) => setReview({ focusNoteId: noteId }),
    onSendAlone: async (steer) => {
      setSendError(undefined);
      try { await sendWithNotes("", undefined, steer); }
      catch (error) {
        // Notes never leave the tray on failure, so there is nothing to restore.
        setSendError(error instanceof NotSentError ? error.message
          : `${error instanceof Error ? error.message : String(error)} Check the transcript before sending again.`);
        throw error;
      }
    },
  };
  const onCancel = useCallback(async () => {
    try {
      const restored = await store.cancel();
      chatDraft.restore(restored.map((message) => message.text).join("\n\n"));
    } catch { /* The store exposes the command error. */ }
  }, [store, chatDraft]);
  const busy = state.transcript.isRunning || isBashRunning(state) || state.status?.isCompacting === true;
  const { info: worktree, refresh: refreshWorktree } = useSessionWorktree(worktrees, { catalog: catalogWorktree, status: state.status?.worktree }, busy);
  // Landed or discarded: the transcript is saved, the folder is gone, Pi does not run here again.
  const readOnly = state.status?.readOnly === true || (worktree !== undefined && worktree.state.kind !== "active");
  const [worktreeCommand, setWorktreeCommand] = useState<WorktreeCommand>();
  const setup = worktree?.owned ? visibleSetup(worktree.setup, state.transcript.messages.length > 0 || state.transcript.isRunning) : undefined;
  const messages = useThreadMessages(state.transcript.messages, state.transcript.isRunning);
  const runtime = useExternalStoreRuntime({
    messages, onNew, onCancel, adapters: { dictation, attachments },
    isRunning: state.transcript.isRunning,
    isLoading: state.connection.type === "loading",
    isDisabled: state.connection.type !== "ready",
    isSendDisabled: state.sending || state.connection.type !== "ready",
  });
  useEffect(() => { runtimeRef.current = runtime; return () => { runtimeRef.current = null; }; }, [runtime]);
  // Bring back the saved chat draft, then save every change. A fork's prompt draft, set next, replaces it.
  useEffect(() => {
    if (!saved) return;
    chatDraft.hydrate(saved.chat());
    return runtime.thread.composer.subscribe(chatDraft.sync);
  }, [runtime, chatDraft, saved]);
  useEffect(() => { if (initialDraft !== undefined) runtime.thread.composer.setText(initialDraft); }, [initialDraft, runtime]);
  // Once joined, the store names the open ask. Answers saved for any other ask can never be sent.
  const openAskId = state.ask.type === "open" ? state.ask.ask.askId : undefined;
  const joined = state.connection.type === "ready";
  useEffect(() => { if (joined) saved?.keepAnswers(openAskId); }, [saved, joined, openAskId]);
  const error = state.connection.type === "reconnecting" ? "Reconnecting automatically. Your draft stays here."
    : state.connection.type === "failed" ? state.connection.message
    : sendError ?? state.commandError ?? state.transcript.error;
  const dialogs = state.status?.pendingDialogs ?? [];
  const status = readOnly ? (worktree?.state.kind === "landed" ? "Landed" : worktree?.state.kind === "discarded" ? "Discarded" : "Read-only")
    : state.connection.type === "loading" ? "Connecting"
    : state.connection.type === "reconnecting" ? "Reconnecting"
    : state.connection.type === "failed" ? "Disconnected"
    : dialogs.length > 0 ? "Waiting for you"
    : state.sending ? "Sending" : state.compaction.type === "running" ? "Compacting"
    : state.compaction.type === "queued" ? "Compaction queued" : state.transcript.isRunning ? "Running"
    : isBashRunning(state) ? "Running shell command"
    : state.ask.type === "open" ? "Waiting for you" : "Connected";
  const oldestDialog = dialogs[0];
  const dialog: DialogBinding | undefined = oldestDialog && {
    dialog: oldestDialog, count: dialogs.length, phase: phaseFor(state.dialogPhase, oldestDialog.dialogId),
    offline: state.connection.type !== "ready",
    onAnswer: (value) => void store.answerDialog(oldestDialog.dialogId, value),
    onCancel: () => void store.cancelDialog(oldestDialog.dialogId),
  };
  const ask: AskBinding | undefined = state.ask.type === "open" ? {
    ask: state.ask.ask, phase: state.ask.phase, offline: state.connection.type !== "ready",
    onSubmit: (answers) => void store.submitAsk(answers), onDismiss: () => void store.dismissAsk(),
    onChat: send, answers: saved,
  } : undefined;

  return <AssistantRuntimeProvider runtime={runtime}>
    <DictationProvider adapter={dictation}>
    <SessionFrame name={state.session?.name ?? "Session"} status={status} error={error}
      recovery={state.connection.type === "failed" ? <button onClick={() => window.location.reload()}>Reload</button> : undefined}
      actions={<>
        {/* A landed or discarded worktree has no folder left to diff. */}
        {changes && !readOnly && <ChangesOpener notes={notes.length} onOpen={() => setReview({})} />}
        <TreeOpener idle={state.connection.type === "ready" && !state.sending && !state.transcript.isRunning}
          onOpen={() => { void store.openTree().catch(() => { /* The store exposes the error. */ }); }} />
        {archive && <ArchiveNextButton onArchive={archive.onArchive}
          // The catalog's status can lag the live one; the server refuses an archive during any run.
          availability={isBashRunning(state) || state.status?.isStreaming === true || state.status?.isCompacting === true
            ? { type: "blocked", reason: "Stop the run first" } : archive.availability} />}
        {worktree && worktrees && worktree.state.kind === "active" && <SessionMenu info={worktree} busy={busy} onCommand={setWorktreeCommand} />}
      </>}>
      <SessionDoorsProvider cwd={cwd} open={openDoor}>
      <Thread ask={ask} mentions={mentions} chatDraft={chatDraft}
        head={setup && <WorktreeSetupCard setup={setup} hookSeen={setup.log !== ""} branch={worktree?.branch} />}
        inputContext={worktree && worktree.state.kind === "active" ? <WorktreeChip info={worktree} /> : undefined}
        readOnly={readOnly ? <WorktreeReceipt state={worktree?.state} defaultBranch={worktree?.defaultBranch}
          branch={worktree?.branch} onNew={onNewSession} /> : undefined} commands={{ catalog: state.commands, onRetry: () => void store.loadCommands() }}
        compaction={{ state: state.compaction, disabled: state.sending || state.connection.type !== "ready",
          waits: state.transcript.isRunning || isBashRunning(state),
          onSend: send, onDismiss: store.dismissCompaction }}
        shell={{ availability: shellAvailabilityOf(state), onRun: send }}
        queue={{ items: state.status?.queuedMessages ?? [], disabled: state.sending || state.connection.type !== "ready",
          onClear: () => { void store.clearQueue().catch(() => { /* Store exposes the error. */ }); } }}
        working={workingSend(state.status, state.compaction, state.transcript.isRunning)}
        dialog={dialog} notes={notesBinding}
        model={{ model: state.status?.model, thinkingLevel: state.status?.thinkingLevel, disabled: state.connection.type !== "ready",
          listModels: store.listModels, listThinkingLevels: store.listThinkingLevels, onModel: store.setModel, onThinkingLevel: store.setThinkingLevel,
          context: contextUse(state.status) }}
        commandResult={state.commandResult ? {
          result: state.commandResult, disabled: state.sending || state.connection.type !== "ready",
          onChoose: (requestId, value) => { void store.respondToCommand(requestId, value).then(applyResult).catch(() => { /* Store exposes the error and keeps the choices. */ }); },
          onClose: store.dismissCommand,
        } : undefined} />
      </SessionDoorsProvider>
      {state.tree.type === "open" && <SessionTreeNavigator tree={state.tree.tree} operation={state.tree.operation}
        onContinue={(targetId, summary) => { void store.continueTree(targetId, summary).then(applyTree); }}
        onFork={(entryId) => { void store.forkTree(entryId).then(applyTree); }}
        onAbort={() => { void store.abortTree(); }} onClose={store.closeTree} />}
      {review && changes && <ChangesReview source={changes} notes={notes} focusNoteId={review.focusNoteId}
        onAdd={tray.add} onEdit={tray.edit} onRemove={tray.remove} onClose={() => setReview(undefined)} />}
      {worktreeCommand && worktree && worktrees && <WorktreeDialog command={worktreeCommand} info={worktree} api={worktrees}
        onAsk={readOnly ? undefined : (prompt) => send(prompt)} onDone={() => { void refreshWorktree(); }} onClose={() => setWorktreeCommand(undefined)} />}
    </SessionFrame>
    </DictationProvider>
  </AssistantRuntimeProvider>;
}
