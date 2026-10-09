import type { RelatedWorkRenderer } from "./projectGroups/relatedWork";
import { createReadTracker } from "./readReceipt";
import { afterTranscriptPaint } from "./readPaint";
import { contextUse } from "./contextUse";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AssistantRuntimeProvider, useExternalStoreRuntime, type AppendMessage, type AssistantRuntime } from "@assistant-ui/react";
import { browserTransport, createSessionStore, isBashRunning, NotSentError, shellAvailabilityOf } from "./sessionStore";
import type { Session } from "./contracts";
import { useThreadMessages } from "./useThreadMessages";
import { foldProcessEvents } from "./processes/processEvent";
import { loadProcessOutput } from "./processes/processApi";
import { ProcessEventView } from "./processes/ProcessEventView";
import type { ChildEntryArtifact, ProcessEventArtifact } from "./transcript";
import type { SystemArtifactView } from "./ui/Messages";
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
import { workspacePath } from "./changes/workspacePath";
import { existingFiles } from "./changes/existingFiles";
import type { FileLinks } from "./ui/FileTree";
import { createFilesSource } from "./changes/filesSource";
import { ChangesOpener, ChangesReview } from "./ui/ChangesReview";
import type { NotesBinding } from "./ui/NoteTray";
import type { WorktreeApi, WorktreeInfo } from "./worktrees/worktreeApi";
import { useSessionWorktree } from "./worktrees/useSessionWorktree";
import { visibleSetup } from "./worktrees/worktreeModel";
import { WorktreeChip } from "./ui/WorktreeChip";
import { SessionMenu, WorktreeDialog, type WorktreeCommand } from "./ui/WorktreeActions";
import { WorktreeReceipt, WorktreeSetupCard } from "./ui/WorktreeSetupCard";
import { createPullRequestApi, type PullLink } from "./pullRequests/pullRequestApi";
import { useSessionPulls } from "./pullRequests/useSessionPull";
import { firstToShow } from "./pullRequests/pullRequestModel";
import { PullRequestOpener, PullRequestReview } from "./ui/PullRequestReview";
import { createChildAgentsStore } from "./childAgents/childAgentsStore";
import { CHILDREN_CHANGED_EVENT, foldChildEntries } from "./childAgents/childAgentsModel";
import { ChildAgentsOpener } from "./childAgents/ChildAgentsOpener";
import { ChildAgentsPanel } from "./childAgents/ChildAgentsPanel";
import { ChildEntryView } from "./childAgents/ChildEntryView";

const pullRequests = createPullRequestApi(browserTransport.request);
const NO_LINKS: readonly PullLink[] = [];

