import type { AuthProviderOption, CommandOption, CommandResult, ExtensionDialogAnswer, ExtensionDialogCloseReason, FileContentResponse, FileTreeEntry, GitDiffResponse, GitStatusResponse, Machine, MachineHealth, MachineRuntime, OAuthFlowState, PendingAskUser, PendingExtensionDialog, PiWebStatusResponse, Project, QueuedSessionMessage, SessionActivity, SessionInfo, SessionStatus, SessionTreeSnapshot, TerminalCommandRun, Workspace, WorkspaceActivity } from "./api";
import type { ChatLine } from "./components/shared";
import type { NewSessionCompleteDestination } from "./newSessionComposer";
import type { QualifiedContributionId } from "./plugins/ids";
import type { SelectedSessionNotificationInbox } from "./sessionNotifications";
import { selectedChatNoTarget, type SelectedChatLoad } from "./selectedChatLoad";
import type { WorkspaceUploadBatchState } from "./workspaceUploadState";

// ---------------------------------------------------------------------------
// Machine-scoped global session inbox
// ---------------------------------------------------------------------------

export type GlobalSessionsProjectionStatus = "loading" | "fresh" | "stale";

/**
 * Machine-scoped projection of every session on the machine, owned by
 * {@link SessionInboxController}.
 *
 * IMPORTANT: never add this to {@link WorkspaceScopedStateReset}. The inbox
 * must survive workspace switches — that is its whole purpose. A regression
 * test in `sessionInboxController.test.ts` guards this invariant.
 */
export interface GlobalSessionsState {
  readonly machineId: string;
  readonly status: GlobalSessionsProjectionStatus;
  readonly sessions: readonly SessionInfo[];
  /**
   * Per-session statuses keyed by sessionId.
   * Seeded from the machine listing snapshot; updated by live status.update
   * events. Includes synthetic entries for sessions with pending asks or
   * dialogs from the asks catalog that are not in the listing statuses.
   */
  readonly statuses: Readonly<Record<string, SessionStatus>>;
  /**
   * Last live activity keyed by sessionId. The machine listing replaces this
   * map atomically on initial load and reconnect; activity.update events keep
   * it current between snapshots.
   */
  readonly activities: Readonly<Record<string, SessionActivity>>;
}

