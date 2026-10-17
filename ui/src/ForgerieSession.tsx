import { TerminalIcon } from "lucide-react";
import { BadgeButton } from "./ui/BadgeButton";
import { createSessionEntry, type SessionEntry } from "./sessionRegistry";
import { ProcessesPanel } from "./processes/ProcessesPanel";
import type { RelatedWorkRenderer } from "./projectGroups/relatedWork";
import { FileTextIcon } from "lucide-react";
import type { ResourceLensRenderer } from "./resources/resourceLens";
import { contextUse } from "./contextUse";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AssistantRuntimeProvider, useExternalStoreRuntime, type AppendMessage, type AssistantRuntime } from "@assistant-ui/react";
import { browserTransport, isBashRunning, NotSentError, shellAvailabilityOf } from "./sessionStore";
import type { Session, SessionModel } from "./contracts";
import { agentsApi } from "./agents/agentsApi";
import { useThreadMessages } from "./useThreadMessages";
import { foldProcessEvents } from "./processes/processEvent";
import { loadProcessOutput } from "./processes/processApi";
import { ProcessEventView } from "./processes/ProcessEventView";
import { markPosition, threadMessageIdAt, type ActionRunNoticeArtifact, type ChildEntryArtifact, type GatedActionArtifact, type OldIssueProposalArtifact, type ProcessEventArtifact, type WorkflowEntryArtifact } from "./transcript";
import type { FoundBinding, MatchBarView } from "./search/found";
import { MatchBar } from "./search/MatchBar";
import type { SystemArtifactView } from "./ui/Messages";
import { Thread } from "./ui/Thread";
import { SessionFrame } from "./ui/SessionFrame";
import { StatusChip } from "./ui/StatusChip";
import { Consequence } from "./ui/Consequence";
import { CircleAlertIcon, WifiOffIcon } from "lucide-react";
import { sessionStatus } from "./session/sessionStatus";
import { StatusDetail, type ConnectionTrouble } from "./session/StatusDetail";
import { TaskActivity } from "./session/TaskActivity";
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
import { createFilesSource, type FilesSource } from "./changes/filesSource";
import { DOCUMENT_PREVIEW_MIME_TYPES } from "@shared/workspacePreviewMime";
import { ChangesOpener, ChangesReview } from "./ui/ChangesReview";
import { markdownView } from "./ui/markdownView";
import type { MarkdownView } from "./ui/useMarkdownView";
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
import { createActionRunApi, type ActionRunLink } from "./actionRuns/actionRunApi";
import { createActionRunsStore } from "./actionRuns/actionRunsStore";
import { listTone } from "./actionRuns/actionRunModel";
import { ActionRunsPanel, type ActionRunsActions } from "./actionRuns/ActionRunsPanel";
import { PullRunsSection } from "./actionRuns/PullRunsSection";
import { ActionRunNoticeView } from "./actionRuns/ActionRunNoticeView";
import { foldChildEntries } from "./childAgents/childAgentsModel";
import { ChildAgentsOpener } from "./childAgents/ChildAgentsOpener";
import { ChildAgentsPanel } from "./childAgents/ChildAgentsPanel";
import { ChildEntryView } from "./childAgents/ChildEntryView";
import { activeRun, waitingStops, type ProposalEntry, type WorkflowInputs } from "./workflows/workflowsModel";
import { WorkflowEntryView } from "./workflows/WorkflowEntryView";
import { WorkflowOpener } from "./workflows/WorkflowOpener";
import { WorkflowPicker } from "./workflows/WorkflowPicker";
import { WorkflowSheet } from "./workflows/WorkflowSheet";
import type { ModelChoices } from "./workflows/workflowRoute";
import type { WorkerModels } from "./workflows/WorkerModelPicker";
import { DecisionsOpener } from "./decisions/DecisionsOpener";
import { DecisionsSheet } from "./decisions/DecisionsSheet";
import { flaggedCount, type DecisionLogActions } from "./decisions/decisionsModel";
import { WorkflowRunStrip } from "./workflows/WorkflowRunStrip";
import { pinKey, waitingItems, waitingLabel, waitingName } from "./waitingOnYou";
import { GatedActionCard } from "./gatedActions/GatedActionCard";
import { GatedActionsReadProblem } from "./gatedActions/GatedActionsReadProblem";
import { askerOf, type GatedActionEntry } from "./gatedActions/gatedActionsModel";
import { PinnedDock } from "./ui/PinnedDock";
import { EventLine } from "./ui/EventLine";
import { OldIssueProposalLine } from "./issues/OldIssueProposalLine";

const pullRequests = createPullRequestApi(browserTransport.request);
const NO_LINKS: readonly PullLink[] = [];
const actionRunApi = createActionRunApi(browserTransport.request);
const NO_RUN_LINKS: readonly ActionRunLink[] = [];