// Binding: the only React component that reads the Forgerie transport/store.
export function ForgerieSession({ id, known, onUnread, initialDraft, initialError, drafts, onSwitchSession, archive, worktree: catalogWorktree, pullRequests: catalogPulls, worktrees, onNewSession, relatedWork }: {
  relatedWork?: RelatedWorkRenderer | undefined;
  /** The catalog's live view of this session's pull request link and watch. */
  pullRequests?: readonly PullLink[] | undefined;
  onUnread?: ((listener: (id: string) => void) => () => void) | undefined;
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
  // Child agents: their own small store, refreshed when the server says any child changed.
  const sessionRef = useRef<{ id: string; cwd: string } | undefined>(undefined);
  const [childAgents] = useState(() => createChildAgentsStore(browserTransport.request, () => sessionRef.current));
  const [store] = useState(() => createSessionStore(id, browserTransport, {}, known, createReadTracker(browserTransport, { subscribe: onUnread, isVisible: () => document.visibilityState === "visible", afterRender: afterTranscriptPaint }),
    (eventType) => { if (eventType === CHILDREN_CHANGED_EVENT) childAgents.refresh(); }));
  const children = useSyncExternalStore(childAgents.subscribe, childAgents.getSnapshot);
  const [childrenOpen, setChildrenOpen] = useState(false);
  const [dictation] = useState(() => new ForgerieDictationAdapter());
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const runtimeRef = useRef<AssistantRuntime | null>(null);
  const [saved] = useState(() => drafts?.session(id));
  const [chatDraft] = useState(() => createChatDraft(() => runtimeRef.current?.thread.composer, saved));
  const sessionId = state.session?.id;
  const cwd = state.session?.cwd;
  sessionRef.current = sessionId && cwd ? { id: sessionId, cwd } : undefined;
  const connected = state.connection.type === "ready";
  // Read the children on every join: a reconnect may have missed their change events.
  useEffect(() => { if (connected && sessionId) childAgents.refresh(); }, [childAgents, connected, sessionId]);
  useEffect(() => () => { childAgents.dispose(); }, [childAgents]);
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
  const [review, setReview] = useState<{ focusNoteId?: string; path?: string }>();
  const changes = useMemo(() => cwd ? { source: createChangesSource(cwd, browserTransport.request), files: createFilesSource(cwd, browserTransport.request) } : undefined, [cwd]);
  const pullRef = useMemo(() => sessionId && cwd ? { id: sessionId, cwd } : undefined, [sessionId, cwd]);
  const ownPulls = useMemo(() => catalogPulls?.filter((link) => link.session.cwd === cwd) ?? NO_LINKS, [catalogPulls, cwd]);
  const pull = useSessionPulls(pullRequests, pullRef, ownPulls);
  const [pullOpen, setPullOpen] = useState(false);
  const [pullSelected, setPullSelected] = useState<number>();
  const pullItems = pull.load.type === "ready" ? pull.load.items : [];
  const readPulls = useMemo(() => pullItems.flatMap((item) => item.pull ? [item.pull] : []), [pullItems]);
  const linkedCount = Math.max(pull.links.length, pullItems.length);
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
  const treeAvailable = state.connection.type === "ready" && !state.sending && !busy && !readOnly;
  // Only a file that exists now becomes a link. Stable, so the thread's messages do not remount.
  const fileLinks = useMemo<FileLinks | undefined>(() => cwd && changes && !readOnly ? {
    existing: existingFiles(changes.files, (path) => workspacePath(cwd, path)),
    open: (path) => setReview({ path: workspacePath(cwd, path) }),
  } : undefined, [cwd, changes, readOnly]);
  const onIdleAction = (action: "tree" | "fork") => {
    if (!treeAvailable) return;
    void send(`/${action}`).catch(() => { /* The store exposes the error. */ });
  };
  const [worktreeCommand, setWorktreeCommand] = useState<WorktreeCommand>();
  const setup = worktree?.owned ? visibleSetup(worktree.setup, state.transcript.messages.length > 0 || state.transcript.isRunning) : undefined;
  const folded = useMemo(() => foldChildEntries(foldProcessEvents(state.transcript.messages)), [state.transcript.messages]);
  const messages = useThreadMessages(folded, state.transcript.isRunning);
  const childrenAvailable = children.available === true;
  const openChildByName = useCallback((name: string) => {
    const child = childAgents.getSnapshot().children.find((candidate) => candidate.name === name);
    if (child) childAgents.open(child.conversationId);
    setChildrenOpen(true);
  }, [childAgents]);
  const systemArtifact = useCallback<SystemArtifactView>((custom) => {
    const entry = (custom as Partial<ChildEntryArtifact> | undefined)?.childEntry;
    if (entry !== undefined) return <ChildEntryView entry={entry} onAnswer={childrenAvailable && !readOnly ? childAgents.answer : undefined}
      onOpen={childrenAvailable ? openChildByName : undefined} />;
    const event = (custom as Partial<ProcessEventArtifact> | undefined)?.processEvent;
    if (event === undefined) return undefined;
    const onLoadOutput = sessionId && cwd ? () => loadProcessOutput(browserTransport.request, { id: sessionId, cwd }, event.id) : undefined;
    return <ProcessEventView event={event} onLoadOutput={onLoadOutput} />;
  }, [sessionId, cwd, childAgents, childrenAvailable, openChildByName, readOnly]);
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
        {/* Linked: always, even read-only, so a landed session still shows its pull request. Unlinked: only where the agent could still open one. */}
        {pullRef && (linkedCount > 0 || (!readOnly && pull.load.type === "ready")) && <PullRequestOpener pulls={readPulls} links={pull.links}
          onOpen={() => { pull.clearNotice(); setPullSelected(firstToShow(pullItems)); setPullOpen(true); }} />}
        {childrenAvailable && (children.children.length > 0 || childrenOpen) && <ChildAgentsOpener children={children.children}
          onOpen={() => { childAgents.refresh(); setChildrenOpen(true); }} />}
        {changes && !readOnly && <ChangesOpener notes={notes.length} onOpen={() => setReview({})} />}
        <TreeOpener idle={treeAvailable} onOpen={() => onIdleAction("tree")} />
        {archive && <ArchiveNextButton onArchive={archive.onArchive}
          // The catalog's status can lag the live one; the server refuses an archive during any run.
          availability={isBashRunning(state) || state.status?.isStreaming === true || state.status?.isCompacting === true
            ? { type: "blocked", reason: "Stop the run first" } : archive.availability} />}
        {worktree && worktrees && worktree.state.kind === "active" && <SessionMenu info={worktree} busy={busy} onCommand={setWorktreeCommand} />}
      </>}>
      <SessionDoorsProvider cwd={cwd} open={openDoor}>
      <Thread ask={ask} mentions={mentions} chatDraft={chatDraft} systemArtifact={systemArtifact}
        head={setup && <WorktreeSetupCard setup={setup} hookSeen={setup.log !== ""} branch={worktree?.branch} />}
        inputContext={<>{worktree && worktree.state.kind === "active" ? <WorktreeChip info={worktree} /> : null}
          {sessionId && cwd && relatedWork?.({ id: sessionId, cwd }, busy, catalogPulls ?? NO_LINKS, (text) => {
            const composer = runtimeRef.current?.thread.composer;
            if (composer) composer.setText([composer.getState().text, text].filter(Boolean).join("\n\n"));
          })}</>}
        readOnly={readOnly ? <WorktreeReceipt state={worktree?.state} defaultBranch={worktree?.defaultBranch}
          branch={worktree?.branch} onNew={onNewSession} /> : undefined} commands={{ catalog: state.commands, onRetry: () => void store.loadCommands() }}
        compaction={{ state: state.compaction, disabled: state.sending || state.connection.type !== "ready",
          waits: state.transcript.isRunning || isBashRunning(state),
          onSend: send, onDismiss: store.dismissCompaction }}
        shell={{ availability: shellAvailabilityOf(state), onRun: send }}
        sessionKeys={state.connection.type === "ready" && !state.sending ? {
          doubleEscapeAction: state.status?.doubleEscapeAction, onDoubleEscapeAction: onIdleAction,
          onStop: busy || (state.status?.queuedMessages.length ?? 0) > 0 ? () => { void onCancel(); } : undefined,
        } : undefined}
        queue={{ items: state.status?.queuedMessages ?? [], disabled: state.sending || state.connection.type !== "ready",
          onClear: () => { void store.clearQueue().catch(() => { /* Store exposes the error. */ }); } }}
        working={workingSend(state.status, state.compaction, state.transcript.isRunning)}
        dialog={dialog} notes={notesBinding} fileLinks={fileLinks}
        model={{ model: state.status?.model, thinkingLevel: state.status?.thinkingLevel, disabled: state.connection.type !== "ready",
          listModels: store.listModels, listThinkingLevels: store.listThinkingLevels, onModel: store.setModel, onThinkingLevel: store.setThinkingLevel,
          context: contextUse(state.status), cycle: true }}
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
      {review && changes && <ChangesReview source={changes.source} files={changes.files} notes={notes} focusNoteId={review.focusNoteId} openPath={review.path}
        onAdd={tray.add} onEdit={tray.edit} onRemove={tray.remove} onClose={() => setReview(undefined)} />}
      {childrenOpen && <ChildAgentsPanel children={children.children} openId={children.open?.conversationId}
        transcript={children.open?.transcript} error={children.error ?? children.open?.error} actions={{
          onOpenChild: childAgents.open, onBack: childAgents.close,
          onClose: () => { childAgents.close(); childAgents.dismissError(); setChildrenOpen(false); },
          onDismissError: childAgents.dismissError,
          onSend: childAgents.send, onAnswer: childAgents.answer,
          onStop: (conversationId) => { void childAgents.stop(conversationId).catch(() => { /* The panel shows the error. */ }); },
        }} />}
      {pullOpen && <PullRequestReview load={pull.load} selected={pullSelected} onSelect={setPullSelected} reading={pull.reading}
        notice={pull.notice} writing={pull.writing} now={Date.now()}
        onRefresh={pull.refresh} onWatch={(number, on) => { void pull.setWatch(number, on); }} onLink={pull.linkNumber}
        onUnlink={(number) => { void pull.unlink(number); }}
        onMerge={(number) => { void pull.merge(number, "rebase"); }} onClose={() => setPullOpen(false)}
        onAsk={(message) => { if (!readOnly) runtimeRef.current?.thread.composer.setText(message); }} />}
      {worktreeCommand && worktree && worktrees && <WorktreeDialog command={worktreeCommand} info={worktree} api={worktrees}
        onAsk={readOnly ? undefined : (prompt) => send(prompt)} onDone={() => { void refreshWorktree(); }} onClose={() => setWorktreeCommand(undefined)} />}
    </SessionFrame>
    </DictationProvider>
  </AssistantRuntimeProvider>;
}