export interface AppState {
  machines: Machine[];
  selectedMachine: Machine | undefined;
  isLoadingMachines: boolean;
  machineStatuses: Record<string, MachineHealth>;
  machineRuntimes: Record<string, MachineRuntime>;
  projects: Project[];
  workspaces: Workspace[];
  sessions: SessionInfo[];
  messages: ChatLine[];
  messagePageStart: number;
  messagePageEnd: number;
  messagePageTotal: number;
  isLoadingEarlierMessages: boolean;
  /** Sessions with a prompt upload in flight, keyed by sessionId (client-owned). */
  sendingPrompts: Record<string, true>;
  /** Client-side queued sends waiting for a just-created backend session, keyed by sessionId. */
  clientQueuedSessionMessages: Record<string, QueuedSessionMessage[]>;
  /** Client-initiated session creation requests waiting for the server. */
  startingSessionCount: number;
  isLoadingProjects: boolean;
  isLoadingWorkspaces: boolean;
  selectedProject: Project | undefined;
  selectedWorkspace: Workspace | undefined;
  selectedSession: SessionInfo | undefined;
  selectedChatLoad: SelectedChatLoad;
  status: SessionStatus | undefined;
  activity: SessionActivity | undefined;
  /**
   * The selected session's open `ask_user` question set, derived from the
   * daemon-owned {@link SessionStatus.pendingAsk} plus live ask events.
   */
  pendingAsk: PendingAskUser | undefined;
  /**
   * The selected session's open extension dialogs, derived from the
   * daemon-owned {@link SessionStatus.pendingDialogs} plus live dialog events.
   * Oldest first; unlike an ask, opening never supersedes, so several dialogs
   * may wait at once.
   */
  pendingDialogs: PendingExtensionDialog[];
  /**
   * Dialogs that closed while their session was selected, kept with the close
   * reason and any answer so the settled card can show what became of the
   * dialog. The card stays until the user dismisses it. The wire outcome is
   * deliberately small, so only a browser that saw the dialog open can show
   * the closed card; deselection and reloads drop these.
   */
  closedDialogs: ClosedExtensionDialog[];
  /** Thinking levels available for the selected session's current model. */
  availableThinkingLevels: readonly string[];
  sessionStatuses: Record<string, SessionStatus>;
  sessionActivities: Record<string, SessionActivity>;
  workspaceActivities: Record<string, WorkspaceActivity>;
  machineActivities: Record<string, Record<string, WorkspaceActivity>>;
  /** Authoritative projection plus browser-local optimistic overlays for the selected inbox. */
  selectedNotificationInbox: SelectedSessionNotificationInbox | undefined;
  /**
   * Machine-scoped session listing for the global inbox.
   * Not workspace-scoped: workspace switches must not clear this field.
   * Owned by {@link SessionInboxController}.
   */
  globalSessions: GlobalSessionsState | undefined;
  /**
   * Active inbox archive undo toast. Set by SessionInboxController after a
   * successful server-side archive. Cleared by the controller's timer, by
   * explicit dismissal (navigation), or by dispose.
   *
   * Not workspace-scoped; survives workspace switches.
   * Owned by SessionInboxController.
   */
  inboxUndoToast: { readonly session: SessionInfo; readonly machineId: string } | undefined;
  workspacesByProjectId: Record<string, Workspace[]>;
  workspaceDeletionRuns: Record<string, TerminalCommandRun>;
  commandDialog: Extract<CommandResult, { type: "select" }> | undefined;
  treeDialog: SessionTreeSnapshot | undefined;
  modelDialog: { title: string; options: CommandOption[]; selectedValue?: string } | undefined;
  thinkingDialog: { title: string; options: CommandOption[]; selectedValue?: string } | undefined;
  themeDialog: { title: string; options: CommandOption[]; selectedValue?: string } | undefined;
  authDialog: AuthDialogState | undefined;
  /** Root-owned request. The mounted composer owns its editable draft. */
  newSessionComposer: NewSessionComposerRequest;
  /** State for the workspace-management picker dialog. */
  workspaceManagementDialog: WorkspaceManagementDialogState | undefined;
  actionPaletteOpen: boolean;
  projectDialogOpen: boolean;
  machineDialogOpen: boolean;
  workspaceTool: QualifiedContributionId;
  mainView: "navigation" | "chat" | QualifiedContributionId;
  fileTree: FileTreeEntry[];
  expandedDirs: Record<string, FileTreeEntry[]>;
  selectedFilePath: string | undefined;
  selectedFileContent: FileContentResponse | undefined;
  fileTreeStale: boolean;
  /** Manual workspace file upload batches, keyed by client-owned batch id. */
  workspaceUploadBatches: Record<string, WorkspaceUploadBatchState>;
  gitStatus: GitStatusResponse | undefined;
  selectedDiffPath: string | undefined;
  selectedDiff: GitDiffResponse | undefined;
  selectedStagedDiff: GitDiffResponse | undefined;
  gitStale: boolean;
  activeTerminalCount: number;
  selectedTerminalId: string | undefined;
  piWebStatus: PiWebStatusResponse | undefined;
  error: string;
}

/** A closed extension dialog paired with the record the browser rendered while it was open. */
export interface ClosedExtensionDialog {
  dialog: PendingExtensionDialog;
  reason: ExtensionDialogCloseReason;
  /** Present only when `reason` is `"answered"`. */
  answer?: ExtensionDialogAnswer;
}

export type NewSessionComposerRequest =
  | { kind: "closed" }
  | { kind: "open"; initialDestination?: NewSessionCompleteDestination; initialPrompt: string; replacesFailedSessionId?: string };