// Binding: the only React component that reads the Forgerie transport/store.
export function ForgerieSession({ entry: retainedEntry, visible = true, id, known, onUnread, initialDraft, initialError, drafts, onSwitchSession, archive, worktree: catalogWorktree, pullRequests: catalogPulls, actionRuns: catalogRuns, worktrees, onNewSession, relatedWork, resourceLens, found }: {
  entry?: SessionEntry | undefined;
  visible?: boolean | undefined;
  /** The search hit the reader opened in this session: a message to mark and step from, or an off-branch entry for the history tree. */
  found?: FoundBinding | undefined;
  relatedWork?: RelatedWorkRenderer | undefined;
  /** The session's Skills and prompts sheet, opened from its header menu. */
  resourceLens?: ResourceLensRenderer | undefined;
  /** The catalog's live view of this session's pull request link and watch. */
  pullRequests?: readonly PullLink[] | undefined;
  /** The catalog's live view of this session's linked Actions runs and their watches. */
  actionRuns?: readonly ActionRunLink[] | undefined;
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
  const [entry] = useState(() => retainedEntry ?? createSessionEntry(known ?? { id, cwd: "" }, browserTransport, { onUnread }));
  const { store, childAgents, processes, workflows, decisions, gated, taskActivity } = entry;
  const tasks = useSyncExternalStore(taskActivity.subscribe, taskActivity.getSnapshot);
  const processState = useSyncExternalStore(processes.subscribe, processes.getSnapshot);
  const [processesOpen, setProcessesOpen] = useState(false);
  const flows = useSyncExternalStore(workflows.subscribe, workflows.getSnapshot);
  const log = useSyncExternalStore(decisions.subscribe, decisions.getSnapshot);
  const [decisionsOpen, setDecisionsOpen] = useState(false);
  const held = useSyncExternalStore(gated.subscribe, gated.getSnapshot);
  const [workflowSheet, setWorkflowSheet] = useState<{ type: "picker" } | { type: "plan"; name: string; task?: string } | { type: "run"; runId: string }
    | { type: "proposal"; entry: ProposalEntry }>();
  const children = useSyncExternalStore(childAgents.subscribe, childAgents.getSnapshot);
  const [childrenOpen, setChildrenOpen] = useState(false);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const [dictation] = useState(() => new ForgerieDictationAdapter());
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const runtimeRef = useRef<AssistantRuntime | null>(null);
  const [saved] = useState(() => drafts?.session(id));
  const [chatDraft] = useState(() => createChatDraft(() => runtimeRef.current?.thread.composer, saved));
  const sessionId = state.session?.id;
  const cwd = state.session?.cwd;
  const connected = state.connection.type === "ready";
  const mentions = useMemo(() => sessionId && cwd ? createMentionSource({ id: sessionId, cwd }, browserTransport.request) : undefined,
    [sessionId, cwd]);
  const [attachments] = useState(() => {
    const adapter = createAttachmentAdapter(store.saveAttachment);
    entry.onDispose(adapter.dispose);
    return adapter;
  });
  const [sendError, setSendError] = useState<string | undefined>(initialError);
  useEffect(() => {
    if (retainedEntry) return;
    entry.setVisible(true); void store.start();
    return () => entry.dispose();
  }, [entry, store, retainedEntry]);
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
  const [review, setReviewState] = useState<{ focusNoteId?: string; path?: string }>();
  // Rich or Source for Markdown in the review, remembered on this device for every Markdown file.
  // Each opening reads it again, so a choice made in another view since this one mounted holds here too.
  const [reviewView, setReviewView] = useState<MarkdownView>(() => markdownView.read());
  const setReview = useCallback((next: { focusNoteId?: string; path?: string } | undefined) => {
    if (next) setReviewView(markdownView.read());
    setReviewState(next);
  }, []);
  const chooseReviewView = useCallback((view: MarkdownView) => { markdownView.write(view); setReviewView(view); }, []);
  const changes = useMemo(() => cwd ? { source: createChangesSource(cwd, browserTransport.request), files: createFilesSource(cwd, browserTransport.request) } : undefined, [cwd]);
  const filesSource = changes?.files;
  const [resolvedFileBase, setResolvedFileBase] = useState<{ source: FilesSource; result: { type: "ready"; base: string } | { type: "failed"; error: string } }>();
  const fileBaseRequested = useRef<FilesSource | undefined>(undefined);
  useEffect(() => {
    if (!filesSource || resolvedFileBase?.source === filesSource) return;
    if (fileBaseRequested.current === filesSource) return;
    fileBaseRequested.current = filesSource;
    const controller = { signal: entry.signal };
    filesSource.linkBase(controller.signal).then(
      (base) => { if (!controller.signal.aborted) setResolvedFileBase({ source: filesSource, result: { type: "ready", base: new URL(base, window.location.href).href } }); },
      (error: unknown) => { if (!controller.signal.aborted) setResolvedFileBase({ source: filesSource, result: { type: "failed", error: `File links are unavailable. ${error instanceof Error ? error.message : String(error)}` } }); },
    );
  }, [filesSource, entry.signal, resolvedFileBase?.source]);
  // Never reuse another folder's base while this folder's lookup is pending.
  const fileBase = resolvedFileBase?.source === filesSource ? resolvedFileBase?.result : undefined;
  const openLinkedFile = useCallback((path: string) => {
    const extension = /\.[^./]+$/u.exec(path)?.[0]?.toLowerCase();
    if (extension && DOCUMENT_PREVIEW_MIME_TYPES[extension] !== undefined) return false;
    if (cwd === undefined) return false;
    setReview({ path: workspacePath(cwd, path) });
    return true;
  }, [cwd]);
  const pullRef = useMemo(() => sessionId && cwd ? { id: sessionId, cwd } : undefined, [sessionId, cwd]);
  const ownPulls = useMemo(() => catalogPulls?.filter((link) => link.session.cwd === cwd) ?? NO_LINKS, [catalogPulls, cwd]);
  const pull = useSessionPulls(pullRequests, pullRef, ownPulls, entry.signal, { visible, revision: state.completedRuns });
  const [pullOpen, setPullOpen] = useState(false);
  const [pullSelected, setPullSelected] = useState<number>();
  const pullItems = pull.load.type === "ready" ? pull.load.items : [];
  const readPulls = useMemo(() => pullItems.flatMap((item) => item.pull ? [item.pull] : []), [pullItems]);
  const linkedCount = Math.max(pull.links.length, pullItems.length);
  // Actions runs: their own store, read when the pull request panel first opens, then kept current by the catalog's run events.
  const [actionRuns] = useState(() => createActionRunsStore(actionRunApi));
  const actionRunState = useSyncExternalStore(actionRuns.subscribe, actionRuns.getSnapshot);
  const ownRuns = useMemo(() => catalogRuns?.filter((link) => link.session.cwd === cwd) ?? NO_RUN_LINKS, [catalogRuns, cwd]);
  useEffect(() => { actionRuns.setSession(pullRef); }, [actionRuns, pullRef]);
  useEffect(() => { actionRuns.syncLinks(ownRuns); }, [actionRuns, ownRuns]);
  // The server does not replay events missed while the socket was down: the list route is the recovery source.
  useEffect(() => { if (connected) actionRuns.recover(); }, [actionRuns, connected]);
  // Runs under each linked pull request come with the run list: read it again when a pull request is linked or unlinked, or its head moves.
  useEffect(() => { if (pull.load.type === "ready") actionRuns.syncPulls(readPulls); }, [actionRuns, pull.load.type, readPulls]);
  useEffect(() => () => { actionRuns.dispose(); }, [actionRuns]);
  const [runsFirst, setRunsFirst] = useState(false);
  const runActions: ActionRunsActions = {
    onRefresh: actionRuns.refresh, onLink: actionRuns.link, onOpenRun: actionRuns.openDetail, onCloseRun: actionRuns.closeDetail,
    onUnlink: (key, runId) => { void actionRuns.unlink(key, runId); }, onWatch: (key, runId, on) => { void actionRuns.setWatch(key, runId, on); },
  };
  const runItems = actionRunState.load.type === "ready" ? actionRunState.load.items : [];
  /** Send a chat message with every waiting note. Only the notes it carried leave the tray, and only once Pi accepted it. */
  const sendWithNotes = useCallback(async (text: string, images: PromptAttachment[] | undefined, steer: boolean) => {
    const carried = carriesNotes(text) ? tray.notes() : [];
    applyResult(await store.send(text, images, { steer, diffAnnotations: annotationsOf(carried) }));
    tray.drop(carried.map((note) => note.id));
  }, [store, tray, applyResult]);
  const onNew = useCallback(async (message: AppendMessage) => {
    setSendError(undefined);
    // assistant-ui marks a steer on the message itself (composer.send({ steer: true })).
    // A failure that may have reached Pi is a problem in the status chip; only a refusal is a note here.
    await sendMessage(message, (text, images) => sendWithNotes(text, images, message.steer === true),
      () => runtimeRef.current?.thread.composer, (error, { mayHaveSent }) => setSendError(mayHaveSent ? undefined : error));
  }, [sendWithNotes]);
  const notesBinding: NotesBinding = {
    notes, onRemove: tray.remove, onOpen: (noteId) => setReview({ focusNoteId: noteId }),
    onSendAlone: async (steer) => {
      setSendError(undefined);
      try { await sendWithNotes("", undefined, steer); }
      catch (error) {
        // Notes never leave the tray on failure, so there is nothing to restore. The store reports a sent failure.
        if (error instanceof NotSentError) setSendError(error.message);
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
  const { info: worktree, refresh: refreshWorktree } = useSessionWorktree(worktrees, { catalog: catalogWorktree, status: state.status?.worktree }, busy, { visible, revision: state.completedRuns });
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
  const setup = worktree?.owned ? visibleSetup(worktree.setup,
    state.connection.type !== "ready" ? "loading" : state.transcript.messages.length > 0 || state.transcript.isRunning ? "live" : "empty") : undefined;
  const folded = useMemo(() => foldChildEntries(foldProcessEvents(state.transcript.messages)), [state.transcript.messages]);
  // A search hit on the branch: the thread marks the match on show and brings it into view.
  const markAt = found?.type === "message" ? found.positions[found.current] : undefined;
  useEffect(() => {
    if (markAt === undefined || !connected) return;
    void store.ensurePosition(markAt).catch((error: unknown) => {
      if (typeof error === "object" && error !== null && "status" in error && error.status === 409) found?.onRetry();
    });
  }, [store, markAt, connected, state.earlier, found]);
  const shown = useMemo(() => markPosition(folded, markAt), [folded, markAt]);
  const messages = useThreadMessages(shown, state.transcript.isRunning);
  const revealId = useMemo(() => threadMessageIdAt(shown, markAt), [shown, markAt]);
  const reveal = found && markAt !== undefined && revealId !== undefined ? { messageId: revealId, key: `${String(found.key)}:${String(markAt)}` } : undefined;
  // A search hit off the branch: the history tree opens on it, and the branch stays as it is. A writable
  // session opens it with /tree once idle, so Continue and Fork work. A read-only one reads it, to look at only.
  const [treeFor, setTreeFor] = useState<{ key: number; entryId: string; failed?: string }>();
  const treeOpen = state.tree.type === "open";
  const treeReadable = readOnly ? connected : treeAvailable;
  useEffect(() => {
    if (found?.type !== "entry" || !treeReadable || treeFor?.key === found.key) return;
    const request = { key: found.key, entryId: found.entryId };
    setTreeFor(request);
    // The store also lists the failure as a problem; the match bar says it where the reader is looking.
    void (readOnly ? store.viewTree() : store.openTree()).catch((error: unknown) => {
      setTreeFor((current) => current === request ? { ...request, failed: error instanceof Error ? error.message : String(error) } : current);
    });
  }, [found, treeReadable, readOnly, treeFor, store]);
  useEffect(() => {
    if (treeOpen && found?.type === "entry" && treeFor?.key === found.key) found.onOpened();
    // A tree the reader opens later starts where it always does.
    else if (!treeOpen && treeFor && found?.key !== treeFor.key) setTreeFor(undefined);
  }, [treeOpen, found, treeFor]);
  const matchBar: MatchBarView | undefined = found?.type === "message"
    ? { type: "ready", current: found.current, total: found.positions.length, missing: connected && revealId === undefined }
    : found?.type === "pending" ? found.state
    : found?.type === "entry" && treeFor?.key === found.key && treeFor.failed !== undefined ? { type: "treeFailed", message: treeFor.failed }
    : found?.type === "entry" && treeFor?.key !== found.key && connected && !treeReadable ? { type: "waiting" } : undefined;
  // Retry on a failed tree asks for it again; every other retry reads the matches again.
  const retryFound = matchBar?.type === "treeFailed" ? () => setTreeFor(undefined) : found?.onRetry;
  const childrenAvailable = children.available === true;
  const openChildByName = useCallback((name: string) => {
    const child = childAgents.getSnapshot().children.find((candidate) => candidate.name === name);
    if (child) childAgents.open(child.conversationId);
    setChildrenOpen(true);
  }, [childAgents]);
  const runs = flows.runs;
  const deciding = flows.deciding;
  // What waits on the reader is pinned above the composer; its place in the thread keeps one quiet line.
  const proposals = flows.proposals;
  const records = held.records;
  // A failed read must not hide a real wait: the transcript's gated actions pin unless a record says they were decided.
  const gatedReadFailed = held.readError !== undefined;
  const waiting = useMemo(() => readOnly ? [] : waitingItems(folded, runs, proposals, { records, readFailed: gatedReadFailed }),
    [folded, runs, proposals, records, gatedReadFailed, readOnly]);
  const pinned = useMemo(() => new Set(waiting.map(pinKey)), [waiting]);
  // A gated action's card renders from its entry at once; the session's record says what became of it.
  const gatedView = useCallback((entry: GatedActionEntry, key?: string) => <GatedActionCard key={key} entry={entry}
    record={records?.find((record) => record.id === entry.id)} read={records !== undefined && !gatedReadFailed}
    deciding={held.deciding?.id === entry.id ? held.deciding.choice : undefined}
    problem={held.error?.id === entry.id ? held.error.message : undefined}
    onApprove={readOnly ? undefined : () => { void gated.approve(entry.id); }}
    onRefuse={readOnly ? undefined : () => { void gated.refuse(entry.id); }} />, [records, gatedReadFailed, held.deciding, held.error, readOnly, gated]);
  // A proposal card renders from its entry at once; the session's record decides whether it is still open.
  const proposalView = useCallback((entry: ProposalEntry, key?: string) => <WorkflowEntryView key={key} entry={entry}
    proposal={proposals?.find((candidate) => candidate.id === entry.proposalId)} proposalsRead={proposals !== undefined}
    onReviewProposal={readOnly ? undefined : () => setWorkflowSheet({ type: "proposal", entry })} />, [proposals, readOnly]);
  const renderWaiting = useCallback((item: (typeof waiting)[number]) => item.kind === "question"
    ? <ChildEntryView key={item.id} entry={item.entry} onAnswer={childrenAvailable ? childAgents.answer : undefined} onOpen={childrenAvailable ? openChildByName : undefined} />
    : item.kind === "proposal" ? proposalView(item.entry, item.id)
    : item.kind === "gated" ? gatedView(item.entry, item.id)
    : <WorkflowEntryView key={item.id} entry={item.entry} run={runs.find((run) => run.id === item.entry.runId)} deciding={deciding === `${item.entry.runId}/${item.entry.stage}`}
      onDecide={(decision, note) => workflows.decide(item.entry.runId, item.entry.stage, decision, note)}
      onReview={childrenAvailable ? () => { childAgents.refresh(); setChildrenOpen(true); } : undefined} />, [childrenAvailable, childAgents, openChildByName, runs, deciding, workflows, proposalView, gatedView]);
  const systemArtifact = useCallback<SystemArtifactView>((custom) => {
    const flow = (custom as Partial<WorkflowEntryArtifact> | undefined)?.workflowEntry;
    if (flow?.kind === "proposal") return pinned.has(`p:${flow.proposalId}`)
      ? <EventLine tone="active" subject={flow.name} phrase="waits for your review, pinned below the thread" /> : proposalView(flow);
    if (flow?.kind === "stop" && pinned.has(`s:${flow.runId}/${flow.stage}/${String(flow.round)}`)) {
      return <EventLine tone="active" subject={flow.stageName} phrase="waits for your decision, pinned below the thread" />;
    }
    if (flow !== undefined) {
      const run = flow.kind === "decided" ? undefined : runs.find((candidate) => candidate.id === flow.runId);
      const stop = flow.kind === "stop" ? flow : undefined;
      return <WorkflowEntryView entry={flow} run={run} deciding={stop !== undefined && deciding === `${stop.runId}/${stop.stage}`}
        onDecide={stop !== undefined && !readOnly ? (decision, note) => workflows.decide(stop.runId, stop.stage, decision, note) : undefined}
        onReview={childrenAvailable ? () => { childAgents.refresh(); setChildrenOpen(true); } : undefined} />;
    }
    const action = (custom as Partial<GatedActionArtifact> | undefined)?.gatedAction;
    if (action !== undefined) return pinned.has(`g:${action.id}`)
      ? <EventLine tone="active" subject={askerOf(action.by)} phrase="waits for your approval, pinned below the thread" quoteFace="text" quote={action.description} />
      : gatedView(action);
    // An issue proposal from before agents filed issues: its card is gone, and one line says what became of it.
    const oldIssue = (custom as Partial<OldIssueProposalArtifact> | undefined)?.oldIssueProposal;
    if (oldIssue !== undefined) return <OldIssueProposalLine proposal={oldIssue} />;
    const entry = (custom as Partial<ChildEntryArtifact> | undefined)?.childEntry;
    if (entry?.kind === "question" && pinned.has(`q:${entry.questionId}`)) {
      return <EventLine tone="active" subject={`${entry.childName} asks`} phrase="pinned below the thread" />;
    }
    if (entry !== undefined) return <ChildEntryView entry={entry} onAnswer={childrenAvailable && !readOnly ? childAgents.answer : undefined}
      onOpen={childrenAvailable ? openChildByName : undefined} />;
    const runNotice = (custom as Partial<ActionRunNoticeArtifact> | undefined)?.actionRunNotice;
    if (runNotice !== undefined) return <ActionRunNoticeView notice={runNotice} />;
    const event = (custom as Partial<ProcessEventArtifact> | undefined)?.processEvent;
    if (event === undefined) return undefined;
    const onLoadOutput = sessionId && cwd ? () => loadProcessOutput(browserTransport.request, { id: sessionId, cwd }, event.id) : undefined;
    return <ProcessEventView event={event} onLoadOutput={onLoadOutput} />;
  }, [sessionId, cwd, childAgents, childrenAvailable, openChildByName, readOnly, runs, deciding, workflows, pinned, proposalView, gatedView]);
  const running = activeRun(runs);
  // Flagged guesses never pin in the dock and never ask for a response; the header counts them quietly.
  // Before the log is read, the session's status says how many there are.
  const flagged = log.decisions === undefined ? state.status?.flaggedDecisions ?? 0 : flaggedCount(log.decisions);
  const logActions: DecisionLogActions = {
    onRetry: () => { void decisions.retry(); }, onDismissError: decisions.dismissError,
    // A landed or discarded session has no agent left to take a correction.
    onOverturn: readOnly ? undefined : decisions.overturn,
    onConfirm: readOnly ? undefined : decisions.confirm,
  };
  const startWorkflow = async (name: string, inputs: WorkflowInputs, task: string | undefined, models: ModelChoices | undefined) => {
    if (!await workflows.launch(name, inputs, models)) return;
    setWorkflowSheet(undefined);
    // The task came from the composer: it now lives in the run, so the draft would only repeat it.
    const composer = runtimeRef.current?.thread.composer;
    if (task !== undefined && composer !== undefined && composer.getState().text === task) composer.setText("");
  };
  const workflowBlock = running !== undefined ? "Finish the running workflow before you start another."
    : busy ? "Wait for the agent to finish its turn." : undefined;
  const proposalBlock = running !== undefined ? "Another workflow is running." : busy ? "Wait for the agent to finish its turn." : undefined;
  // A workflow sheet's pickers offer the session's models, and the route names them; a new worker can run as any listed agent.
  const sheetOpen = workflowSheet !== undefined && workflowSheet.type !== "picker";
  const [sessionModels, setSessionModels] = useState<readonly SessionModel[]>([]);
  const [agentNames, setAgentNames] = useState<readonly string[]>([]);
  useEffect(() => {
    if (!sheetOpen) return;
    const controller = new AbortController();
    store.listModels(controller.signal).then((models) => { if (!controller.signal.aborted) setSessionModels(models); }, () => undefined);
    if (workflowSheet?.type === "proposal") agentsApi.list(controller.signal, browserTransport.request).then((list) => {
      if (!controller.signal.aborted) setAgentNames([...new Set(list.agents.filter((agent) => agent.advertise && !agent.disabled && agent.broken === undefined).map((agent) => agent.name))].sort());
    }, () => undefined);
    return () => controller.abort();
  }, [sheetOpen, workflowSheet?.type, store]);
  const workerModels = useMemo<WorkerModels>(() => ({ known: sessionModels, list: store.listModels }), [sessionModels, store]);
  const sheetRun = workflowSheet?.type === "run" ? runs.find((run) => run.id === workflowSheet.runId) : undefined;
  /** Closes the proposal's sheet once its decision went through, unless the reader already moved on. */
  const closeProposal = (id: string) => setWorkflowSheet((current) => current?.type === "proposal" && current.entry.proposalId === id ? undefined : current);
  const runtime = useExternalStoreRuntime({
    messages, onNew, onCancel, hasEarlier: state.earlier.type !== "complete", onLoadEarlier: store.loadEarlier, adapters: { dictation, attachments },
    isRunning: state.transcript.isRunning,
    isLoading: state.connection.type === "loading",
    // The message box stays open while the connection recovers: a message sent then waits for the join.
    isDisabled: false,
    isSendDisabled: state.sending || state.connection.type === "failed",
  });
  useEffect(() => { runtimeRef.current = runtime; return () => { runtimeRef.current = null; }; }, [runtime]);
  // Bring back the saved chat draft, then save every change. A fork's prompt draft, set next, replaces it.
  useEffect(() => {
    if (!saved) return;
    chatDraft.hydrate(saved.chat());
    return runtime.thread.composer.subscribe(chatDraft.sync);
  }, [runtime, chatDraft, saved]);
  const initialDraftApplied = useRef(false);
  useEffect(() => {
    if (initialDraftApplied.current) return;
    initialDraftApplied.current = true;
    if (initialDraft !== undefined) runtime.thread.composer.setText(initialDraft);
  }, [initialDraft, runtime]);
  // Once joined, the store names the open ask. Answers saved for any other ask can never be sent.
  const openAskId = state.ask.type === "open" ? state.ask.ask.askId : undefined;
  const joined = state.connection.type === "ready";
  useEffect(() => { if (joined) saved?.keepAnswers(openAskId); }, [saved, joined, openAskId]);
  const dialogs = state.status?.pendingDialogs ?? [];
  const connection = state.connection;
  const problems = state.problems;
  const status = sessionStatus({
    readOnly: readOnly ? worktree?.state.kind === "landed" ? "Landed" : worktree?.state.kind === "discarded" ? "Discarded" : "Read-only" : undefined,
    connection: connection.type, dialogOpen: dialogs.length > 0, askOpen: state.ask.type === "open", sending: state.sending,
    compaction: state.compaction.type === "running" ? "running" : state.compaction.type === "queued" ? "queued" : "idle",
    running: state.transcript.isRunning, shellRunning: isBashRunning(state), problems: problems.length,
    tasks: tasks.activity?.kind === "unsupported" ? "unsupported"
      : { live: tasks.activity?.tasks.length ?? 0, backgroundAgents: tasks.activity?.backgroundAgents ?? 0, readFailed: tasks.error !== undefined },
  });
  const clipboard = typeof navigator.clipboard?.writeText === "function" ? (text: string) => navigator.clipboard.writeText(text) : undefined;
  const trouble: ConnectionTrouble | undefined = connection.type === "reconnecting"
    ? { type: "reconnecting", reason: connection.message, attempt: connection.attempt, retryAt: connection.retryAt, lastReadyAt: state.lastReadyAt }
    : connection.type === "failed" ? { type: "failed", reason: connection.message } : undefined;
  const statusChip = <StatusChip label={status.label} tone={status.tone} aside={status.aside} asideLabel={status.asideLabel}
    count={status.count} countLabel={status.countLabel} ring={problems[0]?.id} panel={status.hasDetail ? {
      title: status.label,
      actions: problems.length > 1 ? [{ label: "Dismiss all", onPress: store.dismissProblems }] : [],
      onOpen: taskActivity.refresh,
      children: <>
        <StatusDetail connection={trouble} problems={problems} draftSaved={saved !== undefined}
          onTryNow={store.retryNow} onReload={() => window.location.reload()} onDismiss={store.dismissProblem}
          onCopy={clipboard && ((text) => { void clipboard(text).catch(() => undefined); })} />
        {!readOnly && <TaskActivity view={tasks} running={state.transcript.isRunning} onRetry={taskActivity.retry} onCopy={clipboard} />}
      </>,
    } : undefined} />;
  const oldestDialog = dialogs[0];
  const dialog: DialogBinding | undefined = oldestDialog && {
    dialog: oldestDialog, count: dialogs.length, phase: phaseFor(state.dialogPhase, oldestDialog.dialogId),
    offline: state.connection.type !== "ready",
    onAnswer: (value) => void store.answerDialog(oldestDialog.dialogId, value),
    onCancel: () => void store.cancelDialog(oldestDialog.dialogId),
  };
  /** Commands on the session itself, first in its header menu. */
  const sessionCommands = resourceLens && sessionId && cwd
    ? [{ label: "Skills and prompts", icon: <FileTextIcon aria-hidden />, onSelect: () => setResourcesOpen(true) }] : [];
  /** Adds text after the draft, as a new paragraph. Related worktrees use it for review notes and failures. */
  const appendToDraft = (text: string) => {
    const composer = runtimeRef.current?.thread.composer;
    if (composer) composer.setText([composer.getState().text, text].filter(Boolean).join("\n\n"));
  };
  const ask: AskBinding | undefined = state.ask.type === "open" ? {
    ask: state.ask.ask, phase: state.ask.phase, offline: state.connection.type !== "ready",
    onSubmit: (answers) => void store.submitAsk(answers), onDismiss: () => void store.dismissAsk(),
    onChat: send, answers: saved,
  } : undefined;

  return <AssistantRuntimeProvider runtime={runtime}>
    {visible && processesOpen && <ProcessesPanel state={processState} onSelect={processes.select} onStop={processes.stop} onWrite={processes.write}
      onRefresh={processes.refresh} onClose={() => setProcessesOpen(false)} onAsk={readOnly ? undefined : appendToDraft} />}
    <DictationProvider adapter={dictation}>
    <SessionFrame name={state.session?.name ?? "Session"} status={visible ? statusChip : undefined}
      actions={<>
        {/* A landed or discarded worktree has no folder left to diff. */}
        {/* Linked: always, even read-only, so a landed session still shows its pull request. Unlinked: only where the agent could still open one. */}
        {pullRef && (linkedCount > 0 || ownRuns.length > 0 || (!readOnly && pull.load.type === "ready")) && <PullRequestOpener pulls={readPulls} links={pull.links}
          onOpen={() => { pull.clearNotice(); actionRuns.clearNotice(); actionRuns.open(); setRunsFirst(linkedCount === 0 && ownRuns.length > 0);
            setPullSelected(firstToShow(pullItems)); setPullOpen(true); }} />}
        {childrenAvailable && !readOnly && <WorkflowOpener waiting={waitingStops(running)} running={running !== undefined}
          onOpen={() => { void workflows.readSaved(); setWorkflowSheet({ type: "picker" }); }} />}
        {/* Like the child agents, the log's button appears once there is something in it. A failed read shows it too:
            the sheet is where the reader sees why and retries. */}
        {childrenAvailable && ((log.decisions?.length ?? 0) > 0 || flagged > 0 || log.readError !== undefined || decisionsOpen) && <DecisionsOpener flagged={flagged}
          onOpen={() => { decisions.refresh(); setDecisionsOpen(true); }} />}
        {childrenAvailable && (children.children.length > 0 || childrenOpen) && <ChildAgentsOpener children={children.children}
          onOpen={() => { childAgents.refresh(); setChildrenOpen(true); }} />}
        {sessionId && !readOnly && <BadgeButton icon={<TerminalIcon aria-hidden />} label="Managed processes"
          count={processState.view.kind === "ready" ? processState.view.snapshot.processes.filter(item => item.status === "running").length : 0}
          onPress={() => { processes.refresh(); setProcessesOpen(true); }} />}
        {changes && !readOnly && <ChangesOpener notes={notes.length} onOpen={() => setReview({})} />}
        <TreeOpener idle={treeAvailable} onOpen={() => onIdleAction("tree")} />
        {archive && <ArchiveNextButton onArchive={archive.onArchive}
          // The catalog's status can lag the live one; the server refuses an archive during any run.
          availability={isBashRunning(state) || state.status?.isStreaming === true || state.status?.isCompacting === true
            ? { type: "blocked", reason: "Stop the run first" } : archive.availability} />}
        {sessionId && cwd && relatedWork ? relatedWork({ visible, ref: { id: sessionId, cwd, completionRevision: state.completedRuns }, busy, links: catalogPulls ?? NO_LINKS, onAsk: appendToDraft, commands: sessionCommands,
          own: worktree && worktrees && worktree.state.kind === "active" ? { info: worktree, onCommand: setWorktreeCommand } : undefined })
          : visible ? <SessionMenu info={worktree && worktrees && worktree.state.kind === "active" ? worktree : undefined} busy={busy} onCommand={setWorktreeCommand} commands={sessionCommands} /> : null}
      </>}>
      <SessionDoorsProvider cwd={cwd} open={openDoor}>
      <Thread earlier={state.earlier} followTail={!state.transcript.isRunning && state.connection.type !== "loading"} ask={ask} mentions={mentions} chatDraft={chatDraft} systemArtifact={systemArtifact}
        reveal={reveal}
        beforeComposer={<>
          {found && matchBar && <MatchBar view={matchBar} onClose={found.onClose} onRetry={retryFound ?? (() => undefined)}
            onStep={found.type === "message" ? found.onStep : () => undefined} />}
          {state.waitingToSend && !readOnly && <Consequence icon={<WifiOffIcon />}><p role="status">Reconnecting. Your message sends when the connection returns.</p></Consequence>}
          {sendError && !readOnly && <Consequence tone="warn" icon={<CircleAlertIcon />}><p role="alert">{sendError}</p></Consequence>}
          {flows.error !== undefined && workflowSheet === undefined && !readOnly && <Consequence tone="warn" icon={<CircleAlertIcon />}><p role="alert">{flows.error}</p></Consequence>}
          {waiting.length > 0 && <PinnedDock label={waitingLabel(waiting.length)}
            names={waiting.map(waitingName)} keys={waiting.map(pinKey)}>
            {waiting.map(renderWaiting)}
            {/* After the cards, so a short dock still shows the first card's choices without a scroll. */}
            {held.readError !== undefined && waiting.some((item) => item.kind === "gated")
              && <GatedActionsReadProblem error={held.readError} onRetry={() => { void gated.retry(); }} />}
          </PinnedDock>}
          {running !== undefined && <WorkflowRunStrip run={running} onOpen={() => setWorkflowSheet({ type: "run", runId: running.id })} />}
        </>}
        head={setup && <WorktreeSetupCard setup={setup} hookSeen={setup.log !== ""} branch={worktree?.branch} />}
        inputContext={worktree && worktree.state.kind === "active" ? <WorktreeChip info={worktree} /> : null}
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
        dialog={visible ? dialog : undefined} notes={notesBinding} fileLinks={fileLinks}
        linkBase={fileBase?.type === "ready" ? fileBase.base : null} linkError={fileBase?.type === "failed" ? fileBase.error : undefined}
        onOpenFile={readOnly ? undefined : openLinkedFile}
        model={{ model: state.status?.model, thinkingLevel: state.status?.thinkingLevel, disabled: state.connection.type !== "ready",
          listModels: store.listModels, listThinkingLevels: store.listThinkingLevels, onModel: store.setModel, onThinkingLevel: store.setThinkingLevel,
          context: contextUse(state.status), cycle: true }}
        commandResult={state.commandResult ? {
          result: state.commandResult, disabled: state.sending || state.connection.type !== "ready",
          onChoose: (requestId, value) => { void store.respondToCommand(requestId, value).then(applyResult).catch(() => { /* Store exposes the error and keeps the choices. */ }); },
          onClose: store.dismissCommand,
        } : undefined} />
      </SessionDoorsProvider>
      {visible && state.tree.type === "open" && <SessionTreeNavigator tree={state.tree.tree} operation={state.tree.operation} initialSelectedId={treeFor?.entryId}
        readOnly={readOnly ? "This session is read-only. Its history shows here, and nothing in it can move or fork." : undefined}
        onContinue={(targetId, summary) => { void store.continueTree(targetId, summary).then(applyTree); }}
        onFork={(entryId) => { void store.forkTree(entryId).then(applyTree); }}
        onAbort={() => { void store.abortTree(); }} onClose={store.closeTree} />}
      {visible && review && changes && <ChangesReview source={changes.source} files={changes.files} notes={notes} focusNoteId={review.focusNoteId} openPath={review.path}
        onAdd={tray.add} onEdit={tray.edit} onRemove={tray.remove} onClose={() => setReview(undefined)}
        markdownView={reviewView} onMarkdownView={chooseReviewView} />}
      {visible && resourcesOpen && sessionId && cwd && resourceLens?.({ id: sessionId, cwd, onClose: () => setResourcesOpen(false) })}
      {visible && childrenOpen && <ChildAgentsPanel children={children.children} openId={children.open?.conversationId}
        transcript={children.open?.transcript} error={children.error ?? children.open?.error}
        drafts={{ values: children.drafts ?? {}, update: childAgents.updateDraft }}
        detail={children.detail} pending={children.pending} outcome={children.outcome} runs={children.runs} actions={{
          onReview: (id) => { void childAgents.review(id); }, onLand: (id) => { void childAgents.land(id); },
          onPreviewDiscard: (id) => { void childAgents.previewDiscard(id); }, onDiscard: (id, token) => { void childAgents.discard(id, token); },
          onContinue: childAgents.continue,
          onRuns: () => { void childAgents.openRuns(); }, onCleanup: () => { void childAgents.openCleanup(); },
          onRetryDetail: () => { void childAgents.retryDetail(); },
          onBackDetail: childAgents.dismissDetail, onDismissOutcome: childAgents.dismissOutcome,
          onOpenChild: childAgents.open, onBack: childAgents.close,
          onClose: () => { childAgents.close(); childAgents.dismissError(); setChildrenOpen(false); },
          onDismissError: childAgents.dismissError,
          onSend: childAgents.send, onAnswer: childAgents.answer,
          onStop: (conversationId) => { void childAgents.stop(conversationId).catch(() => { /* The panel shows the error. */ }); },
        }} />}
      {visible && workflowSheet?.type === "picker" && <WorkflowPicker saved={flows.saved ?? []} broken={flows.broken} loading={flows.saved === undefined}
        error={flows.error} onClose={() => { workflows.dismissError(); setWorkflowSheet(undefined); }}
        onChoose={(name) => {
          const draft = runtimeRef.current?.thread.composer.getState().text.trim();
          setWorkflowSheet({ type: "plan", name, ...(draft === undefined || draft === "" ? {} : { task: draft }) });
        }} />}
      {visible && workflowSheet?.type === "plan" && (() => {
        const workflow = flows.saved?.find((candidate) => candidate.name === workflowSheet.name);
        return workflow && <WorkflowSheet mode="start" source={{ kind: "saved", workflow, initialTask: workflowSheet.task }} blocked={workflowBlock}
          pending={flows.launching === true ? "start" : undefined} error={flows.error} models={workerModels}
          onStart={(inputs, models) => { void startWorkflow(workflow.name, inputs, workflowSheet.task, models); }}
          onBack={() => { workflows.dismissError(); setWorkflowSheet({ type: "picker" }); }}
          onClose={() => { workflows.dismissError(); setWorkflowSheet(undefined); }} />;
      })()}
      {visible && workflowSheet?.type === "proposal" && (() => {
        const id = workflowSheet.entry.proposalId;
        return <WorkflowSheet mode="start" key={id} source={{ kind: "proposal", entry: workflowSheet.entry, proposal: proposals?.find((candidate) => candidate.id === id),
          readError: flows.proposalsError }} blocked={proposalBlock} pending={flows.proposing?.id === id ? flows.proposing.action : undefined} error={flows.error}
          models={workerModels} agents={agentNames}
          onRetry={() => { void workflows.retryProposals(); }}
          onStart={(inputs, models) => { void workflows.startProposal(id, inputs, models).then((done) => { if (done) closeProposal(id); }); }}
          onChanges={async (note) => { const done = await workflows.askProposalChanges(id, note); if (done) closeProposal(id); return done; }}
          onDismiss={() => { void workflows.dismissProposal(id).then((done) => { if (done) closeProposal(id); }); }}
          onHere={(inputs) => { void workflows.doProposalHere(id, inputs).then((done) => { if (done) closeProposal(id); }); }}
          onClose={() => { workflows.dismissError(); setWorkflowSheet(undefined); }} />;
      })()}
      {visible && sheetRun !== undefined && <WorkflowSheet mode="run" key={sheetRun.id} run={sheetRun}
        looks={children.children.map((child) => ({ name: child.name, agent: child.agent, branch: child.worktree?.branch, asking: child.questions.length > 0,
          busy: child.busy, retry: child.retry, conversationId: child.conversationId }))}
        record={children.open === undefined ? undefined : { transcript: children.open.transcript, readError: children.open.error, error: children.error }}
        models={workerModels} deciding={flows.deciding?.startsWith(`${sheetRun.id}/`) === true} error={flows.error} decisions={{ log, actions: logActions }}
        onDecide={(stage, decision, note) => workflows.decide(sheetRun.id, stage, decision, note)}
        cancelling={flows.cancelling === sheetRun.id} onStopRun={() => workflows.cancel(sheetRun.id)}
        onReview={childrenAvailable ? () => { childAgents.close(); setWorkflowSheet(undefined); childAgents.refresh(); setChildrenOpen(true); } : undefined}
        onOpenWorker={(conversationId) => { if (conversationId === undefined) childAgents.close(); else childAgents.open(conversationId); }}
        onRetryRecord={(conversationId) => { childAgents.close(); childAgents.open(conversationId); }}
        onSteer={(conversationId, text) => childAgents.send(conversationId, text)}
        onStopWorker={(conversationId) => { void childAgents.stop(conversationId).catch(() => { /* The pane shows the error. */ }); }}
        onDismissRecordError={childAgents.dismissError}
        onModel={(worker, model) => workflows.setWorkerModel(sheetRun.id, worker, model)}
        onClose={() => { decisions.dismissError(); workflows.dismissError(); childAgents.close(); setWorkflowSheet(undefined); }} />}
      {visible && decisionsOpen && <DecisionsSheet log={log} actions={logActions} onClose={() => { decisions.dismissError(); setDecisionsOpen(false); }} />}
      {visible && pullOpen && <PullRequestReview discovery={pull.discovery} load={pull.load} selected={pullSelected} onSelect={setPullSelected} reading={pull.reading}
        notice={pull.notice} writing={pull.writing} now={Date.now()}
        onRefresh={() => { pull.refresh(); actionRuns.recover(); }} onWatch={(number, on) => { void pull.setWatch(number, on); }} onLink={pull.linkNumber}
        onUnlink={(number) => { void pull.unlink(number); }}
        onMerge={(number) => { void pull.merge(number, "rebase"); }} onClose={() => setPullOpen(false)}
        onAsk={(message) => { if (!readOnly) runtimeRef.current?.thread.composer.setText(message); }}
        extraView={{ label: "Actions", title: "Workflow runs", tone: listTone(runItems.map((item) => item.run)), first: runsFirst,
          onRefresh: actionRuns.refresh, content: <ActionRunsPanel state={actionRunState} now={Date.now()} readOnly={readOnly} actions={runActions} /> }}
        belowPull={(number) => <PullRunsSection number={number} state={actionRunState} now={Date.now()} readOnly={readOnly}
          onWatch={runActions.onWatch} onRefresh={actionRuns.refresh} />} />}
      {visible && worktreeCommand && worktree && worktrees && <WorktreeDialog command={worktreeCommand} info={worktree} api={worktrees}
        onAsk={readOnly ? undefined : (prompt) => send(prompt)} onDone={() => { void refreshWorktree(); }} onClose={() => setWorktreeCommand(undefined)} />}
    </SessionFrame>
    </DictationProvider>
  </AssistantRuntimeProvider>;
}