/** Workspace-management dialog state. Session creation uses NewSessionComposer. */
export type WorkspaceManagementDialogState =
  | { step: "project" }
  | {
      step: "workspace";
      project: Project;
      workspaces: readonly Workspace[];
      loading: boolean;
      error: string | undefined;
    };

export type AuthDialogState =
  | { step: "method" }
  | { step: "providers"; mode: "login"; authType?: "oauth" | "api_key"; providers: AuthProviderOption[] }
  | { step: "oauth"; flow: OAuthFlowState; machineId: string; responding?: boolean; inputValue?: string; error?: string }
  | { step: "logout"; providers: AuthProviderOption[] };

export type WorkspaceScopedStateReset = Pick<AppState,
  | "sessions"
  | "clientQueuedSessionMessages"
  | "startingSessionCount"
  | "selectedNotificationInbox"
  | "selectedChatLoad"
  | "treeDialog"
  | "fileTree"
  | "expandedDirs"
  | "selectedFilePath"
  | "selectedFileContent"
  | "fileTreeStale"
  | "gitStatus"
  | "selectedDiffPath"
  | "selectedDiff"
  | "selectedStagedDiff"
  | "gitStale"
  | "selectedTerminalId"
  | "error"
>;

export function resetWorkspaceScopedState(): WorkspaceScopedStateReset {
  return {
    sessions: [],
    clientQueuedSessionMessages: {},
    startingSessionCount: 0,
    selectedNotificationInbox: undefined,
    selectedChatLoad: selectedChatNoTarget(),
    treeDialog: undefined,
    fileTree: [],
    expandedDirs: {},
    selectedFilePath: undefined,
    selectedFileContent: undefined,
    fileTreeStale: false,
    gitStatus: undefined,
    selectedDiffPath: undefined,
    selectedDiff: undefined,
    selectedStagedDiff: undefined,
    gitStale: false,
    selectedTerminalId: undefined,
    error: "",
  };
}

export function initialAppState(): AppState {
  return {
    machines: [],
    selectedMachine: undefined,
    isLoadingMachines: false,
    machineStatuses: {},
    machineRuntimes: {},
    projects: [],
    workspaces: [],
    sessions: [],
    messages: [],
    messagePageStart: 0,
    messagePageEnd: 0,
    messagePageTotal: 0,
    isLoadingEarlierMessages: false,
    sendingPrompts: {},
    clientQueuedSessionMessages: {},
    startingSessionCount: 0,
    isLoadingProjects: false,
    isLoadingWorkspaces: false,
    selectedProject: undefined,
    selectedWorkspace: undefined,
    selectedSession: undefined,
    selectedChatLoad: selectedChatNoTarget(),
    status: undefined,
    activity: undefined,
    pendingAsk: undefined,
    pendingDialogs: [],
    closedDialogs: [],
    availableThinkingLevels: [],
    sessionStatuses: {},
    sessionActivities: {},
    workspaceActivities: {},
    machineActivities: {},
    selectedNotificationInbox: undefined,
    globalSessions: undefined,
    inboxUndoToast: undefined,
    workspacesByProjectId: {},
    workspaceDeletionRuns: {},
    commandDialog: undefined,
    treeDialog: undefined,
    modelDialog: undefined,
    thinkingDialog: undefined,
    themeDialog: undefined,
    authDialog: undefined,
    newSessionComposer: { kind: "closed" },
    workspaceManagementDialog: undefined,
    actionPaletteOpen: false,
    projectDialogOpen: false,
    machineDialogOpen: false,
    workspaceTool: "core:workspace.files",
    mainView: "chat",
    fileTree: [],
    expandedDirs: {},
    selectedFilePath: undefined,
    selectedFileContent: undefined,
    fileTreeStale: false,
    workspaceUploadBatches: {},
    gitStatus: undefined,
    selectedDiffPath: undefined,
    selectedDiff: undefined,
    selectedStagedDiff: undefined,
    gitStale: false,
    activeTerminalCount: 0,
    selectedTerminalId: undefined,
    piWebStatus: undefined,
    error: "",
  };
}
