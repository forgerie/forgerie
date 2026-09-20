import { LitElement, html, type TemplateResult } from "lit";
import { keyed } from "lit/directives/keyed.js";

import { customElement, query, state } from "lit/decorators.js";
import { configApi, effectiveWorkspaceUploadFolder, sessionsApi, terminalsApi, workspacesApi, workspaceEffectiveUploadFolder, type ExtensionDialogAnswer, type Machine, type MachineHealth, type PiWebConfigValues, type PiWebPluginConfigMap, type PiWebShortcutConfig, type Project, type SessionCleanupExecuteResponse, type SessionCleanupPreviewResponse, type SessionCleanupRequest, type SessionInfo, type SessionTreeForkResult, type SessionTreeNavigateResult, type SessionTreeSummaryChoice, type TerminalCommandRun, type TerminalUiEvent, type Workspace } from "../api";
import type { AppAction } from "../actions";
import type { AskDraftSubmission } from "../askDrafts";
import { appFullscreenAction } from "../appFullscreen";
import { initialAppState, type AppState, type GlobalSessionsState } from "../appState";
import { createInboxLocationResolver } from "../inboxLocation";
import { completeNewSessionDestination, createApiNewSessionDestinationCatalog, isNewSessionMachineAvailable, type NewSessionCompleteDestination, type NewSessionDestinationCatalog, type NewSessionLaunchIntent, type NewSessionLaunchMode, type NewSessionSubmissionOutcome } from "../newSessionComposer";
import { sessionPathsEqual } from "../sessionPaths";
import { isSessionActive } from "../../../shared/activity";
import { KEYBOARD_SHORTCUT_CONTEXTS } from "../../../shared/shortcutContexts";
import { PI_WEB_CAPABILITIES, supportsPiWebCapability } from "../../../shared/capabilities";
import type { ManagedProcessesSnapshot } from "../../../shared/apiTypes";
import { ActivityController } from "../controllers/activityController";
import { AuthController } from "../controllers/authController";
import { FileExplorerController } from "../controllers/fileExplorerController";
import { GitController } from "../controllers/gitController";
import { MachineController } from "../controllers/machineController";
import { ProjectController } from "../controllers/projectController";
import { ProjectActivityOwnershipCoordinator } from "../controllers/projectActivityOwnershipCoordinator";
import { PiWebStatusController } from "../controllers/piWebStatusController";
import type { ComposerCapabilities, ComposerDictationCapability } from "../composerCapabilities";
import { composerBranchIdentity } from "../composerIdentity";
import { isClientPendingStartSessionInfo, SessionController, type SessionLaunchRecovery, type SessionLaunchRecoveryDraftSnapshot, type SessionTranscriptPreview } from "../controllers/sessionController";
import { SessionInboxController } from "../controllers/sessionInboxController";
import { SessionNotificationController } from "../controllers/sessionNotificationController";
import { WorkspaceController, canDeleteWorkspace } from "../controllers/workspaceController";
import { emptyMachineNavigationSnapshot, machineNavigationSnapshotFromState, routeFromMachineNavigationSnapshot, SessionStorageMachineNavigationMemory, type MachineNavigationSnapshot, type WorkspaceRouteSurface } from "../controllers/machineNavigationMemory";
import { SessionStorageSessionSelectionMemory } from "../controllers/sessionSelection";
import { SessionStorageTerminalSelectionMemory } from "../controllers/terminalSelection";
import { SessionStorageWorkspaceSelectionMemory } from "../controllers/workspaceSelection";
import { KeyboardShortcutDispatcher } from "../keyboardShortcuts";
import { selectedMachineId } from "../controllers/types";
import { isKeyEventInEditableContext, keyboardShortcutContextForEvent } from "../keyboardContext";
import { initialInboxDensity, writeInboxDensityPreference, type InboxDensity } from "../inboxDensity";
import { observeInputMode } from "../inputMode";
import { machineSessionKey } from "../machineKeys";
import { createManagedProcessesRuntime } from "../managedProcessesRuntime";
import type { ManagedProcessesBrowserEvent, ManagedProcessesRuntime } from "../../../plugin-api/unstable";
import { resolveParentSessionLocation, resolveSessionLocation, type ParentSessionLocation } from "../parentSessionLocation";
import { promptHistoryEntries } from "../promptHistory";
import { sessionCleanupRequestKey } from "../sessionCleanupUi";
import { selectedNotificationView } from "../sessionNotifications";
import { createChatOpenTiming } from "../chatOpenTiming";
import { checkSpeechTurn, getSpeechStatus, transcribeSpeech } from "../api/speech";
import { createSpeechCaptureSession } from "../speechCapture";
import { selectedChatCanUseRuntime, selectedChatLoading, selectedChatPreviewReadable, selectedChatTarget, selectedChatTargetsEqual, type SelectedChatLoad } from "../selectedChatLoad";
import { SessionUnreadController } from "../sessionUnread";
import { deriveUnreadPresence, EMPTY_UNREAD_PRESENCE, sameUnreadPresence, type UnreadPresence } from "../unreadPresence";
import { initialSessionWarningVisibilityState, reconcileSessionWarningVisibility, toggleSessionWarnings } from "../sessionWarningVisibility";
import { RealtimeSocket, type BrowserRealtimeEvent } from "../sessionSocket";
import type { InboxShelfContext, PiWebPluginRegistration, PluginMachine, PluginPromptEditor, QualifiedContributionId, QualifiedThemeContribution, QualifiedThemePairContribution, QualifiedWorkspacePanelContribution, PluginRuntimeContext, TerminalCommandRunsInternalRuntime, WorkspaceFiles, WorkspaceHost, WorkspaceLabelContext, WorkspaceLabelItem, WorkspacePanelContext } from "../plugins/types";
import { CLASSIC_THEME_ID, DEFAULT_THEME_PREFERENCE, applyPiWebTheme, findThemePairForTheme, readStoredThemePreference, resolveThemePreference, writeStoredThemePreference, type ThemePreference, type ThemePreferenceResolution } from "../theme";
import { corePlugin } from "../plugins/core";
import { themePackPlugin } from "../plugins/themes";
import { loadExternalPlugins } from "../plugins/external";
import { PluginRegistry, installPluginRuntimeScope, installWorkspacePanelScope } from "../plugins/registry";
import { pluginSettingsValues } from "../plugins/pluginSettingsValues";
import { createWorkspaceFiles as createPluginWorkspaceFiles } from "../plugins/workspaceFiles";
import { queryNamespace, readNamespacedString, setNamespacedQueryKey } from "../namespacedQueryArgs";
import { AppShellController } from "../appShell/appShellController";
import { BrowserResumeController } from "../appShell/browserResumeController";
import { NavigationSectionsController, type NavigationSection } from "../appShell/navigationState";
import { OnScreenKeyboardController } from "../appShell/onScreenKeyboardController";
import { mainSurfaceView, PanelIntentController, mainViewClass } from "../appShell/panelIntentController";
import { PanelPeekController } from "../appShell/panelPeekController";
import { closedSessionTabs, promotedSessionTabs, reconciledMainView, removeLegacySessionTabsStorage, sessionTabsOf } from "../appShell/sessionTabs";
import { RadialMenuController } from "../appShell/radialMenuController";
import { RADIAL_SLOT_COUNT, radialSlotsEqual, readStoredRadialSlots, reconcileRadialSlots, writeStoredRadialSlots, type RadialSlotMap } from "../appShell/radialSlots";
import { peekSheetWidth } from "../appShell/panelPeek";
import { canDockAt, type ShellPanel } from "../appShell/panelIntent";
import { chromeDisclosureClass, shellLayoutModeClass } from "../appShell/shellLayoutMode";
import { PanelResizeController, type PanelResizeConstraints, type ResizablePanelSide } from "../appShell/panelResizeController";
import { readRoute, writeRoute, type AppRoute } from "../route";
import { readSettingsSection, writeSettingsSection, type SettingsSection } from "../settingsRoute";
import { applyActiveShortcutPreferences } from "../shortcutPreferences";
import { createTerminalCommandRunsRuntime } from "../runtime/terminalRuntime";
import { isWorkspaceDeletionPending, isWorkspaceDeletionRunPending, latestWorkspaceDeletionRuns, targetWorkspaceIdForRun, workspaceDeletionRunFilter } from "../workspaceDeletion";
import "./MachineList";
import "./ProjectList";
import "./WorkspaceList";
import "./SessionCleanupDialog";
import "./SessionTreeNavigator";
import "./ChatView";
import type { ChatSessionLaunchRecoveryActionKind, ChatView } from "./ChatView";
import "./ContextUsageMeter";
import "./PromptEditor";
import type { PromptEditor } from "./PromptEditor";
import "./NewSessionComposer";
import type { NewSessionComposer } from "./NewSessionComposer";
import "./CommandPicker";
import "./ActionPalette";
import "./AuthDialog";
import "./ProjectDialog";
import "./PromptDialog";
import "./MachineDialog";
import type { MachineDialogSubmit } from "./MachineDialog";
import { hasRenderedModal } from "./modalLayerRegistry";
import "./SettingsDialog";
import "./WorkspacePanel";
import type { WorkspacePanelEmptyState } from "./WorkspacePanel";
import "./appShell/AppContextBar";
import "./appShell/AppSessionTabs";
import type { AppSessionTab } from "./appShell/AppSessionTabs";
import { shouldShowMachinesSection, type AppNavigationPanel } from "./appShell/AppNavigationPanel";
import "./SessionInboxPanel";
import "./WorkspaceManagementDialog";
import { navigateToInboxSession, type InboxNavigationResult } from "../controllers/inboxNavigation";
import { deriveSessionInboxBoard, relativeTime } from "../sessionBoard";
import { sessionInboxAttention } from "../sessionInboxAttention";
import "./appShell/AppPanelControls";
import "./appShell/AppPanelOpener";
import "./appShell/AppPanelEdgeControl";
import "./appShell/AppRadialMenu";
import "./VoiceComposerDialog";
import type { RadialMenuEntry } from "./appShell/AppRadialMenu";
import "./appShell/AppRefreshControl";
import { appStyles, NEW_SESSION_LABEL, renderNewSessionIcon, type ChatLine } from "./shared";


const PI_WEB_STATUS_REFRESH_MS = 15 * 60 * 1000;
const PI_WEB_STATUS_DEFER_MS = 750;
const REMOTE_ROUTE_RESTORE_RETRY_DELAYS_MS = [1_000, 3_000, 8_000, 15_000, 30_000] as const;
const GLOBAL_SHORTCUT_LISTENER_OPTIONS = { capture: true } as const;
const THEME_AUTO_ON_VALUE = "auto:on";
const THEME_AUTO_OFF_VALUE = "auto:off";
const THEME_OPTION_PREFIX = "theme:";
const FILES_ROUTE_NAMESPACE = queryNamespace("core:workspace.files");
const GIT_ROUTE_NAMESPACE = queryNamespace("core:workspace.git");
const TERMINAL_ROUTE_NAMESPACE = queryNamespace("core:workspace.terminal");
const MIN_RESIZABLE_CHAT_WIDTH_PX = 320;
const PANEL_EDGE_COLUMNS_WIDTH_PX = 2;

/** PiWebApp-internal focus target type. Kept separate from AppNavigationPanel's export. */
type NavigationFocusTarget = NavigationSection | "chat";

interface SessionCleanupDialogState {
  preview?: SessionCleanupPreviewResponse | undefined;
  previewRequest?: SessionCleanupRequest | undefined;
  result?: SessionCleanupExecuteResponse | undefined;
  loading?: boolean | undefined;
  running?: boolean | undefined;
  error?: string | undefined;
}

type ChatNavigationIntent =
  | { readonly kind: "none" }
  | { readonly kind: "opening"; readonly seq: number; readonly machineId: string; readonly session: SessionInfo };

interface AppContextBarLocation {
  readonly machine: Machine | undefined;
  readonly project: Project | undefined;
  readonly workspace: Workspace | undefined;
  readonly session: SessionInfo | undefined;
}

/**
 * The visual viewport, where there is one.
 *
 * Browsers report it as null when absent and test environments leave it
 * undefined, so both have to be one answer before anything reads it.
 */
function visualViewportOrUndefined(): VisualViewport | undefined {
  return window.visualViewport ?? undefined;
}

@customElement("pi-web-app")
export class PiWebApp extends LitElement {
  @state() private state: AppState = initialAppState();
  @query("chat-view") private chatView?: ChatView;
  @query("prompt-editor") private promptEditor?: PromptEditor;
  @query("new-session-composer") private newSessionComposer?: NewSessionComposer;
  @query("app-navigation-panel") private navigationPanel?: AppNavigationPanel;
  @query("#navigation-panel") private navigationPanelFrame?: HTMLElement;
  @query("#workspace-panel") private workspacePanelFrame?: HTMLElement;

  private readonly sessionUnread = new SessionUnreadController({
    onChange: (machineId) => {
      this.syncUnreadPresence();
      if (selectedMachineId(this.state) !== machineId) return;
      this.syncUnreadSessionIds();
      this.syncSelectedSessionReadState();
      this.syncUnreadCompletedAt();
    },
    onBackgroundError: (operation, machineId, error) => {
      console.warn(`Failed to ${operation} session unread state for ${machineId}`, error);
    },
  });
  @state() private unreadSessionIds: ReadonlySet<string> = this.sessionUnread.unreadSessionIds(selectedMachineId(this.state), this.state.sessions);
  @state() private unreadPresence: UnreadPresence = EMPTY_UNREAD_PRESENCE;
  @state() private chatNavigationIntent: ChatNavigationIntent = { kind: "none" };
  @state() private chatOpeningAttempt = 0;
  @state() private openingChatPreview: { readonly identity: string; readonly view: SessionTranscriptPreview } | undefined;
  @state() private cachedUnreadCompletedAt: Readonly<Record<string, string>> = {};
  private unreadConnected = false;
  private committedChatIdentity: string | undefined;
  private readyChatIdentity: string | undefined;
  private promptHistoryCache: {
    readonly sessionIdentity: string;
    readonly pageStart: number;
    readonly latestUserMessage: ChatLine | undefined;
    readonly entries: readonly string[];
  } | undefined;
  private readonly managedProcessesListeners = new Set<(event: ManagedProcessesBrowserEvent) => void>();
  private readonly managedProcessesSnapshots = new Map<string, ManagedProcessesSnapshot>();
  private readonly chatOpenTiming = createChatOpenTiming();

  private readonly notifications = new SessionNotificationController(
    () => this.state,
    (patch) => { this.setState(patch); },
    { onBackgroundError: (message, error) => { console.warn(message, error); } },
  );
  private readonly inbox = new SessionInboxController(
    () => this.state,
    (patch) => { this.setState(patch); },
    {
      onBackgroundError: (operation, machineId, error) => {
        console.warn(`SessionInboxController: ${operation} snapshot failed for ${machineId}`, error);
      },
    },
  );
  private readonly sessions = new SessionController(
    () => this.state,
    (patch) => { this.setState(patch); },
    () => { this.updateUrl(); },
    new SessionStorageSessionSelectionMemory(),
    {
      notifications: this.notifications,
      onManagedProcessesEvent: (event) => {
        const key = this.selectedManagedProcessesKey(selectedMachineId(this.state));
        if (key !== undefined && event.type === "processes.update") this.managedProcessesSnapshots.set(key, event.snapshot);
        if (key !== undefined && event.type === "processes.refresh") this.managedProcessesSnapshots.delete(key);
        for (const listener of this.managedProcessesListeners) listener(event);
        this.requestUpdate();
      },
      inbox: this.inbox,
      onSelectedSessionReady: ({ machineId, session }) => {
        void this.commitReadyChatAfterRender(machineId, session);
      },
      onPendingSessionLaunchProjectionChange: () => {
        this.requestUpdate();
      },
      replacePromptEditorText: async ({ machineId, sessionId, text, snapshot }) => {
        await this.updateComplete;
        const promptEditor = this.promptEditor;
        if (selectedMachineId(this.state) !== machineId || this.state.selectedSession?.id !== sessionId || promptEditor === undefined) return false;
        if (snapshot === undefined) return promptEditor.replaceText(text);
        return promptEditor.restoreSnapshot({ ...snapshot, attachments: snapshot.attachments?.map((attachment) => ({ ...attachment })) });
      },
    },
  );
  private readonly projectActivityOwnership = new ProjectActivityOwnershipCoordinator(
    () => this.state,
    (patch) => { this.setState(patch); },
    {
      api: workspacesApi,
      onError: ({ machineId, projectId, error }) => {
        console.warn(`Failed to discover project activity ownership for ${projectId} on ${machineId}`, error);
      },
    },
  );
  private readonly activity = new ActivityController(
    () => this.state,
    (patch) => { this.setState(patch); },
    { onActivityApplied: (machineId) => { void this.projectActivityOwnership.handleActivityApplied(machineId); } },
  );
  private readonly auth = new AuthController(
    () => this.state,
    (patch) => { this.setState(patch); },
    (status) => { this.sessions.applySessionStatus(status); },
  );
  private readonly workspaces = new WorkspaceController(
    () => this.state,
    (patch) => { this.setState(patch); },
    () => { this.updateUrl(); },
    this.sessions,
    new SessionStorageWorkspaceSelectionMemory(),
  );
  private readonly projects = new ProjectController(
    () => this.state,
    (patch) => { this.setState(patch); },
    this.workspaces,
    { onProjectsApplied: (machineId) => { void this.projectActivityOwnership.handleProjectsApplied(machineId); } },
  );
  private readonly machines = new MachineController(
    () => this.state,
    (patch) => { this.setState(patch); },
    () => { this.updateUrl(); },
    this.projects,
  );
  private readonly piWebStatusController = new PiWebStatusController(
    () => this.state,
    (patch) => { this.setState(patch); },
    { onRefreshError: (machineId, error) => { console.warn(`Failed to refresh Forgerie status for ${machineId}`, error); } },
  );
  private readonly files = new FileExplorerController(
    () => this.state,
    (patch) => { this.setState(patch); },
    () => { this.updateUrl(); },
  );
  private readonly git = new GitController(
    () => this.state,
    (patch) => { this.setState(patch); },
    () => { this.updateUrl(); },
  );
  private readonly keyboard = new KeyboardShortcutDispatcher();
  private readonly newSessionDestinationCatalog: NewSessionDestinationCatalog = createApiNewSessionDestinationCatalog();
  private readonly realtime = new RealtimeSocket();
  private readonly machineRealtimeSockets = new Map<string, RealtimeSocket>();
  private readonly activeTerminalIds = new Set<string>();
  private readonly machineNavigation = new SessionStorageMachineNavigationMemory();
  private readonly terminalSelection = new SessionStorageTerminalSelectionMemory();
  private readonly appShell = new AppShellController(this);
  private readonly onScreenKeyboard = new OnScreenKeyboardController(this, {
    isComposerFocused: () => this.promptEditor?.matches(":focus-within") === true,
  });
  private readonly browserResume = new BrowserResumeController({
    onResumeSignal: () => { this.handleBrowserResumeSignal(); },
    refreshAfterResume: () => this.refreshAfterBrowserResume(),
    onRefreshError: (error) => { console.warn("Failed to refresh after browser resume", error); },
  });
  private readonly panelIntent = new PanelIntentController(this);
  private readonly mountedPanelSides = new Set<ShellPanel>();
  private readonly sessionDictationSpeechApi: ComposerDictationCapability["speechApi"] = { checkTurn: checkSpeechTurn, transcribe: transcribeSpeech };
  private readonly sessionDictationCapabilityValue: ComposerDictationCapability = {
    getStatus: getSpeechStatus,
    createCaptureSession: createSpeechCaptureSession,
    speechApi: this.sessionDictationSpeechApi,
  };
  private readonly panelPeek = new PanelPeekController(this, {
    peekable: (panel) => !this.panelIntent.isDocked(panel),
    sheetWidth: () => peekSheetWidth(this.clientWidth),
    applyProgress: (_panel, progress) => { this.writePeekProgress(progress); },
  });

  /**
   * The wheel. Shares the shell's pointer stream with the peek: a drag is a
   * peek, a hold is a wheel, and the peek's still-timer gives up at exactly the
   * moment this one arms.
   */
  /** Whether the voice composer has been asked for and not yet dismissed. */
  @state() private voiceComposerOpen = false;

  private readonly radialMenu = new RadialMenuController(this, {
    slotCount: () => RADIAL_SLOT_COUNT,
    viewport: () => ({ width: this.clientWidth, height: this.clientHeight }),
    canOpenAt: (event) => this.radialMenuCanOpenAt(event),
    isSlotEnabled: (slot) => this.radialEntries()[slot]?.enabled ?? false,
    onCommit: (slot) => { this.openRadialSlot(slot); },
  });

  /** Reconciled against the installed panels on read, and written only when it moves. */
  private radialSlotAssignment: RadialSlotMap = readStoredRadialSlots();

  /**
   * Puts the sheet where the finger is without a render.
   *
   * Travel arrives every frame. A render here is a render of the whole
   * application, which lands the sheet behind the hand; the element takes the
   * number directly instead, and the compositor moves it.
   */
  private writePeekProgress(progress: number): void {
    const root = this.shadowRoot;
    if (root === null) return;
    const sheet = root.querySelector(".panel-surface[data-mode=\"sheet\"]");
    if (sheet instanceof HTMLElement) sheet.style.setProperty("--peek-progress", String(progress));
    const scrim = root.querySelector(".peek-scrim");
    if (scrim instanceof HTMLElement) scrim.style.opacity = String(progress);
  }
  private readonly panelResize = new PanelResizeController(this);
  private readonly navigationSections = new NavigationSectionsController(
    this,
    () => this.state,
    () => this.appShell.isMobileNavigationLayout,
  );
  private readonly systemLightThemeMedia = typeof window !== "undefined" && "matchMedia" in window ? window.matchMedia("(prefers-color-scheme: light)") : undefined;
  private terminalAutoStartWorkspaceId: string | undefined;
  private piWebStatusTimer: number | undefined;
  private piWebStatusDeferredTimer: number | undefined;
  private workspaceDeletionPollTimer: number | undefined;
  private refreshingWorkspaceDeletionRuns = false;
  private readonly handledWorkspaceDeletionRunIds = new Set<string>();
  private readonly terminalCommandRunRuntimes = new Map<string, TerminalCommandRunsInternalRuntime>();
  private machineNavigationRestoreSeq = 0;
  private navigationSelectionSeq = 0;
  private routeRestoreSeq = 0;
  private routeRestoreDepth = 0;
  private restoringRouteTerminalId: string | undefined;
  private pendingRemoteRouteRestore: AppRoute | undefined;
  private remoteRouteRestoreTimer: number | undefined;
  private remoteRouteRestoreAttempt = 0;
  private remoteRouteRestoreInProgress = false;
  private readonly plugins = createPluginRegistry();
  private readonly loadedMachinePluginIds = new Set<string>();
  private readonly machinePluginLoadPromises = new Map<string, Promise<void>>();
  private gatewayPluginLoadPromise: Promise<void> | undefined;
  private themePreference: ThemePreference = readStoredThemePreference() ?? DEFAULT_THEME_PREFERENCE;
  /** Inbox row height. Read once at start-up; the settings panel changes it. */
  @state() private inboxDensity: InboxDensity = initialInboxDensity();
  @state() private activeThemeId: QualifiedContributionId = CLASSIC_THEME_ID;
  @state() private isRefreshingApp = false;
  /**
   * Cwds confirmed to have no matching workspace after lazy loading all
   * projects. Passed to SessionInboxPanel so the row renders as disabled.
   * Cleared when navigation succeeds or machine/topology refreshes.
   */
  @state() private unavailableCwds: ReadonlySet<string> = new Set();
  @state() private sessionCleanupDialog: SessionCleanupDialogState | undefined;
  @state() private settingsSection: SettingsSection | undefined = readSettingsSection();
  @state() private shortcutConfig: PiWebShortcutConfig = {};
  @state() private pluginConfig: PiWebPluginConfigMap = {};
  @state() private workspaceUploadDefaultFolder = effectiveWorkspaceUploadFolder(undefined);
  private sessionWarningVisibility = initialSessionWarningVisibilityState();
  private readonly onPopState = () => void this.withChatScrollTransition(async () => {
    this.restoreSettingsRoute();
    await this.restoreRoute(false);
  });
  private readonly onPageShow = () => {
    void this.sessionUnread.refreshAll();
    this.appShell.repairViewportPosition();
    this.retryPendingRemoteRouteRestoreSoon();
  };
  private readonly onSystemLightThemeChange = () => {
    if (this.themePreference.auto) this.applyPreferredTheme(false);
  };
  private get routeRestoreInProgress(): boolean {
    return this.routeRestoreDepth > 0;
  }

  private readonly resetKeyboardShortcutSequence = (): void => { this.keyboard.reset(); };
  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState !== "visible") this.keyboard.reset();
  };

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (this.isRenderedModalOpen()) {
      this.keyboard.reset();
      return;
    }
    // The wheel is a look too, and it is on top, so it answers Escape first.
    if (event.key === "Escape" && this.radialMenu.state.kind !== "closed") {
      event.preventDefault();
      this.radialMenu.close();
      return;
    }
    // A peek is a look, so it yields to the first key that asks it to.
    if (event.key === "Escape" && this.panelPeek.panel !== undefined) {
      event.preventDefault();
      this.panelPeek.close();
      return;
    }
    const shortcutDecision = this.keyboard.decide(event, () => this.getDefaultActions(), {
      shortcuts: this.shortcutConfig,
      context: keyboardShortcutContextForEvent(event),
    });
    if (shortcutDecision.kind !== "defer") {
      event.preventDefault();
      event.stopPropagation();
      if (shortcutDecision.kind === "run") void shortcutDecision.action.run();
      return;
    }
    // Keyboard E: archive selected session (same confirm/path as the row action).
    // Only fires when focus is not in an input, textarea, contenteditable, or editor.
    if (
      event.key === "e" &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey &&
      !isKeyEventInEditableContext(event)
    ) {
      const session = this.state.selectedSession;
      if (session !== undefined && session.archived !== true) {
        event.preventDefault();
        event.stopPropagation();
        void this.archiveInboxSession(session);
      }
    }
  };

  protected override willUpdate(): void {
    this.toggleAttribute("pwa-display-mode", this.appShell.isPwaDisplayMode);
    this.syncSessionWarningVisibility();
  }

  private observeViewportSpace(): void {
    const viewport = visualViewportOrUndefined();
    if (viewport === undefined) return;
    this.syncViewportSpace();
    viewport.addEventListener("resize", this.syncViewportSpace);
    viewport.addEventListener("scroll", this.syncViewportSpace);
  }

  private unobserveViewportSpace(): void {
    const viewport = visualViewportOrUndefined();
    if (viewport === undefined) return;
    viewport.removeEventListener("resize", this.syncViewportSpace);
    viewport.removeEventListener("scroll", this.syncViewportSpace);
  }

  protected override updated(): void {
    // Lit has now committed the selected chat and app-shell visibility state.
    // Recheck after every rendered transition; the unread controller
    // deduplicates acknowledgements for the observed completion order.
    this.committedChatIdentity = selectedChatIdentity(this.state);
    this.syncSelectedSessionReadState();
    this.dismissPeekUnderModal();
    if (this.modalIsOpen()) this.keyboard.reset();
  }

  /**
   * A dialog puts a peeked panel away.
   *
   * A peek is a look at something while staying where you are. A modal is a
   * move somewhere else, so the look is over -- and leaving a sheet open under
   * a dialog stacks two dismissable layers whose scrims and Escape keys fight
   * over which one a press belongs to.
   */
  /**
   * Fit the shell to the space that is actually on screen.
   *
   * A soft keyboard does not shrink the layout viewport on Android; it covers
   * it. A shell sized at 100% therefore keeps its full height and slides its top
   * out of view, taking the panels' headers -- and their close controls -- with
   * it. The visual viewport reports what is left, so the shell is measured
   * against that instead of assuming it owns the window.
   */
  private readonly syncViewportSpace = (): void => {
    const viewport = visualViewportOrUndefined();
    if (viewport === undefined) return;
    this.style.setProperty("--pi-viewport-height", `${String(Math.round(viewport.height))}px`);
    this.style.setProperty("--pi-viewport-offset", `${String(Math.round(viewport.offsetTop))}px`);
  };

  private dismissPeekUnderModal(): void {
    if (this.panelPeek.panel === undefined) return;
    if (!this.modalIsOpen()) return;
    this.panelPeek.close();
  }

  private modalIsOpen(): boolean {
    const state = this.state;
    return this.settingsSection !== undefined
      || state.newSessionComposer.kind === "open"
      || state.workspaceManagementDialog !== undefined
      || state.commandDialog !== undefined
      || state.modelDialog !== undefined
      || state.thinkingDialog !== undefined
      || state.actionPaletteOpen;
  }

  private syncSessionWarningVisibility(): void {
    const session = this.state.selectedSession;
    this.sessionWarningVisibility = reconcileSessionWarningVisibility(
      this.sessionWarningVisibility,
      session === undefined ? undefined : machineSessionKey(selectedMachineId(this.state), session.id),
      this.state.status === undefined ? undefined : this.state.status.warnings ?? [],
    );
  }

  private syncSelectedSessionReadState(): void {
    const session = this.state.selectedSession;
    if (session === undefined) return;
    const machineId = selectedMachineId(this.state);
    if (!this.isSessionSeen(machineId, session)) return;
    void this.sessionUnread.acknowledge(machineId, session);
  }

  private markSessionsRead(sessions: readonly SessionInfo[]): void {
    const machineId = selectedMachineId(this.state);
    for (const session of sessions) void this.sessionUnread.acknowledge(machineId, session);
  }

  private async commitReadyChatAfterRender(machineId: string, session: SessionInfo): Promise<void> {
    const identity = unreadChatIdentity(machineId, session);
    await this.updateComplete;
    if (!this.unreadConnected || selectedChatIdentity(this.state) !== identity) return;
    this.readyChatIdentity = identity;
    this.syncSelectedSessionReadState();
  }

  private syncUnreadSessionIds(): void {
    // Use the machine-global session list so unread sessions in workspaces
    // other than the currently selected one are included. Fall back to the
    // workspace-scoped list when the global store is not yet populated.
    const sessions = this.state.globalSessions?.sessions ?? this.state.sessions;
    const next = this.sessionUnread.unreadSessionIds(selectedMachineId(this.state), sessions);
    if (!sameStringSet(next, this.unreadSessionIds)) this.unreadSessionIds = next;
  }

  private syncUnreadPresence(): void {
    const next = deriveUnreadPresence({
      machineIds: this.state.machines.map((machine) => machine.id),
      projectionFor: (machineId) => this.sessionUnread.projection(machineId),
      selectedMachineId: selectedMachineId(this.state),
      projects: this.state.projects,
      workspaces: this.state.workspaces,
      workspacesByProjectId: this.state.workspacesByProjectId,
    });
    if (!sameUnreadPresence(next, this.unreadPresence)) this.unreadPresence = next;
  }

  private isSessionSeen(machineId: string, session: SessionInfo): boolean {
    if (!this.unreadConnected) return false;
    const identity = unreadChatIdentity(machineId, session);
    if (selectedChatIdentity(this.state) !== identity
      || this.committedChatIdentity !== identity
      || this.readyChatIdentity !== identity) return false;
    if (typeof document !== "undefined") {
      if (document.visibilityState !== "visible") return false;
      if (typeof document.hasFocus === "function" && !document.hasFocus()) return false;
    }
    if (this.isRenderedModalOpen()) return false;
    if (this.state.mainView === "chat") return true;
    if (this.state.mainView === "navigation") return !this.appShell.isMobileNavigationLayout;
    // The workspace view only leaves the session on screen beside it on a shell
    // wide enough to hold both, so elsewhere the session is not being read.
    return this.appShell.disclosure === "resident";
  }

  private isRenderedModalOpen(): boolean {
    return hasRenderedModal(this.ownerDocument);
  }

  private readonly onFullscreenChange = (): void => {
    this.requestUpdate();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    removeLegacySessionTabsStorage();
    this.unreadConnected = true;
    this.observeViewportSpace();
    window.addEventListener("popstate", this.onPopState);
    window.addEventListener("pageshow", this.onPageShow);
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("fullscreenchange", this.onFullscreenChange);
      document.addEventListener("visibilitychange", this.onVisibilityChange);
    }
    this.browserResume.connect();
    window.addEventListener("keydown", this.onKeyDown, GLOBAL_SHORTCUT_LISTENER_OPTIONS);
    window.addEventListener("focusin", this.resetKeyboardShortcutSequence, GLOBAL_SHORTCUT_LISTENER_OPTIONS);
    window.addEventListener("blur", this.resetKeyboardShortcutSequence);
    window.addEventListener("compositionstart", this.resetKeyboardShortcutSequence, GLOBAL_SHORTCUT_LISTENER_OPTIONS);
    this.systemLightThemeMedia?.addEventListener("change", this.onSystemLightThemeChange);
    // Controls that differ between a finger and a mouse read the input in use
    // from the root. The watch runs for the life of the app.
    this.stopInputModeWatch = observeInputMode(document.documentElement, document);
    this.applyPreferredTheme(false);
    this.connectRealtime();
    this.syncSessionUnreadMachines();
    void this.inbox.refresh(selectedMachineId(this.state));
    this.piWebStatusTimer = window.setInterval(() => { this.schedulePiWebStatusRefresh(); }, PI_WEB_STATUS_REFRESH_MS);
    void this.refreshWorkspaceActivity();
    void this.loadClientConfig();
    void this.ensureGatewayPluginsLoaded();
    void this.loadProjectsAndRestoreRoute().finally(() => { this.schedulePiWebStatusRefresh(); });
  }

  private stopInputModeWatch: (() => void) | undefined;

  override disconnectedCallback(): void {
    this.unobserveViewportSpace();
    this.stopInputModeWatch?.();
    this.stopInputModeWatch = undefined;
    this.unreadConnected = false;
    this.committedChatIdentity = undefined;
    this.readyChatIdentity = undefined;
    this.sessionUnread.retainMachines(new Set<string>());
    window.removeEventListener("popstate", this.onPopState);
    window.removeEventListener("pageshow", this.onPageShow);
    if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
      document.removeEventListener("fullscreenchange", this.onFullscreenChange);
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
    }
    this.browserResume.disconnect();
    window.removeEventListener("keydown", this.onKeyDown, GLOBAL_SHORTCUT_LISTENER_OPTIONS);
    window.removeEventListener("focusin", this.resetKeyboardShortcutSequence, GLOBAL_SHORTCUT_LISTENER_OPTIONS);
    window.removeEventListener("blur", this.resetKeyboardShortcutSequence);
    window.removeEventListener("compositionstart", this.resetKeyboardShortcutSequence, GLOBAL_SHORTCUT_LISTENER_OPTIONS);
    this.systemLightThemeMedia?.removeEventListener("change", this.onSystemLightThemeChange);
    this.keyboard.reset();
    this.auth.dispose();
    this.sessions.dispose();
    this.notifications.dispose();
    this.inbox.dispose();
    this.realtime.close();
    this.closeMachineActivitySockets();
    this.git.dispose();
    if (this.piWebStatusTimer !== undefined) window.clearInterval(this.piWebStatusTimer);
    this.piWebStatusTimer = undefined;
    this.clearScheduledPiWebStatusRefresh();
    if (this.workspaceDeletionPollTimer !== undefined) window.clearInterval(this.workspaceDeletionPollTimer);
    this.workspaceDeletionPollTimer = undefined;
    this.clearPendingRemoteRouteRestore();
    this.chatNavigationIntent = { kind: "none" };
    this.chatOpenTiming.supersedeActive();
    super.disconnectedCallback();
  }

  private setState(patch: Partial<AppState>) {
    if (!patchChangesState(this.state, patch)) return;
    const previous = this.state;
    this.state = { ...this.state, ...patch };
    if (previous.mainView !== "chat" && this.state.mainView === "chat" && this.state.selectedSession !== undefined) this.chatOpeningAttempt += 1;
    if (selectedChatIdentity(previous) !== selectedChatIdentity(this.state)) {
      this.committedChatIdentity = undefined;
      this.readyChatIdentity = undefined;
    }
    if (machineUnreadInputsChanged(previous, this.state)) this.syncSessionUnreadMachines();
    if (sessionUnreadIdsInputsChanged(previous, this.state)) this.syncUnreadSessionIds();
    if (unreadPresenceInputsChanged(previous, this.state)) this.syncUnreadPresence();
    this.handleActivityTransition(previous, this.state);
    this.handleWorkspaceChange(previous, this.state);
    this.handleMachineChange(previous, this.state);
    this.handleSessionTabsTransition(previous, this.state);
    this.clearChatNavigationIntentForSelectedSession();
    if (machineActivitySubscriptionInputsChanged(previous, this.state)) this.syncMachineActivitySubscriptions();
    this.notifications.syncEnvironment(previous, this.state);
  }

  private async loadProjectsAndRestoreRoute() {
    this.restoreSettingsRoute();
    const route = readRoute();
    await this.machines.loadMachines(route.machineId);
    const effectiveRoute = this.routeForSelectedMachine(route);
    const initialRouteMachineHealth = this.state.machineStatuses[effectiveRoute.machineId ?? "local"];
    if (effectiveRoute !== route) this.replaceRouteAndClearWorkspaceQuery(effectiveRoute);
    await this.projects.loadProjects();
    await this.withChatScrollTransition(() => this.restoreRouteFor(effectiveRoute, false));
    if (this.shouldDeferRemoteRouteRestore(effectiveRoute, initialRouteMachineHealth)) this.deferRemoteRouteRestore(effectiveRoute);
    else {
      this.clearPendingRemoteRouteRestore();
      this.rememberCurrentMachineNavigation();
    }
    await this.refreshWorkspaceDeletionRuns();
  }

  private handleBrowserResumeSignal(): void {
    this.appShell.repairViewportPosition();
    this.schedulePiWebStatusRefresh();
    this.retryPendingRemoteRouteRestoreSoon();
  }

  private async refreshAfterBrowserResume(): Promise<void> {
    await this.sessionUnread.refreshAll();
    await Promise.all([
      this.sessions.refreshSelectedSession(),
      this.refreshMachineActivities(),
      this.refreshWorkspaceDeletionRuns(),
      this.workspaces.refreshSelectedProjectTopology(),
    ]);
    // Topology refresh may have resolved previously-unavailable cwds.
    this.unavailableCwds = new Set();
  }

  private schedulePiWebStatusRefresh(delayMs = PI_WEB_STATUS_DEFER_MS): void {
    this.clearScheduledPiWebStatusRefresh();
    this.piWebStatusDeferredTimer = window.setTimeout(() => {
      this.piWebStatusDeferredTimer = undefined;
      void this.piWebStatusController.refresh();
    }, delayMs);
  }

  private clearScheduledPiWebStatusRefresh(): void {
    if (this.piWebStatusDeferredTimer === undefined) return;
    window.clearTimeout(this.piWebStatusDeferredTimer);
    this.piWebStatusDeferredTimer = undefined;
  }

  private async refreshWorkspaceActivity(machineId = selectedMachineId(this.state)): Promise<void> {
    try {
      await this.activity.refresh(machineId);
    } catch (error) {
      console.warn(`Failed to refresh workspace activity for ${machineId}`, error);
    }
  }

  private async refreshMachineActivities(): Promise<void> {
    const machineIds = this.state.machines.length === 0
      ? [selectedMachineId(this.state)]
      : this.state.machines
        .filter((machine) => shouldRefreshMachineActivity(machine, this.state.machineStatuses[machine.id]))
        .map((machine) => machine.id);
    await Promise.all(machineIds.map((machineId) => this.refreshWorkspaceActivity(machineId)));
  }

  private async loadClientConfig(): Promise<void> {
    try {
      this.applyClientConfig((await configApi.config()).effectiveConfig);
    } catch (error) {
      console.warn("Failed to load Forgerie config", error);
    }
  }

  private applyClientConfig(config: PiWebConfigValues): void {
    this.shortcutConfig = config.shortcuts ?? {};
    this.pluginConfig = config.plugins ?? {};
    this.workspaceUploadDefaultFolder = effectiveWorkspaceUploadFolder(config);
  }

  private async refreshAppData(): Promise<void> {
    if (this.isRefreshingApp) return;
    this.isRefreshingApp = true;
    try {
      await Promise.all([
        this.sessions.refreshSelectedSession(),
        this.refreshMachineActivities(),
        this.loadClientConfig(),
        this.refreshWorkspaceDeletionRuns(),
        this.refreshCurrentWorkspaceSurface(),
        this.workspaces.refreshSelectedProjectTopology(),
      ]);
      this.schedulePiWebStatusRefresh();
    } finally {
      this.isRefreshingApp = false;
    }
  }

  private async refreshCurrentWorkspaceSurface(): Promise<void> {
    const workspace = this.state.selectedWorkspace;
    const tool = this.state.mainView !== "chat" && this.state.mainView !== "navigation" ? this.state.mainView : this.state.workspaceTool;
    if (tool === "core:workspace.files") await this.files.refreshFiles();
    else if (tool === "core:workspace.git") await this.git.refreshGit();
    else if (tool === "core:workspace.terminal" && workspace !== undefined) await this.refreshActiveTerminals(workspace);
  }

  private hardReloadApp(): void {
    window.location.reload();
  }

  private async restoreRoute(updateUrl: boolean) {
    await this.restoreRouteFor(readRoute(), updateUrl);
    this.rememberCurrentMachineNavigation();
  }

  private async restoreRouteFor(route: AppRoute, updateUrl: boolean, surface = this.readWorkspaceRouteSurface(route), restoredMainView?: AppState["mainView"]) {
    const machineBeforeRestore = selectedMachineId(this.state);
    const routeSurface = route.projectId === undefined || route.projectId === "" ? emptyWorkspaceRouteSurface() : surface;
    const restoreSeq = ++this.routeRestoreSeq;
    this.routeRestoreDepth += 1;
    this.restoringRouteTerminalId = routeSurface.selectedTerminalId;
    try {
      await this.restoreRouteMachine(route, false);
      const selectedMachinePluginLoad = this.loadPluginsForSelectedMachine();
      if (route.tool?.startsWith("machine.") === true) await selectedMachinePluginLoad;
      if (!this.isCurrentRouteRestore(restoreSeq)) return;
      this.setState({
        workspaceTool: route.tool ?? this.state.workspaceTool,
        mainView: mainSurfaceView(restoredMainView ?? route.view ?? this.defaultRouteView()),
        selectedFilePath: routeSurface.selectedFilePath,
        selectedDiffPath: routeSurface.selectedDiffPath,
        selectedTerminalId: routeSurface.selectedTerminalId,
      });
      if (route.projectId === undefined || route.projectId === "") {
        if (updateUrl) this.updateUrl();
        return;
      }
      if (this.routeMatchesCurrentSelection(route)) {
        if (routeSurface.selectedTerminalId !== undefined) this.rememberSelectedTerminal(routeSurface.selectedTerminalId);
        await this.refreshRestoredWorkspaceTool(route.tool, routeSurface.selectedFilePath);
        this.git.updatePolling();
        if (updateUrl) this.updateUrl();
        return;
      }
      const project = this.state.projects.find((p) => p.id === route.projectId);
      if (!project) {
        this.setState({ selectedFilePath: undefined, selectedDiffPath: undefined, selectedTerminalId: undefined });
        if (updateUrl) this.updateUrl();
        return;
      }
      await this.workspaces.selectProject(project, { workspaceId: route.workspaceId, sessionId: route.sessionId, updateUrl: false });
      if (!this.isCurrentRouteRestore(restoreSeq)) return;
      this.setState({ selectedFilePath: routeSurface.selectedFilePath, selectedDiffPath: routeSurface.selectedDiffPath, selectedTerminalId: routeSurface.selectedTerminalId });
      if (routeSurface.selectedTerminalId !== undefined) this.rememberSelectedTerminal(routeSurface.selectedTerminalId);
      await this.refreshRestoredWorkspaceTool(route.tool, routeSurface.selectedFilePath);
      this.git.updatePolling();
      if (updateUrl) this.updateUrl();
    } finally {
      this.routeRestoreDepth = Math.max(0, this.routeRestoreDepth - 1);
      if (this.routeRestoreDepth === 0) this.restoringRouteTerminalId = undefined;
      if (selectedMachineId(this.state) !== machineBeforeRestore) this.schedulePiWebStatusRefresh();
    }
  }

  private isCurrentRouteRestore(restoreSeq: number): boolean {
    return restoreSeq === this.routeRestoreSeq;
  }

  private readWorkspaceRouteSurface(route: AppRoute): WorkspaceRouteSurface {
    if (route.projectId === undefined || route.projectId === "") return emptyWorkspaceRouteSurface();
    return {
      selectedFilePath: readNamespacedString(FILES_ROUTE_NAMESPACE, "file"),
      selectedDiffPath: readNamespacedString(GIT_ROUTE_NAMESPACE, "diff"),
      selectedTerminalId: readNamespacedString(TERMINAL_ROUTE_NAMESPACE, "terminal"),
    };
  }

  private routeForSelectedMachine(route: AppRoute): AppRoute {
    const currentMachineId = this.state.selectedMachine?.id ?? "local";
    if ((route.machineId ?? "local") === currentMachineId) return route;
    return { machineId: currentMachineId, projectId: undefined, workspaceId: undefined, sessionId: undefined, tool: undefined, view: undefined };
  }

  private replaceRouteAndClearWorkspaceQuery(route: AppRoute): void {
    writeRoute(route, { replace: true });
    setNamespacedQueryKey(FILES_ROUTE_NAMESPACE, "file", undefined, { replace: true });
    setNamespacedQueryKey(GIT_ROUTE_NAMESPACE, "diff", undefined, { replace: true });
    setNamespacedQueryKey(TERMINAL_ROUTE_NAMESPACE, "terminal", undefined, { replace: true });
  }

  private shouldDeferRemoteRouteRestore(route: AppRoute, routeMachineHealth = this.state.machineStatuses[route.machineId ?? "local"]): boolean {
    const machineId = route.machineId ?? "local";
    const machine = this.state.selectedMachine;
    if (machineId === "local" || machine?.id !== machineId || machine.kind !== "remote") return false;
    if (routeMachineHealth?.ok !== false) return false;
    if (route.projectId === undefined || route.projectId === "") return this.state.projects.length === 0;
    return this.state.selectedProject?.id !== route.projectId;
  }

  private deferRemoteRouteRestore(route: AppRoute): void {
    this.pendingRemoteRouteRestore = route;
    this.remoteRouteRestoreAttempt = 0;
    this.setRemoteRouteRestoreMessage(route);
    this.schedulePendingRemoteRouteRestore();
  }

  private retryPendingRemoteRouteRestoreSoon(): void {
    if (this.pendingRemoteRouteRestore === undefined) return;
    this.schedulePendingRemoteRouteRestore(0);
  }

  private schedulePendingRemoteRouteRestore(delayMs = remoteRouteRestoreRetryDelay(this.remoteRouteRestoreAttempt)): void {
    if (this.pendingRemoteRouteRestore === undefined) return;
    this.clearPendingRemoteRouteRestoreTimer();
    this.remoteRouteRestoreTimer = window.setTimeout(() => {
      this.remoteRouteRestoreTimer = undefined;
      void this.retryPendingRemoteRouteRestore();
    }, delayMs);
  }

  private async retryPendingRemoteRouteRestore(): Promise<void> {
    if (this.remoteRouteRestoreInProgress) return;
    const route = this.pendingRemoteRouteRestore;
    if (route === undefined) return;
    if (!this.pendingRemoteRouteRestoreStillCurrent(route)) {
      this.clearPendingRemoteRouteRestore();
      return;
    }

    this.remoteRouteRestoreInProgress = true;
    try {
      const machineId = route.machineId ?? "local";
      const health = await this.machines.refreshMachineHealth(machineId);
      if (!this.pendingRemoteRouteRestoreStillCurrent(route)) return;
      if (health?.ok !== true) {
        this.scheduleNextRemoteRouteRestoreAttempt(route);
        return;
      }

      await this.machines.refreshMachineRuntime(machineId);
      if (!this.pendingRemoteRouteRestoreStillCurrent(route)) return;
      await this.projects.loadProjects();
      if (!this.pendingRemoteRouteRestoreStillCurrent(route)) return;
      if (this.state.error !== "") {
        this.scheduleNextRemoteRouteRestoreAttempt(route);
        return;
      }

      await this.withChatScrollTransition(() => this.restoreRouteFor(route, false));
      if (!this.pendingRemoteRouteRestoreStillCurrent(route)) return;
      this.clearPendingRemoteRouteRestore();
      this.rememberCurrentMachineNavigation();
      await this.refreshWorkspaceDeletionRuns();
    } finally {
      this.remoteRouteRestoreInProgress = false;
    }
  }

  private scheduleNextRemoteRouteRestoreAttempt(route: AppRoute): void {
    this.remoteRouteRestoreAttempt += 1;
    if (this.remoteRouteRestoreAttempt >= REMOTE_ROUTE_RESTORE_RETRY_DELAYS_MS.length) {
      this.setRemoteRouteRestoreMessage(route, { exhausted: true });
      this.clearPendingRemoteRouteRestore();
      return;
    }
    this.setRemoteRouteRestoreMessage(route);
    this.schedulePendingRemoteRouteRestore();
  }

  private setRemoteRouteRestoreMessage(route: AppRoute, options: { exhausted?: boolean } = {}): void {
    const machineId = route.machineId ?? "local";
    const machineName = this.state.machines.find((machine) => machine.id === machineId)?.name ?? this.state.selectedMachine?.name ?? "Remote machine";
    const health = this.state.machineStatuses[machineId];
    const detail = health?.error ?? (this.state.error === "" ? undefined : this.state.error);
    const prefix = options.exhausted === true
      ? `${machineName} is still unavailable.`
      : `${machineName} is unavailable; reconnecting…`;
    this.setState({ error: `${prefix}${detail === undefined ? "" : ` ${detail}`}` });
  }

  private pendingRemoteRouteRestoreStillCurrent(route: AppRoute): boolean {
    const machineId = route.machineId ?? "local";
    return machineId !== "local"
      && this.pendingRemoteRouteRestore === route
      && this.state.selectedMachine?.id === machineId
      && this.state.machines.some((machine) => machine.id === machineId);
  }

  private clearPendingRemoteRouteRestore(): void {
    this.clearPendingRemoteRouteRestoreTimer();
    this.pendingRemoteRouteRestore = undefined;
    this.remoteRouteRestoreAttempt = 0;
  }

  private clearPendingRemoteRouteRestoreTimer(): void {
    if (this.remoteRouteRestoreTimer === undefined) return;
    window.clearTimeout(this.remoteRouteRestoreTimer);
    this.remoteRouteRestoreTimer = undefined;
  }

  private async restoreRouteMachine(route: AppRoute, updateUrl: boolean): Promise<void> {
    const routeMachineId = route.machineId ?? "local";
    if (this.state.selectedMachine?.id === routeMachineId) return;
    const machine = this.state.machines.find((candidate) => candidate.id === routeMachineId);
    if (machine === undefined) return;
    await this.machines.selectMachine(machine, { updateUrl });
  }

  private routeMatchesCurrentSelection(route: AppRoute): boolean {
    return (route.machineId ?? "local") === (this.state.selectedMachine?.id ?? "local")
      && route.workspaceId !== undefined
      && route.workspaceId !== ""
      && this.state.selectedProject?.id === route.projectId
      && this.state.selectedWorkspace?.id === route.workspaceId
      && this.state.selectedSession?.id === route.sessionId;
  }

  private async refreshRestoredWorkspaceTool(tool: QualifiedContributionId | undefined, selectedFilePath: string | undefined): Promise<void> {
    if (tool === "core:workspace.files") await this.files.refreshFiles();
    if (tool === "core:workspace.files" && selectedFilePath !== undefined) await this.files.restoreFile(selectedFilePath);
    if (tool === "core:workspace.git") await this.git.refreshGit();
  }

  private async withChatScrollTransition(action: () => Promise<void>, shouldComplete: () => boolean = () => true) {
    await action();
    if (!shouldComplete()) return;
    await this.updateComplete;
    if (!shouldComplete()) return;
    await this.chatView?.updateComplete;
  }

  private async withChatPrependTransition(action: () => Promise<void>) {
    await action();
    await this.updateComplete;
    await this.chatView?.updateComplete;
  }

  private defaultRouteView(): AppState["mainView"] {
    return this.appShell.defaultRouteView();
  }

  private updateUrl(options?: { replace?: boolean | undefined }) {
    this.rememberCurrentMachineNavigation();
    writeRoute({
      machineId: this.state.selectedMachine?.id,
      projectId: this.state.selectedProject?.id,
      workspaceId: this.state.selectedWorkspace?.id,
      sessionId: this.state.selectedSession?.id,
      tool: this.state.workspaceTool,
      view: this.state.mainView === "navigation" ? undefined : this.state.mainView,
    }, options);
    this.syncWorkspaceRouteSurfaceToUrl();
  }

  private rememberCurrentMachineNavigation(): void {
    this.machineNavigation.remember(machineNavigationSnapshotFromState(this.state));
  }

  private syncWorkspaceRouteSurfaceToUrl(): void {
    this.writeWorkspaceRouteSurfaceToUrl(machineNavigationSnapshotFromState(this.state).surface);
  }

  private writeMachineNavigationSnapshotToUrl(snapshot: MachineNavigationSnapshot, options?: { replace?: boolean | undefined }): void {
    writeRoute(routeFromMachineNavigationSnapshot(snapshot), options);
    this.writeWorkspaceRouteSurfaceToUrl(snapshot.surface);
  }

  private writeWorkspaceRouteSurfaceToUrl(surface: WorkspaceRouteSurface): void {
    setNamespacedQueryKey(FILES_ROUTE_NAMESPACE, "file", surface.selectedFilePath, { replace: true });
    setNamespacedQueryKey(GIT_ROUTE_NAMESPACE, "diff", surface.selectedDiffPath, { replace: true });
    setNamespacedQueryKey(TERMINAL_ROUTE_NAMESPACE, "terminal", surface.selectedTerminalId, { replace: true });
  }

  private async selectMachineWithMemory(machine: Machine, options: { rememberCurrent?: boolean } = {}): Promise<void> {
    if (this.state.selectedMachine?.id === machine.id) return;
    if (options.rememberCurrent !== false && !this.routeRestoreInProgress) this.rememberCurrentMachineNavigation();
    const seq = ++this.machineNavigationRestoreSeq;
    const snapshot = this.machineNavigation.latest(machine.id) ?? emptyMachineNavigationSnapshot(machine.id);
    await this.restoreRouteFor(routeFromMachineNavigationSnapshot(snapshot), false, snapshot.surface, snapshot.view);
    if (seq !== this.machineNavigationRestoreSeq || this.state.selectedMachine?.id !== machine.id) return;
    if (this.shouldPreserveUnrestoredMachineNavigation(snapshot)) {
      this.machineNavigation.remember(snapshot);
      this.writeMachineNavigationSnapshotToUrl(snapshot);
      return;
    }
    this.updateUrl();
  }

  private shouldPreserveUnrestoredMachineNavigation(snapshot: MachineNavigationSnapshot): boolean {
    return snapshot.projectId !== undefined && this.state.selectedProject?.id !== snapshot.projectId && this.state.error !== "";
  }

  /**
   * Select a workspace tool without turning the panel into the main view.
   *
   * The workspace is a side surface. When it cannot dock, the same surface
   * becomes a sheet over the resident chat. Tool selection and panel
   * presentation are separate decisions; coupling them is what made every
   * right-panel entry replace chat at narrow widths.
   */
  private openWorkspaceTool(tool: QualifiedContributionId) {
    if (tool === "core:workspace.terminal") this.terminalAutoStartWorkspaceId = this.state.selectedWorkspace?.id;
    this.setState({ workspaceTool: tool, mainView: "chat" });
    if (!this.panelIntent.isDocked("workspace") && this.panelPeek.panel !== "workspace") this.panelPeek.open("workspace");
    this.updateUrl();
    this.refreshSelectedWorkspaceTool(tool);
    this.git.updatePolling();
  }

  private openTerminal(options?: { terminalId?: string | undefined }): void {
    if (options?.terminalId !== undefined) this.selectTerminal(options.terminalId, { replace: true });
    this.openWorkspaceTool("core:workspace.terminal");
  }

  /** Open a workspace document in the rendered preview tool. */
  private openDocumentPreview(path: string): void {
    this.setState({ previewDocument: { path } });
    this.openWorkspaceTool("core:workspace.preview");
  }

  private terminalCommandRunsForOrigin(origin: string, machineId = selectedMachineId(this.state)): TerminalCommandRunsInternalRuntime {
    const key = machineScopedKey(machineId, origin);
    const existing = this.terminalCommandRunRuntimes.get(key);
    if (existing !== undefined) return existing;
    const runtime = createTerminalCommandRunsRuntime(origin, {
      api: {
        runTerminalCommand: (runtimeOrigin, input) => terminalsApi.runTerminalCommand(runtimeOrigin, input, machineId),
        listCommandRuns: (filter) => terminalsApi.listCommandRuns(filter, machineId),
        getCommandRun: (runId) => terminalsApi.getCommandRun(runId, machineId),
      },
      openTerminal: (workspace, options) => { void this.openRuntimeTerminal(machineId, workspace, options); },
    });
    this.terminalCommandRunRuntimes.set(key, runtime);
    return runtime;
  }

  private managedProcessesRuntime(machineId: string): ManagedProcessesRuntime {
    const selected = this.state.selectedSession;
    const key = this.selectedManagedProcessesKey(machineId);
    return createManagedProcessesRuntime(
      selected === undefined ? undefined : { machineId, id: selected.id, cwd: selected.cwd },
      sessionsApi,
      (listener) => {
        this.managedProcessesListeners.add(listener);
        return () => { this.managedProcessesListeners.delete(listener); };
      },
      key === undefined ? undefined : {
        read: () => this.managedProcessesSnapshots.get(key),
        write: (snapshot) => {
          this.managedProcessesSnapshots.set(key, snapshot);
          this.requestUpdate();
        },
      },
    );
  }

  private selectedManagedProcessesKey(machineId: string): string | undefined {
    const selected = this.state.selectedSession;
    return selected === undefined ? undefined : `${machineId}:${selected.id}:${selected.cwd}`;
  }

  private async openRuntimeTerminal(machineId: string, workspace: Workspace | undefined, options?: { terminalId?: string | undefined }): Promise<void> {
    if (selectedMachineId(this.state) !== machineId || (workspace !== undefined && (this.state.selectedWorkspace?.id !== workspace.id || this.state.selectedProject?.id !== workspace.projectId))) {
      if (!this.routeRestoreInProgress) this.rememberCurrentMachineNavigation();
      await this.restoreRouteFor({
        machineId,
        projectId: workspace?.projectId,
        workspaceId: workspace?.id,
        sessionId: undefined,
        tool: "core:workspace.terminal",
        view: "core:workspace.terminal",
      }, false, { selectedTerminalId: options?.terminalId }, "core:workspace.terminal");
      if (selectedMachineId(this.state) !== machineId) {
        this.setState({ error: "Machine not found for terminal command run" });
        return;
      }
    }
    this.openTerminal(options);
  }

  private selectTerminal(terminalId: string | undefined, options?: { replace?: boolean | undefined }): void {
    this.rememberSelectedTerminal(terminalId);
    this.setState({ selectedTerminalId: terminalId });
    this.rememberCurrentMachineNavigation();
    this.writeSelectedTerminalToUrl(terminalId, options);
  }

  private rememberSelectedTerminal(terminalId: string | undefined): void {
    const workspace = this.state.selectedWorkspace;
    if (workspace === undefined) return;
    if (terminalId === undefined) this.terminalSelection.forgetWorkspace(this.terminalWorkspaceKey(workspace));
    else this.terminalSelection.rememberTerminal(this.terminalWorkspaceKey(workspace), terminalId);
  }

  private writeSelectedTerminalToUrl(terminalId: string | undefined, options?: { replace?: boolean | undefined }): void {
    setNamespacedQueryKey(TERMINAL_ROUTE_NAMESPACE, "terminal", terminalId, options);
  }

  private terminalWorkspaceKey(workspace: Workspace): string {
    return `${selectedMachineId(this.state)}:${workspace.path}`;
  }

  private selectMainView(view: AppState["mainView"]) {
    if (view !== "navigation" && view !== "chat") {
      this.openWorkspaceTool(view);
      return;
    }
    this.setState({ mainView: view });
    this.updateUrl();
    this.git.updatePolling();
  }

  private openSettings(section: SettingsSection = "general"): void {
    this.settingsSection = section;
    writeSettingsSection(section);
  }

  private closeSettings(): void {
    this.settingsSection = undefined;
    writeSettingsSection(undefined);
  }

  private navigateSettings(section: SettingsSection): void {
    this.settingsSection = section;
    writeSettingsSection(section);
  }

  private restoreSettingsRoute(): void {
    this.settingsSection = readSettingsSection();
  }

  private handleWorkspaceChange(previous: AppState, next: AppState) {
    if (previous.selectedWorkspace?.id === next.selectedWorkspace?.id) return;
    this.terminalAutoStartWorkspaceId = undefined;
    this.activeTerminalIds.clear();
    const selectedTerminalId = this.routeRestoreInProgress ? this.restoringRouteTerminalId : next.selectedWorkspace === undefined ? undefined : this.terminalSelection.latestTerminalId(this.terminalWorkspaceKey(next.selectedWorkspace));
    this.setState({ activeTerminalCount: 0, selectedTerminalId });
    if (!this.routeRestoreInProgress) {
      this.rememberCurrentMachineNavigation();
      this.writeSelectedTerminalToUrl(selectedTerminalId, { replace: true });
    }
    if (next.selectedWorkspace === undefined) return;
    void this.refreshActiveTerminals(next.selectedWorkspace);
    void this.refreshWorkspaceDeletionRuns();
    this.refreshSelectedWorkspaceTool(next.workspaceTool);
    this.git.updatePolling();
  }

  private syncSessionUnreadMachines(): void {
    if (!this.unreadConnected) {
      this.sessionUnread.retainMachines(new Set<string>());
      return;
    }
    const machineIds = new Set(this.state.machines.map((machine) => machine.id));
    machineIds.add(selectedMachineId(this.state));
    this.sessionUnread.retainMachines(machineIds);
    for (const machineId of machineIds) {
      // Socket events keep a loaded projection current; only the initial join
      // (or a machine whose snapshot never landed) needs an HTTP snapshot.
      if (this.sessionUnread.projection(machineId) === undefined) void this.sessionUnread.refresh(machineId);
    }
  }

  private connectRealtime(): void {
    const machineId = selectedMachineId(this.state);
    const refreshAfterReconnect = () => {
      void this.sessionUnread.refresh(machineId);
      // Re-snapshot the inbox on reconnect: corrects stale Blocked/Working
      // classifications that accumulated while the socket was disconnected
      // (e.g. after a sessiond restart clears in-memory pending asks).
      void this.inbox.refresh(machineId);
      const workspace = this.state.selectedWorkspace;
      if (workspace !== undefined) void this.refreshActiveTerminals(workspace);
      void this.refreshWorkspaceActivity(machineId);
    };
    this.realtime.connect(
      (event) => { this.handleRealtimeEvent(machineId, event); },
      { machineId, onReconnect: refreshAfterReconnect },
    );
  }

  private syncMachineActivitySubscriptions(): void {
    const desiredMachineIds = this.machineActivitySubscriptionIds();
    for (const [machineId, socket] of this.machineRealtimeSockets.entries()) {
      if (desiredMachineIds.has(machineId)) continue;
      socket.close();
      this.machineRealtimeSockets.delete(machineId);
    }
    for (const machineId of desiredMachineIds) {
      if (this.machineRealtimeSockets.has(machineId)) continue;
      const socket = new RealtimeSocket();
      const refreshMachineActivity = () => {
        void this.sessionUnread.refresh(machineId);
        void this.refreshWorkspaceActivity(machineId);
      };
      socket.connect(
        (event) => { this.handleMachineActivityEvent(machineId, event); },
        {
          machineId,
          onInitialOpen: refreshMachineActivity,
          onReconnect: refreshMachineActivity,
        },
      );
      this.machineRealtimeSockets.set(machineId, socket);
    }
  }

  private closeMachineActivitySockets(): void {
    for (const socket of this.machineRealtimeSockets.values()) socket.close();
    this.machineRealtimeSockets.clear();
  }

  private machineActivitySubscriptionIds(): Set<string> {
    const selected = selectedMachineId(this.state);
    return new Set(this.state.machines
      .filter((machine) => machine.id !== selected)
      .filter((machine) => shouldSubscribeToMachineActivity(machine, this.state.machineStatuses[machine.id]))
      .map((machine) => machine.id));
  }

  private handleMachineActivityEvent(machineId: string, event: BrowserRealtimeEvent): void {
    if (event.type === "sessions.unread") this.sessionUnread.applyEvent(machineId, event);
    else if (event.type === "workspace.activity") this.activity.applyWorkspaceActivity(event.activity, machineId);
  }

  private handleRealtimeEvent(machineId: string, event: BrowserRealtimeEvent): void {
    if (event.type === "sessions.unread") this.sessionUnread.applyEvent(machineId, event);
    else if (event.type === "workspace.activity") this.activity.applyWorkspaceActivity(event.activity);
    else if (isTerminalEvent(event)) {
      this.applyTerminalEvent(event);
      if (event.type === "terminal.exited") void this.refreshWorkspaceDeletionRuns();
    } else this.sessions.applyGlobalEvent(event);
  }

  private applyTerminalEvent(event: TerminalUiEvent): void {
    const workspace = this.state.selectedWorkspace;
    if (workspace === undefined) return;
    const cwd = event.type === "terminal.closed" ? event.cwd : event.terminal.cwd;
    if (cwd !== workspace.path) return;
    if (event.type === "terminal.created" && !event.terminal.exited) this.activeTerminalIds.add(event.terminal.id);
    else this.activeTerminalIds.delete(event.type === "terminal.closed" ? event.terminalId : event.terminal.id);
    if (event.type === "terminal.closed") {
      this.terminalSelection.forgetTerminal(event.terminalId);
      if (this.state.selectedTerminalId === event.terminalId) this.selectTerminal(undefined, { replace: true });
    }
    this.setState({ activeTerminalCount: this.activeTerminalIds.size });
  }

  private async refreshActiveTerminals(workspace: Workspace): Promise<void> {
    const machineId = selectedMachineId(this.state);
    try {
      const terminals = await terminalsApi.terminals(workspace.projectId, workspace.id, machineId);
      if (selectedMachineId(this.state) !== machineId || this.state.selectedWorkspace?.id !== workspace.id) return;
      this.activeTerminalIds.clear();
      for (const terminal of terminals) {
        if (!terminal.exited) this.activeTerminalIds.add(terminal.id);
      }
      this.setState({ activeTerminalCount: this.activeTerminalIds.size });
    } catch (error) {
      this.setState({ error: String(error) });
    }
  }

  private handleActivityTransition(previous: AppState, next: AppState) {
    const wasActive = isActive(previous);
    const nowActive = isActive(next);
    if (wasActive && !nowActive) {
      this.setState({ fileTreeStale: true, gitStale: true });
      this.refreshSelectedWorkspaceTool(this.state.workspaceTool);
    }
  }

  private handleMachineChange(previous: AppState, next: AppState): void {
    if ((previous.selectedMachine?.id ?? "local") === (next.selectedMachine?.id ?? "local")) return;
    this.projectActivityOwnership.handleSelectedMachineChanged();
    const pendingMachineId = this.pendingRemoteRouteRestore?.machineId ?? "local";
    if (pendingMachineId !== (next.selectedMachine?.id ?? "local")) this.clearPendingRemoteRouteRestore();
    this.sessions.clearActiveSession();
    this.realtime.close();
    this.connectRealtime();
    const machineId = selectedMachineId(next);
    // Refresh snapshots owned by machine selection. Controller generation guards
    // discard any in-flight responses from the previous machine.
    void this.inbox.refresh(machineId);
    void this.refreshWorkspaceActivity(machineId);
    this.activeTerminalIds.clear();
    this.sessionCleanupDialog = undefined;
    // Machine switch invalidates all unavailable-cwd marks from the previous machine.
    this.unavailableCwds = new Set();
    this.setState({ piWebStatus: undefined });
    this.git.updatePolling();
    void this.loadPluginsForSelectedMachine();
  }

  private refreshSelectedWorkspaceTool(tool: QualifiedContributionId): void {
    if (tool === "core:workspace.files") void this.files.refreshFiles();
    if (tool === "core:workspace.git") void this.git.refreshGit();
  }

  /**
   * One panel, one place. A peeked panel moves into the sheet rather than being
   * mounted twice, which would run its subscriptions twice with it.
   */
  private renderWorkspacePanel(panelControls?: unknown) {
    // The panel shows its own tool strip unless something else already shows
    // one. As a tabbed main view, the session tab band carries the selection.
    // Stacked under the session on a summoned shell, the control sheet
    // carries the tools. Standing on its own -- docked beside the session or
    // overlaid as a sheet -- nothing else does, so it carries them itself.
    const hideToolTabs = this.workspaceToolTabbed()
      || (this.appShell.isChromeSummoned
        && !this.panelIntent.isDocked("workspace")
        && this.panelPeek.panel !== "workspace");
    const workspace = this.state.selectedWorkspace;
    const panelContext = workspace === undefined ? undefined : this.createWorkspacePanelContext(workspace);
    const emptyState = workspace === undefined ? this.workspacePanelEmptyState() : undefined;
    return html`
      <workspace-panel
        id="workspace-panel"
        .panelControls=${panelControls}
        .workspace=${workspace}
        .panelContext=${panelContext}
        .emptyState=${emptyState}
        .tool=${this.state.workspaceTool}
        .panels=${this.visibleWorkspacePanels()}
        .hideToolTabs=${hideToolTabs}
        .onSelectTool=${(tool: QualifiedContributionId) => { this.openWorkspaceTool(tool); }}
        .onNewSession=${this.state.mainView === "chat" || this.state.mainView === "navigation" ? undefined : () => { this.openNewSessionComposer(); }}
      ></workspace-panel>
    `;
  }

  private renderNavigationPanelEdgeControl() {
    const constraints = this.resizablePanelConstraints("navigation");
    return html`
      <app-panel-edge-control
        side="navigation"
        controls="navigation-panel"
        .disclosure=${this.appShell.disclosure}
        .layout=${this.appShell.layoutMode}
        resizeLabel="Resize navigation panel"
        expandLabel="Expand navigation panel"
        collapseLabel="Collapse navigation panel"
        .collapsed=${!this.panelIntent.isDocked("navigation")}
        .resizable=${!this.appShell.isMobileNavigationLayout}
        .panelWidth=${this.panelResize.panelWidth("navigation")}
        .minWidth=${constraints.minWidth}
        .maxWidth=${constraints.maxWidth}
        .onToggle=${() => { this.panelIntent.toggle("navigation"); }}
        .onResizeStart=${() => this.startPanelResize("navigation")}
        .onResize=${(width: number) => { this.panelResize.resizePanel("navigation", width, { persist: false }); }}
        .onResizeEnd=${() => { this.panelResize.persistPanelSizes(); }}
        .onReset=${() => { this.resetResizablePanel("navigation"); }}
      ></app-panel-edge-control>
    `;
  }

  private renderWorkspacePanelEdgeControl() {
    const constraints = this.resizablePanelConstraints("workspace");
    return html`
      <app-panel-edge-control
        side="workspace"
        controls="workspace-panel"
        .disclosure=${this.appShell.disclosure}
        .layout=${this.appShell.layoutMode}
        resizeLabel="Resize workspace panel"
        expandLabel="Expand workspace panel"
        collapseLabel="Collapse workspace panel"
        .collapsed=${!this.panelIntent.isDocked("workspace")}
        .resizable=${!this.appShell.isMobileNavigationLayout}
        .panelWidth=${this.panelResize.panelWidth("workspace")}
        .minWidth=${constraints.minWidth}
        .maxWidth=${constraints.maxWidth}
        .onToggle=${() => { this.panelIntent.toggle("workspace"); }}
        .onResizeStart=${() => this.startPanelResize("workspace")}
        .onResize=${(width: number) => { this.panelResize.resizePanel("workspace", width, { persist: false }); }}
        .onResizeEnd=${() => { this.panelResize.persistPanelSizes(); }}
        .onReset=${() => { this.resetResizablePanel("workspace"); }}
      ></app-panel-edge-control>
    `;
  }

  private startPanelResize(side: ResizablePanelSide): number {
    this.panelIntent.keep(side);
    return this.measuredPanelWidth(side) ?? this.panelResize.panelWidth(side);
  }

  private resizablePanelConstraints(side: ResizablePanelSide): PanelResizeConstraints {
    const constraints = this.panelResize.constraints(side);
    return {
      ...constraints,
      maxWidth: this.resizablePanelMaxWidth(side, constraints),
    };
  }

  private resizablePanelMaxWidth(side: ResizablePanelSide, constraints: PanelResizeConstraints): number {
    const shellWidth = this.getBoundingClientRect().width || (typeof window === "undefined" ? 0 : window.innerWidth);
    if (shellWidth <= 0) return constraints.maxWidth;

    const otherPanelWidth = this.oppositeResizablePanelWidth(side);
    const maxWidth = Math.floor(shellWidth - otherPanelWidth - PANEL_EDGE_COLUMNS_WIDTH_PX - MIN_RESIZABLE_CHAT_WIDTH_PX);
    return Math.max(constraints.minWidth, Math.min(constraints.maxWidth, maxWidth));
  }

  private oppositeResizablePanelWidth(side: ResizablePanelSide): number {
    const otherSide: ResizablePanelSide = side === "navigation" ? "workspace" : "navigation";
    if (this.isResizablePanelCollapsedOrStacked(otherSide)) return 0;
    return this.measuredPanelWidth(otherSide) ?? this.panelResize.panelWidth(otherSide);
  }

  private isResizablePanelCollapsedOrStacked(side: ResizablePanelSide): boolean {
    if (side === "navigation") return !this.panelIntent.isDocked("navigation");
    // Below a resident shell the workspace panel stacks under the session, so it
    // never takes width from its neighbour even while it is on screen.
    return !this.panelIntent.isDocked("workspace") || this.appShell.disclosure !== "resident";
  }

  private measuredPanelWidth(side: ResizablePanelSide): number | undefined {
    const element = side === "navigation" ? this.navigationPanelFrame : this.workspacePanelFrame;
    const width = element?.getBoundingClientRect().width;
    return width === undefined || width <= 0 ? undefined : width;
  }

  private resetResizablePanel(side: ResizablePanelSide): void {
    this.panelResize.resetPanel(side);
  }

  private resetResizablePanels(): void {
    this.panelResize.resetPanels();
  }

  private selectedMachineRuntime() {
    return this.state.machineRuntimes[selectedMachineId(this.state)];
  }

  private openSessionCleanupDialog(): void {
    this.sessionCleanupDialog = { error: "" };
  }

  private closeSessionCleanupDialog(): void {
    this.sessionCleanupDialog = undefined;
  }

  private async previewSessionCleanup(request: SessionCleanupRequest): Promise<void> {
    const machineId = selectedMachineId(this.state);
    this.sessionCleanupDialog = { ...(this.sessionCleanupDialog ?? {}), loading: true, error: "", preview: undefined, previewRequest: undefined, result: undefined };
    try {
      const preview = await sessionsApi.cleanupPreview(request, machineId);
      if (selectedMachineId(this.state) !== machineId) return;
      this.sessionCleanupDialog = { ...this.sessionCleanupDialog, preview, previewRequest: request, result: undefined, loading: false, error: "" };
    } catch (error) {
      if (selectedMachineId(this.state) === machineId) this.sessionCleanupDialog = { ...this.sessionCleanupDialog, loading: false, error: `Failed to preview cleanup: ${errorMessage(error)}` };
    }
  }

  private async runSessionCleanup(request: SessionCleanupRequest): Promise<void> {
    const dialog = this.sessionCleanupDialog;
    if (dialog?.preview === undefined || sessionCleanupRequestKey(dialog.previewRequest) !== sessionCleanupRequestKey(request)) {
      this.sessionCleanupDialog = { ...(dialog ?? {}), error: "Preview cleanup before running it." };
      return;
    }
    const machineId = selectedMachineId(this.state);
    this.sessionCleanupDialog = { ...dialog, running: true, error: "" };
    try {
      const result = await sessionsApi.cleanup(request, machineId);
      if (selectedMachineId(this.state) !== machineId) return;
      this.sessionCleanupDialog = { ...this.sessionCleanupDialog, preview: result, previewRequest: request, result, running: false, error: "" };
      await this.sessions.applySessionCleanupResult(result, machineId);
    } catch (error) {
      if (selectedMachineId(this.state) === machineId) this.sessionCleanupDialog = { ...this.sessionCleanupDialog, running: false, error: `Failed to run cleanup: ${errorMessage(error)}` };
    }
  }

  private navigationGlobalSessions(): GlobalSessionsState | undefined {
    const machineId = selectedMachineId(this.state);
    const current = this.state.globalSessions?.machineId === machineId ? this.state.globalSessions : undefined;
    const pending = this.state.sessions.filter((session) => isClientPendingStartSessionInfo(session) && session.machineId === machineId);
    if (pending.length === 0) return current;

    const pendingIds = new Set(pending.map((session) => session.id));
    const activities = { ...(current?.activities ?? {}) };
    for (const session of pending) {
      const activity = this.state.sessionActivities[session.id];
      if (activity !== undefined) activities[session.id] = activity;
    }
    return {
      machineId,
      status: current?.status ?? "fresh",
      sessions: [...pending, ...(current?.sessions ?? []).filter((session) => !pendingIds.has(session.id))],
      statuses: current?.statuses ?? {},
      activities,
    };
  }

  private renderNavigationPanel(panelControls?: unknown) {
    return html`
      <app-navigation-panel
        .panelControls=${panelControls}
        .machines=${this.state.machines}
        .selectedMachine=${this.state.selectedMachine}
        .machineStatuses=${this.state.machineStatuses}
        .machineActivities=${this.state.machineActivities}
        .unreadPresence=${this.unreadPresence}
        .globalSessions=${this.navigationGlobalSessions()}
        .selectedSession=${this.state.selectedSession}
        .unreadSessionIds=${this.unreadSessionIds}
        .unreadCompletedAt=${this.cachedUnreadCompletedAt}
        .projects=${this.state.projects}
        .workspacesByProjectId=${this.state.workspacesByProjectId}
        .collapsible=${true}
        .compact=${this.appShell.isMobileNavigationLayout}
        .refreshControl=${this.appShell.shouldShowAppRefreshInHeader() ? this.renderAppRefresh() : undefined}
        .onShowActions=${() => { this.setState({ actionPaletteOpen: true }); }}
        .onSelectMachine=${(machine: Machine) => this.selectNavigationItem("machines", "chat", () => this.selectMachineWithMemory(machine))}
        .onRemoveMachine=${(machine: Machine) => { void this.removeMachine(machine); }}
        .onSelectSession=${(session: SessionInfo) => { void this.selectInboxSession(session); }}
        .onArchiveSession=${(session: SessionInfo) => { void this.archiveInboxSession(session); }}
        .onPinSession=${(session: SessionInfo) => { void this.sessions.setSessionPinned(session, true); }}
        .onUnpinSession=${(session: SessionInfo) => { void this.sessions.setSessionPinned(session, false); }}
        .onRestoreSession=${(session: SessionInfo) => { void this.restoreInboxSession(session); }}
        .onDeleteSession=${(session: SessionInfo) => { void this.sessions.deleteArchivedSessions([session]); }}
        .undoToast=${this.state.inboxUndoToast}
        .onUndoArchive=${() => { void this.undoInboxArchive(); }}
        .onDismissUndoToast=${() => { this.inbox.dismissUndoToast(); }}
        .onNewSession=${() => { this.openNewSessionComposer(); }}
        .onManageWorkspaces=${() => { this.setState({ workspaceManagementDialog: { step: "project" } }); }}
        .onCancelKeyboardNavigation=${() => { void this.openChat(); }}
        .unavailableCwds=${this.unavailableCwds}
        .inboxShelves=${this.inboxShelves()}
        .inboxDensity=${this.inboxDensity}
      ></app-navigation-panel>
    `;
  }

  /**
   * Sync the `completedAt` timestamps for unread sessions so the inbox
   * board can pass them to `sessionBoardState`. Uses content equality to
   * avoid creating a new object on every render when the data has not changed.
   */
  private syncUnreadCompletedAt(): void {
    const machineId = selectedMachineId(this.state);
    const projection = this.sessionUnread.projection(machineId);
    if (projection === undefined) {
      if (Object.keys(this.cachedUnreadCompletedAt).length > 0) this.cachedUnreadCompletedAt = {};
      return;
    }
    const next: Record<string, string> = {};
    for (const summary of projection.sessions) next[summary.sessionId] = summary.completedAt;
    if (!sameCompletedAtRecord(next, this.cachedUnreadCompletedAt)) this.cachedUnreadCompletedAt = next;
  }

  /**
   * Inbox session selection: routes through the existing cascade for
   * cross-workspace navigation, or selects directly for same-workspace.
   *
   * Uses a monotonically increasing token (`navigationSelectionSeq`) so rapid
   * selections always apply the latest one and discard stale in-flight results.
   */
  private async selectInboxSession(
    session: SessionInfo,
    options: { readonly preserveUndoToast?: boolean } = {},
  ): Promise<void> {
    const seq = ++this.navigationSelectionSeq;
    const machineId = selectedMachineId(this.state);
    const isCurrentToken = () =>
      seq === this.navigationSelectionSeq && selectedMachineId(this.state) === machineId;

    // A peeked list was summoned to answer one question. Choosing a session is
    // the answer, so the sheet stands aside rather than covering what it opened.
    // A pinned panel is docked, never peeked, so it is untouched by this.
    this.panelPeek.close();

    // Independent navigation dismisses undo; Archive & next explicitly preserves it.
    if (options.preserveUndoToast !== true) this.inbox.dismissUndoToast();

    const timingTarget = selectedChatTarget(machineId, session);
    this.chatOpeningAttempt += 1;
    this.chatOpenTiming.begin(timingTarget);
    this.chatNavigationIntent = { kind: "opening", seq, machineId, session };
    this.openingChatPreview = undefined;
    void this.sessions.previewSession(session, machineId).then((view) => {
      if (!isCurrentToken() || this.chatNavigationIntent.kind !== "opening" || this.chatNavigationIntent.seq !== seq) return;
      this.openingChatPreview = { identity: unreadChatIdentity(machineId, session), view };
    }).catch(() => undefined);
    if (this.state.error !== "") this.setState({ error: "" });
    await this.openChatForNavigationIntent();
    if (isCurrentToken()) this.chatOpenTiming.markShellPainted(timingTarget);
    if (!isCurrentToken()) {
      this.recoverSupersededOpeningSends(machineId, session);
      this.clearChatNavigationIntentForToken(seq);
      return;
    }

    let result: InboxNavigationResult;
    try {
      result = await navigateToInboxSession(
        session,
        {
          getSelectedWorkspacePath: () => this.state.selectedWorkspace?.path,
          getSelectedProjectId: () => this.state.selectedProject?.id,
          allWorkspaces: () => {
            // Flatten all workspaces from workspacesByProjectId.
            return Object.values(this.state.workspacesByProjectId).flat();
          },
          allProjects: () => this.state.projects,
          loadProjectWorkspaces: async (project) => {
            // Refresh without selection teardown; updates workspacesByProjectId.
            return this.workspaces.refreshProjectWorkspaces(project.id);
          },
          selectSession: async (s) => {
            if (!isCurrentToken()) return;
            await this.sessions.selectSession(s);
          },
          selectWorkspace: async (ws, opts) => {
            if (!isCurrentToken()) return;
            await this.workspaces.selectWorkspace(ws, { ...opts, isCurrent: isCurrentToken });
          },
          selectProject: async (project, opts) => {
            if (!isCurrentToken()) return;
            await this.workspaces.selectProject(project, { ...opts, isCurrent: isCurrentToken });
          },
        },
        { token: seq, isCurrentToken },
      );
    } catch (error: unknown) {
      const recovery = this.recoverOpeningSends(machineId, session);
      this.clearChatNavigationIntentForToken(seq);
      if (isCurrentToken()) this.setState({ error: `Unable to open workspace: ${String(error)}.${recovery}` });
      return;
    }

    if (!isCurrentToken()) {
      this.recoverSupersededOpeningSends(machineId, session);
      this.clearChatNavigationIntentForToken(seq);
      return;
    }

    if (result === "selected" || result === "workspace-switch" || result === "project-switch") {
      // Successful resolution: clear any stale unavailable mark for this cwd.
      if (this.unavailableCwds.has(session.cwd)) {
        const next = new Set(this.unavailableCwds);
        next.delete(session.cwd);
        this.unavailableCwds = next;
      }
      if (!this.selectedSessionMatchesNavigationTarget(machineId, session)) this.clearChatNavigationIntentForToken(seq);
      await this.openChat();
    } else if (result === "unavailable") {
      const recovery = this.recoverOpeningSends(machineId, session);
      this.clearChatNavigationIntentForToken(seq);
      if (recovery !== "") this.setState({ error: `Unable to open ${sessionDisplayLabel(session)}.${recovery}` });
      // All projects exhausted with no match: mark the cwd unavailable so the
      // row renders as disabled in the inbox panel.
      if (!this.unavailableCwds.has(session.cwd)) {
        this.unavailableCwds = new Set([...this.unavailableCwds, session.cwd]);
      }
    }
    // "discarded": a later selection took over — leave unavailableCwds as-is.
  }

  /**
   * Restore a session from the inbox and navigate to it.
   * Like `selectNavigationItem` for restores: select session, then open chat.
   */
  private recoverSupersededOpeningSends(machineId: string, session: SessionInfo): void {
    const target = selectedChatTarget(machineId, session);
    const current = this.chatNavigationIntent;
    if (current.kind === "opening" && selectedChatTargetsEqual(selectedChatTarget(current.machineId, current.session), target)) return;
    if (this.state.selectedSession?.id === session.id && selectedMachineId(this.state) === machineId) return;
    this.sessions.recoverReadinessSends(session, machineId);
  }

  private recoverOpeningSends(machineId: string, session: SessionInfo): string {
    const recovery = this.sessions.recoverReadinessSends(session, machineId);
    if (recovery === undefined) return "";
    const attachmentNotice = recovery.attachmentsNeedReattaching ? " Reattach files before sending." : "";
    return ` ${String(recovery.count)} queued ${recovery.count === 1 ? "message was" : "messages were"} restored to this session's draft.${attachmentNotice}`;
  }

  private async restoreInboxSession(session: SessionInfo): Promise<void> {
    const seq = ++this.navigationSelectionSeq;
    const machineId = selectedMachineId(this.state);
    const isCurrentToken = () =>
      seq === this.navigationSelectionSeq && selectedMachineId(this.state) === machineId;
    await this.sessions.restoreSession(session);
    if (isCurrentToken()) await this.openChat();
  }

  /**
   * Archive an inbox session with the undo toast orchestration.
   *
   * Routes through `SessionInboxController.archiveWithUndo` so:
   *   - Working sessions get a confirmation dialog.
   *   - A 5-second undo toast is set in AppState on success.
   *   - A second archive before the first undo expires replaces the toast.
   *   - Archive failure surfaces via AppState.error; no toast is set.
   */
  private async archiveInboxSession(session: SessionInfo): Promise<void> {
    const machineId = selectedMachineId(this.state);
    try {
      await this.inbox.archiveWithUndo(session, {
        machineId,
        // archiveSessionThrowing propagates API errors so archiveWithUndo can
        // abort before updating the global store or installing the undo toast.
        // It does not call inbox.notifyArchived — archiveWithUndo handles that.
        archiveSession: (s) => this.sessions.archiveSessionThrowing(s),
      });
    } catch (error: unknown) {
      if (selectedMachineId(this.state) === machineId) this.setState({ error: String(error) });
    }
  }

  /** Execute the undo for the active inbox archive toast. */
  private async undoInboxArchive(): Promise<void> {
    await this.inbox.undoArchive({
      // restoreSessionThrowing propagates API errors so undoArchive can detect
      // "Session not found" and surface a user-readable message.
      restoreSession: (s) => this.sessions.restoreSessionThrowing(s),
    });
  }

  /**
   * Archive the selected session and advance to the next in the triage queue.
   *
   * If the queue is empty after the archive, the focus returns to the board.
   */
  private async archiveAndNext(): Promise<void> {
    const session = this.state.selectedSession;
    if (session === undefined) return;

    const gs = this.state.globalSessions;
    if (gs === undefined) return;

    // Build a board from the current global sessions so triageQueue works.
    const board = buildInboxBoard(
      this.state,
      this.unreadSessionIds,
      this.cachedUnreadCompletedAt,
    );

    const machineId = selectedMachineId(this.state);
    try {
      await this.inbox.archiveAndNext(session, board, {
        machineId,
        archiveSession: (s) => this.sessions.archiveSessionThrowing(s),
        navigateTo: (next, options) => this.selectInboxSession(next, options),
        onAllClear: () => {
          // Focus the navigation panel (inbox board) so keyboard users land
          // on a real board element in the all-clear state.
          void this.focusNavigationSection("sessions");
        },
      });
    } catch (error: unknown) {
      if (selectedMachineId(this.state) === machineId) this.setState({ error: String(error) });
    }
  }

  /**
   * Open a session identified by the file it was written to.
   *
   * A delegated child is known by path, not by id. A child that no listing
   * covers -- a run stored beside its parent rather than in the session store
   * -- cannot be opened, and that is reported instead of ignored.
   */
  private async openSessionByFile(sessionFile: string): Promise<void> {
    const sessions = this.state.globalSessions?.sessions ?? this.state.sessions;
    const match = sessions.find((session) => session.path === sessionFile);
    if (match === undefined) {
      this.setState({ error: "That agent's transcript is not in the session list." });
      return;
    }
    await this.selectInboxSession(match);
  }

  /** Clear the spawn marker, which returns the child to the inbox. */
  private async promoteSpawnedSession(sessionFile: string): Promise<void> {
    try {
      await sessionsApi.promoteSpawned(sessionFile, selectedMachineId(this.state));
      await this.inbox.refresh(selectedMachineId(this.state));
    } catch (error: unknown) {
      this.setState({ error: String(error) });
    }
  }

  private openNavigationSection(section: NavigationSection): void {
    this.navigationSections.open(section, () => { this.selectMainView("navigation"); });
  }

  private async selectNavigationItem(section: NavigationSection, nextTarget: NavigationFocusTarget, action: () => Promise<void>): Promise<void> {
    const seq = ++this.navigationSelectionSeq;
    if (this.chatNavigationIntent.kind === "opening") this.chatOpenTiming.supersedeActive();
    this.chatNavigationIntent = { kind: "none" };
    const isCurrentSelection = () => seq === this.navigationSelectionSeq;

    await this.withChatScrollTransition(async () => {
      this.navigationSections.advanceAfterSelection(section);
      await action();
    }, isCurrentSelection);

    if (!isCurrentSelection()) return;
    await this.focusNavigationTarget(nextTarget);
  }

  /**
   * Where a listed session's parent lives, when that parent is outside the
   * selected workspace. Bound once so the session list receives a stable
   * resolver identity across renders.
   */
  private readonly parentSessionLocationFor = (session: SessionInfo): ParentSessionLocation => resolveParentSessionLocation(session, {
    workspaces: this.state.workspaces,
    workspacesByProjectId: this.state.workspacesByProjectId,
    projects: this.state.projects,
  });

  /**
   * Open the session a turn created, from the transcript's door.
   *
   * The destination is named by cwd and id, not by a loaded `SessionInfo`: a
   * handoff usually lands in the same workspace, but may land in a sibling
   * worktree that is not loaded yet. Resolving the cwd first means both cases
   * take one path, and a destination whose workspace Forgerie does not know
   * leaves the door inert rather than navigating somewhere wrong.
   */
  private readonly openCreatedSession = (door: { readonly sessionId: string; readonly cwd: string }): void => {
    const location = resolveSessionLocation(door.cwd, door.sessionId, {
      workspaces: this.state.workspaces,
      workspacesByProjectId: this.state.workspacesByProjectId,
      projects: this.state.projects,
    });
    void this.goToParentSession(location);
  };

  /**
   * Select the workspace that owns a session outside the current workspace, and
   * the session itself when its id is known. Cross-project targets go through
   * `selectProject`, which loads that project's workspaces first.
   */
  private async goToParentSession(location: ParentSessionLocation): Promise<void> {
    if (location.kind !== "workspace") return;
    await this.selectNavigationItem("sessions", "chat", async () => {
      const workspace = this.state.workspaces.find((candidate) => candidate.id === location.workspaceId);
      if (workspace !== undefined) {
        await this.workspaces.selectWorkspace(workspace, { sessionId: location.sessionId });
        return;
      }
      const project = this.state.projects.find((candidate) => candidate.id === location.projectId);
      if (project === undefined) return;
      await this.workspaces.selectProject(project, { workspaceId: location.workspaceId, sessionId: location.sessionId });
    });
  }

  // -------------------------------------------------------------------------
  // New-session composer and workspace management
  // -------------------------------------------------------------------------

  private openNewSessionComposer(initialLaunchMode: NewSessionLaunchMode = "switch"): void {
    if (this.state.newSessionComposer.kind === "open") {
      this.newSessionComposer?.focusExisting();
      return;
    }
    const initialDestination = this.currentSessionNewSessionDestination();
    this.setState({
      newSessionComposer: {
        kind: "open",
        ...(initialDestination === undefined ? {} : { initialDestination }),
        ...(initialLaunchMode === "switch" ? {} : { initialLaunchMode }),
      },
    });
  }

  private currentSessionNewSessionDestination(): NewSessionCompleteDestination | undefined {
    const session = this.state.selectedSession;
    const machine = this.state.selectedMachine;
    if (session === undefined || machine === undefined) return undefined;

    const location = createInboxLocationResolver(this.state.projects, this.state.workspacesByProjectId)(session.cwd);
    if (location === undefined) return undefined;
    const project = this.state.projects.find((candidate) => candidate.id === location.projectId);
    if (project === undefined) return undefined;

    const knownWorkspaces = [
      ...(this.state.selectedWorkspace === undefined ? [] : [this.state.selectedWorkspace]),
      ...this.state.workspaces,
      ...(this.state.workspacesByProjectId[project.id] ?? []),
    ];
    const workspace = knownWorkspaces.find((candidate) =>
      candidate.projectId === project.id && sessionPathsEqual(candidate.path, session.cwd),
    );
    return workspace === undefined ? undefined : completeNewSessionDestination(machine, project, workspace);
  }

  private closeNewSessionComposer(): void {
    this.setState({ newSessionComposer: { kind: "closed" } });
  }

  private openSessionLaunchDestinationComposer(sessionId: string): void {
    if (this.state.newSessionComposer.kind === "open") {
      this.newSessionComposer?.focusExisting();
      return;
    }
    const recovery = this.sessions.getSessionLaunchRecovery(sessionId);
    if (recovery === undefined || (recovery.stage !== "creationFailed" && recovery.stage !== "promptConfirmedUnsent")) return;
    const initialDestination = this.sessionLaunchRecoveryDestination(recovery);
    this.setState({
      newSessionComposer: {
        kind: "open",
        ...(initialDestination === undefined ? {} : { initialDestination }),
        recoverySeedId: sessionId,
        replacesFailedSessionId: sessionId,
      },
    });
  }

  private sessionLaunchRecoveryDestination(recovery: SessionLaunchRecovery): NewSessionCompleteDestination | undefined {
    const machine = [this.state.selectedMachine, ...this.state.machines]
      .find((candidate) => candidate?.id === recovery.destination.machineId);
    const workspaces = [
      this.state.selectedWorkspace,
      ...this.state.workspaces,
      ...Object.values(this.state.workspacesByProjectId).flat(),
    ];
    const workspace = workspaces.find((candidate) => candidate?.id === recovery.destination.workspaceId
      && sessionPathsEqual(candidate.path, recovery.destination.cwd));
    const projects = [this.state.selectedProject, ...this.state.projects];
    const project = workspace === undefined ? undefined : projects.find((candidate) => candidate?.id === workspace.projectId);
    return machine === undefined || workspace === undefined || project === undefined
      ? undefined
      : completeNewSessionDestination(machine, project, workspace);
  }

  /** Rapidfire accepts from the local queue synchronously; switch mode can wait for navigation. */
  private submitNewSession(intent: NewSessionLaunchIntent): NewSessionSubmissionOutcome | Promise<NewSessionSubmissionOutcome> {
    if (intent.mode === "rapidfire") {
      this.navigationSelectionSeq += 1;
      return this.submitRapidfireSession(intent);
    }
    return this.submitSwitchSession(intent);
  }

  private submitRapidfireSession(intent: NewSessionLaunchIntent): NewSessionSubmissionOutcome {
    const replacesFailedSessionId = this.state.newSessionComposer.kind === "open"
      ? this.state.newSessionComposer.replacesFailedSessionId
      : undefined;
    if (replacesFailedSessionId !== undefined) {
      return { kind: "rejected", reason: "launch-rejected", message: "Rapidfire is unavailable while recovering a failed session launch." };
    }

    const destination = intent.destination;
    const currentMachine = this.state.selectedMachine;
    const currentWorkspace = this.state.selectedWorkspace;
    if (currentMachine === undefined || currentWorkspace === undefined) {
      return { kind: "rejected", reason: "launch-rejected", message: "Rapidfire can only start sessions in the current workspace. Turn it off to switch destinations." };
    }
    if (!isNewSessionMachineAvailable(currentMachine)
      || currentMachine.id !== destination.machine.id
      || currentWorkspace.projectId !== destination.project.id
      || currentWorkspace.id !== destination.workspace.id
      || !sessionPathsEqual(currentWorkspace.path, destination.workspace.path)) {
      return { kind: "rejected", reason: "launch-rejected", message: "Rapidfire can only start sessions in the current workspace. Turn it off to switch destinations." };
    }

    const handoff = this.sessions.launchSessionPreservingSelection({
      machineId: currentMachine.id,
      workspaceId: currentWorkspace.id,
      cwd: currentWorkspace.path,
    }, this.newSessionSubmission(intent), intent.agentChoices);
    if (handoff === undefined || !this.sessions.hasQueuedInitialPrompt(handoff.pendingSessionId)) {
      return { kind: "rejected", reason: "launch-rejected", message: "New session could not be queued." };
    }
    void handoff.completion.then((completion) => {
      if (completion.kind === "failed") this.setState({ error: `Rapidfire session failed to start: ${completion.message}` });
    }).catch((error: unknown) => { this.setState({ error: String(error) }); });
    return { kind: "accepted" };
  }

  private async submitSwitchSession(intent: NewSessionLaunchIntent): Promise<NewSessionSubmissionOutcome> {
    const replacesFailedSessionId = this.state.newSessionComposer.kind === "open"
      ? this.state.newSessionComposer.replacesFailedSessionId
      : undefined;
    const seq = ++this.navigationSelectionSeq;
    const isCurrentToken = () => seq === this.navigationSelectionSeq && this.state.newSessionComposer.kind === "open";
    const destination = await this.revalidateNewSessionDestination(intent.destination);
    if (!isCurrentToken()) {
      return { kind: "rejected", reason: "launch-rejected", message: "A newer navigation request replaced this launch." };
    }
    if (destination === undefined) {
      return { kind: "rejected", reason: "destination-unavailable", message: "That destination is no longer available. Choose it again or select another destination." };
    }

    try {
      const navigated = await this.navigateToNewSessionDestination(destination, isCurrentToken);
      if (!navigated || !isCurrentToken()) {
        return { kind: "rejected", reason: "destination-unavailable", message: "Forgerie could not reach that exact destination. Choose it again or select another destination." };
      }
    } catch (error) {
      return { kind: "rejected", reason: "destination-unavailable", message: `Forgerie could not reach that exact destination: ${errorMessage(error)}` };
    }

    const previouslySelectedSessionId = this.state.selectedSession?.id;
    const launch = this.sessions.launchSession(this.newSessionSubmission(intent), intent.agentChoices);
    const pending = this.state.selectedSession;
    const queuedFirstPrompt = pending !== undefined && this.sessions.hasQueuedInitialPrompt(pending.id);
    if (pending === undefined || pending.id === previouslySelectedSessionId || !queuedFirstPrompt) {
      void launch.catch((error: unknown) => { if (isCurrentToken()) this.setState({ error: String(error) }); });
      return { kind: "rejected", reason: "launch-rejected", message: "New session could not be queued." };
    }

    if (replacesFailedSessionId !== undefined) this.sessions.acceptSessionLaunchReplacement(replacesFailedSessionId, pending.id);
    this.setState({ newSessionComposer: { kind: "closed" } });
    await this.openChat();
    void launch.catch((error: unknown) => { this.setState({ error: String(error) }); });
    return { kind: "accepted" };
  }

  private newSessionSubmission(intent: NewSessionLaunchIntent): NewSessionLaunchIntent["firstPrompt"] {
    return {
      ...intent.firstPrompt,
      attachments: intent.firstPrompt.attachments === undefined ? undefined : [...intent.firstPrompt.attachments],
      delivery: intent.firstPrompt.delivery ?? "inline",
    };
  }

  private async revalidateNewSessionDestination(destination: NewSessionCompleteDestination): Promise<NewSessionCompleteDestination | undefined> {
    try {
      const machines = await this.newSessionDestinationCatalog.loadMachines();
      const machine = machines.find((candidate) => candidate.id === destination.machine.id);
      if (machine === undefined || !isNewSessionMachineAvailable(machine)) return undefined;
      const projects = await this.newSessionDestinationCatalog.loadProjects(machine.id);
      const project = projects.find((candidate) => candidate.id === destination.project.id);
      if (project === undefined) return undefined;
      const workspaces = await this.newSessionDestinationCatalog.loadWorkspaces(machine.id, project.id);
      const workspace = workspaces.find((candidate) =>
        candidate.id === destination.workspace.id
        && candidate.projectId === project.id
        && sessionPathsEqual(candidate.path, destination.workspace.path),
      );
      return workspace === undefined ? undefined : completeNewSessionDestination(machine, project, workspace);
    } catch {
      return undefined;
    }
  }

  private async navigateToNewSessionDestination(
    destination: NewSessionCompleteDestination,
    isCurrentToken: () => boolean,
  ): Promise<boolean> {
    if (!isCurrentToken()) return false;
    if (this.state.selectedMachine?.id !== destination.machine.id) {
      await this.selectMachineWithMemory(destination.machine);
    }
    if (!isCurrentToken() || this.state.selectedMachine?.id !== destination.machine.id) return false;

    const navigated = await this.navigateToProjectWorkspace(destination.project, destination.workspace, isCurrentToken);
    return navigated
      && this.state.selectedWorkspace !== undefined
      && sessionPathsEqual(this.state.selectedWorkspace.path, destination.workspace.path);
  }

  /**
   * Called when the user selects a project in the dialog.
   * Loads workspaces (lazy) and advances the dialog to the workspace step.
   */
  private async openWorkspaceManagementDialogWorkspaceStep(project: Project): Promise<void> {
    // Show loading state immediately so the user knows work is in flight.
    this.setState({
      workspaceManagementDialog: {
        step: "workspace",
        project,
        workspaces: [],
        loading: true,
        error: undefined,
      },
    });
    try {
      const workspaces = await this.workspaces.refreshProjectWorkspaces(project.id);
      // Guard: if the user cancelled or navigated away, discard the result.
      const current = this.state.workspaceManagementDialog;
      if (current?.step !== "workspace" || current.project.id !== project.id) return;
      this.setState({ workspaceManagementDialog: { ...current, workspaces, loading: false } });
    } catch (error: unknown) {
      const current = this.state.workspaceManagementDialog;
      if (current?.step !== "workspace" || current.project.id !== project.id) return;
      this.setState({
        workspaceManagementDialog: { ...current, loading: false, error: String(error) },
      });
    }
  }

  /**
   * User confirmed a workspace in "manage" mode.
   * Navigate to the workspace via the normal cascade but do NOT start a session.
   * Closes the dialog, then exposes the workspace tools.
   */
  private async confirmManageWorkspace(workspace: Workspace): Promise<void> {
    this.setState({ workspaceManagementDialog: undefined });
    const seq = ++this.navigationSelectionSeq;
    const isCurrentToken = () => seq === this.navigationSelectionSeq;
    const navigated = await this.navigateToWorkspace(workspace, isCurrentToken);
    if (!navigated || !isCurrentToken()) return;
    // Expose the workspace panel (switch main view to the active workspace tool).
    this.openWorkspaceTool(this.state.workspaceTool);
  }

  private async navigateToWorkspace(
    workspace: Workspace,
    isCurrentToken: () => boolean,
  ): Promise<boolean> {
    const project = this.state.projects.find((candidate) => candidate.id === workspace.projectId);
    return project !== undefined && this.navigateToProjectWorkspace(project, workspace, isCurrentToken);
  }

  private async navigateToProjectWorkspace(
    project: Project,
    workspace: Workspace,
    isCurrentToken: () => boolean,
  ): Promise<boolean> {
    if (!isCurrentToken()) return false;
    if (this.state.selectedProject?.id === project.id) {
      await this.workspaces.selectWorkspace(workspace, { isCurrent: isCurrentToken });
    } else {
      await this.workspaces.selectProject(project, {
        workspaceId: workspace.id,
        isCurrent: isCurrentToken,
      });
    }
    return isCurrentToken()
      && this.state.selectedProject?.id === project.id
      && this.state.selectedWorkspace?.id === workspace.id;
  }

  private async focusNavigationTarget(target: NavigationFocusTarget): Promise<void> {
    if (target === "chat") {
      await this.openChat();
      return;
    }
    await this.focusNavigationSection(target);
  }

  private async focusNavigationSection(section: NavigationSection): Promise<void> {
    this.panelIntent.keep("navigation");
    if (this.appShell.isMobileNavigationLayout) this.selectMainView("navigation");
    // The navigation panel now hosts the inbox; non-machine sections map to
    // focusing the inbox panel itself.
    if (section === "machines" && shouldShowMachinesSection(this.state.machines)) {
      this.navigationSections.expand(section);
      await this.updateComplete;
      await nextFrame();
      // MachineSwitcher is still in the panel header; focus it.
      const switcher = this.navigationPanel?.shadowRoot?.querySelector("machine-switcher");
      if (switcher instanceof HTMLElement) switcher.focus();
    } else {
      await this.updateComplete;
      await nextFrame();
      await this.navigationPanel?.focusInbox();
    }
  }

  /**
   * Bring the chat surface forward and settle its render, leaving keyboard
   * focus where the user left it.
   *
   * Opening a session must never focus the composer: on a touch device that
   * raises the on-screen keyboard and squashes the transcript the user came to
   * read. Only an explicit "focus the composer" request may move focus, so all
   * navigation paths route here and `focusChatComposer` stays reserved for that
   * one intent.
   */
  private async openChat(): Promise<void> {
    if (this.state.mainView !== "chat") this.selectMainView("chat");
    await this.updateComplete;
    await nextFrame();
  }

  private async openChatForNavigationIntent(): Promise<void> {
    await this.openChat();
    await nextTask();
  }

  /** Explicit composer entry only — see `openChat` for why navigation never calls this. */
  private async focusChatComposer(): Promise<void> {
    await this.openChat();
    // The focus request may outlive the dialog transition that scheduled it.
    // Recheck the rendered boundary at the final side-effect point so a newer
    // or surviving modal keeps visual and keyboard focus ownership.
    if (this.isRenderedModalOpen()) return;
    this.promptEditor?.focusInput();
  }

  private async navigateSessionTree(targetId: string, summaryChoice: SessionTreeSummaryChoice): Promise<SessionTreeNavigateResult> {
    const originMachineId = selectedMachineId(this.state);
    const originSessionId = this.state.selectedSession?.id;
    const result = await this.sessions.navigateTree(targetId, summaryChoice);
    if (!result.cancelled
      && originSessionId !== undefined
      && selectedMachineId(this.state) === originMachineId
      && this.state.selectedSession?.id === originSessionId) {
      this.chatOpeningAttempt += 1;
      await this.openChat();
    }
    return result;
  }

  private async forkSessionTree(entryId: string): Promise<SessionTreeForkResult> {
    // The controller selects the forked session and closes the dialog on success.
    return this.sessions.forkFromTree(entryId);
  }

  private closeSessionTreeNavigator(): void {
    this.sessions.closeTreeDialog();
    void this.openChat();
  }

  private renderSessionTreeNavigator(state: AppState) {
    return state.treeDialog === undefined ? null : html`
      <session-tree-navigator
        .tree=${state.treeDialog}
        .onNavigate=${(targetId: string, summaryChoice: SessionTreeSummaryChoice) => this.navigateSessionTree(targetId, summaryChoice)}
        .onFork=${(entryId: string) => this.forkSessionTree(entryId)}
        .onAbort=${() => this.sessions.abortTreeNavigation()}
        .onCancel=${() => { this.closeSessionTreeNavigator(); }}
      ></session-tree-navigator>
    `;
  }

  /**
   * The wheel opens over the conversation, not over the shell's own controls.
   *
   * A hold on a button is a hold on that button, and a hold inside an open
   * panel belongs to whatever is in the panel. Without this the gesture would
   * quietly take over every long press in the application.
   */
  private radialMenuCanOpenAt(event: PointerEvent): boolean {
    if (this.panelPeek.panel !== undefined) return false;
    for (const node of event.composedPath()) {
      if (!(node instanceof HTMLElement)) continue;
      if (node.classList.contains("panel-surface")) return false;
      if (node.tagName === "BUTTON" || node.tagName === "A" || node.tagName === "INPUT" || node.tagName === "TEXTAREA") return false;
      // Code stays selectable on touch, so a hold over it belongs to the
      // platform's selection rather than to the wheel. The style rule that
      // keeps code selectable and this test are two halves of one decision:
      // if they disagree, a hold over code either selects nothing or does
      // both things at once.
      if (node.tagName === "PRE" || node.tagName === "CODE") return false;
    }
    return true;
  }

  /**
   * The slot map, grown into but never rewritten.
   *
   * Reconciled against every registered panel rather than the visible ones: a
   * panel that is conditionally hidden must keep its direction, or the slots
   * behind it shift the moment it disappears.
   */
  private radialSlotMap(): RadialSlotMap {
    const available = this.plugins.getWorkspacePanels().map((panel) => panel.id);
    const next = reconcileRadialSlots(this.radialSlotAssignment, available);
    if (!radialSlotsEqual(next, this.radialSlotAssignment)) {
      this.radialSlotAssignment = next;
      writeStoredRadialSlots(next);
    }
    return this.radialSlotAssignment;
  }

  private radialEntries(): RadialMenuEntry[] {
    const slots = this.radialSlotMap();
    const workspace = this.state.selectedWorkspace;
    const context = workspace === undefined ? undefined : this.createWorkspacePanelContext(workspace);
    const panels = this.plugins.getWorkspacePanels();

    return slots.map((target, slot) => {
      if (target === undefined) return { slot, label: "Empty", icon: undefined, enabled: false };
      // A held bearing draws like a free one. The reader is not told which
      // empty directions the wheel might fill later; both open nothing.
      if (target.kind === "vacant") return { slot, label: "Empty", icon: undefined, enabled: false };
      if (target.kind === "navigation") {
        return { slot, label: "Inbox", icon: renderRadialIcon("inbox"), enabled: true };
      }
      if (target.kind === "overflow") {
        return { slot, label: "More", icon: renderRadialIcon("more"), enabled: true };
      }
      if (target.kind === "dictate") {
        // Enabled only with a session to speak to. Releasing here opens a live
        // microphone, and a microphone with nowhere to send is a recording the
        // reader cannot use.
        return { slot, label: "Dictate", icon: undefined, enabled: this.state.selectedSession !== undefined && this.state.selectedSession.archived !== true };
      }

      const panel = panels.find((candidate) => candidate.id === target.tool);
      if (panel === undefined || context === undefined) {
        return { slot, label: panel?.title ?? "Empty", icon: panel?.icon, enabled: false };
      }
      return {
        slot,
        label: panel.title,
        icon: panel.icon,
        badge: countBadge(panel.badge?.(context)),
        enabled: panel.visible?.(context) ?? true,
      };
    });
  }

  private openRadialSlot(slot: number): void {
    const target = this.radialSlotMap()[slot];
    if (target === undefined) return;
    if (target.kind === "navigation") { this.panelPeek.open("navigation"); return; }
    // Overflow opens the workspace sheet, whose tab strip already lists every
    // panel. The wheel does not need a second list of its own.
    if (target.kind === "overflow") { this.panelPeek.open("workspace"); return; }
    // `radialEntries` reports a held bearing as disabled and the controller
    // does not commit a disabled slot, so this never reaches that far.
    if (target.kind === "vacant") return;
    if (target.kind === "dictate") { this.voiceComposerOpen = true; return; }
    this.openWorkspaceTool(target.tool);
  }

  /**
   * The wheel's one bearing, once released, and what Ctrl+Alt+Enter opens.
   *
   * Keyed on the session so switching destinations tears the dialog down
   * rather than quietly re-pointing a live microphone at somewhere else.
   */
  private renderVoiceComposer() {
    if (!this.voiceComposerOpen) return null;
    const state = this.state;
    const session = state.selectedSession;
    if (session === undefined || session.archived === true) return null;
    const machineId = selectedMachineId(state);
    const runtimeAvailable = selectedChatCanUseRuntime(state.selectedChatLoad);
    return keyed(machineSessionKey(machineId, session.id), html`
      <voice-composer-dialog
        .capabilities=${this.sessionComposerCapabilities(state, runtimeAvailable)}
        .sessionId=${session.id}
        .machineId=${machineId}
        .cwd=${state.selectedWorkspace?.path ?? session.cwd}
        .projectId=${state.selectedWorkspace?.projectId}
        .workspaceId=${state.selectedWorkspace?.id}
        .promptHistory=${this.selectedPromptHistory(state)}
        .sending=${state.sendingPrompts[session.id] === true}
        .canSteer=${runtimeAvailable && state.status?.isStreaming === true}
        .isCompacting=${runtimeAvailable && state.status?.isCompacting === true}
        .queuedCompactionAvailable=${supportsPiWebCapability(this.selectedMachineRuntime(), PI_WEB_CAPABILITIES.queuedCompaction)}
        .onSendPrompt=${this.handleSendPrompt}
        .onDismiss=${() => { this.voiceComposerOpen = false; }}
      ></voice-composer-dialog>
    `);
  }

  private renderRadialMenu() {
    const state = this.radialMenu.state;
    if (state.kind === "closed") return null;
    return html`
      <app-radial-menu
        .holdMs=${this.radialMenu.holdMs}
        .arming=${state.kind === "arming" ? state.press : undefined}
        .layout=${state.kind === "open" ? state.layout : undefined}
        .hovered=${state.kind === "open" ? state.hovered : undefined}
        .entries=${state.kind === "open" ? this.radialEntries() : []}
      ></app-radial-menu>
    `;
  }

  private visibleWorkspacePanels(): QualifiedWorkspacePanelContribution[] {
    const workspace = this.state.selectedWorkspace;
    if (workspace === undefined) return [];
    const context = this.createWorkspacePanelContext(workspace);
    return this.plugins.getWorkspacePanels().filter((panel) => panel.visible?.(context) ?? true);
  }

  private workspacePanelEmptyState(): WorkspacePanelEmptyState {
    const project = this.state.selectedProject;
    if (this.state.isLoadingProjects) {
      return {
        title: "Loading projects…",
        body: "Looking for projects you have added to Forgerie.",
      };
    }
    if (project === undefined) {
      return this.state.projects.length === 0
        ? {
            title: "No projects yet",
            body: "Use Actions → Add Project to add a folder. Workspace tools will appear here after you choose a workspace.",
          }
        : {
            title: "Select a project",
            body: "Choose a project from the sidebar, then select a workspace to inspect files, Git, or terminals.",
          };
    }
    if (this.state.isLoadingWorkspaces) {
      return {
        title: "Loading workspaces…",
        body: `Preparing workspace tools for ${project.name}.`,
      };
    }
    if (this.state.workspaces.length === 0) {
      return {
        title: "No workspaces found",
        body: `${project.name} does not have any available workspaces. Try selecting the project again or re-adding it.`,
      };
    }
    return {
      title: "Select a workspace",
      body: `Choose a workspace in ${project.name} to inspect files, Git, or terminals.`,
    };
  }

  private sessionEmptyMessage(): string {
    if (this.state.isLoadingProjects) return "Loading projects…";
    if (this.state.selectedWorkspace !== undefined) return "Select or start a session.";
    if (this.state.selectedProject !== undefined) return "Select a workspace to start a session.";
    if (this.state.projects.length === 0) return "Add a project to start a session.";
    return "Select a project and workspace to start a session.";
  }

  /**
   * Up to five conversations to come back to, newest first. Agent-spawned
   * sessions belong to the session that owns them, and archived ones were
   * deliberately put away, so neither earns a place on the first screen.
   */
  private recentSessions(): SessionInfo[] {
    const sessions = this.state.globalSessions?.sessions ?? [];
    return [...sessions.filter((session) => session.archived !== true && session.agentSpawned !== true)]
      .sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified))
      .slice(0, 5);
  }

  /**
   * The first screen, not an apology. The brand says where you are, the one
   * filled primary starts the next conversation, and the recent list carries
   * you back into the last few — useful even while the inbox is a closed
   * drawer on a folded phone.
   */
  private renderSessionEmptyState() {
    const recents = this.recentSessions();
    const resolveLocation = createInboxLocationResolver(this.state.projects, this.state.workspacesByProjectId);
    const now = Date.now();
    return html`
      <div class="empty">
        <div class="empty-brand" aria-hidden="true"><span class="empty-brand-bar"></span>Forgerie</div>
        <span class="empty-message">${this.sessionEmptyMessage()}</span>
        <button
          class="empty-session-action"
          data-action="new-session"
          title=${NEW_SESSION_LABEL}
          aria-label=${NEW_SESSION_LABEL}
          @click=${() => { this.openNewSessionComposer(); }}
        >${renderNewSessionIcon()}<span>${NEW_SESSION_LABEL}</span></button>
        ${recents.length === 0 ? null : html`
          <div class="empty-recents" data-empty-recents>
            <h2 class="empty-recents-label" id="empty-recents-label">Recent</h2>
            <div role="list" aria-labelledby="empty-recents-label">
              ${recents.map((session) => {
                const location = resolveLocation(session.cwd);
                return html`
                  <button
                    class="empty-recent-row"
                    role="listitem"
                    @click=${() => { void this.selectInboxSession(session); }}
                  >
                    <span class="empty-recent-title">${session.name ?? (session.firstMessage || session.id)}</span>
                    <span class="empty-recent-meta">${location?.projectName ?? ""} · ${relativeTime(session.modified, now)}</span>
                  </button>
                `;
              })}
            </div>
          </div>
        `}
      </div>
    `;
  }

  /**
   * Whether a promoted tool currently owns the main surface.
   *
   * Deliberately false for a legacy full-width tool view that has no session
   * tab: that surface keeps the panel's own close control and tool strip,
   * because there is no tab to close it with.
   */
  private workspaceToolTabbed(): boolean {
    const view = this.state.mainView;
    if (view === "chat" || view === "navigation") return false;
    return sessionTabsOf(this.state.selectedSession).includes(view);
  }

  private sessionTabLabel(tool: QualifiedContributionId): string {
    const panel = this.plugins.getWorkspacePanels().find((candidate) => candidate.id === tool);
    if (panel !== undefined) return panel.title;
    const local = tool.slice(tool.indexOf(":") + 1);
    const leaf = local.split(".").at(-1) ?? local;
    return leaf === "" ? tool : (leaf[0] ?? "").toUpperCase() + leaf.slice(1);
  }

  private promoteSelectedWorkspaceTool(): void {
    const session = this.state.selectedSession;
    if (session === undefined) return;
    void this.sessions.setSessionTabs(session, promotedSessionTabs(sessionTabsOf(session), this.state.workspaceTool));
    // The promoted tool takes the main surface; a lingering peek would
    // otherwise present the same panel as a sheet over its own tab.
    this.panelPeek.close();
    this.selectSessionTab(this.state.workspaceTool);
  }

  private selectSessionTab(view: AppState["mainView"]): void {
    if (view === "navigation") return;
    if (view === "chat") {
      this.setState({ mainView: "chat" });
      this.updateUrl();
      this.git.updatePolling();
      return;
    }
    // Unlike openWorkspaceTool, a tab is the user's explicit request for the
    // tool to own the main surface; chat stays one tab away.
    if (view === "core:workspace.terminal") this.terminalAutoStartWorkspaceId = this.state.selectedWorkspace?.id;
    this.setState({ workspaceTool: view, mainView: view });
    this.updateUrl();
    this.refreshSelectedWorkspaceTool(view);
    this.git.updatePolling();
  }

  private closeSessionTab(view: AppState["mainView"]): void {
    if (view === "chat" || view === "navigation") return;
    const session = this.state.selectedSession;
    if (session === undefined) return;
    void this.sessions.setSessionTabs(session, closedSessionTabs(sessionTabsOf(session), view));
    if (this.state.mainView === view) {
      this.setState({ mainView: "chat" });
      this.updateUrl();
      this.git.updatePolling();
    }
  }

  /**
   * A session switch keeps only its own tabs' takeover; anything else lands
   * on chat. Within one session, a takeover whose tab vanished (closed on
   * another device, or dropped by server reconciliation) returns to chat too,
   * while a legacy full-width view that never had a tab is left alone.
   */
  private handleSessionTabsTransition(previous: AppState, next: AppState): void {
    const sessionChanged = previous.selectedSession?.id !== next.selectedSession?.id || selectedMachineId(previous) !== selectedMachineId(next);
    if (!sessionChanged) {
      const view = next.mainView;
      if (view === "chat" || view === "navigation") return;
      const lostTab = sessionTabsOf(previous.selectedSession).includes(view) && !sessionTabsOf(next.selectedSession).includes(view);
      if (lostTab) this.setState({ mainView: "chat" });
      return;
    }
    const reconciled = reconciledMainView(sessionTabsOf(next.selectedSession), next.mainView);
    if (reconciled !== next.mainView) this.setState({ mainView: reconciled });
  }

  private inboxShelves(): unknown[] {
    const context = this.createInboxShelfContext();
    return this.plugins.getInboxShelves(context).map((shelf) => shelf.render({ ...context, settings: pluginSettingsValues(this.pluginConfig, shelf.pluginId) }));
  }

  private createInboxShelfContext(): InboxShelfContext {
    return {
      machine: pluginMachineFromState(this.state),
      state: this.state,
      host: this.createWorkspaceHost(),
    };
  }

  private workspaceLabelItems(workspace: Workspace): WorkspaceLabelItem[] {
    return this.plugins.getWorkspaceLabelItems(this.createWorkspaceLabelContext(workspace));
  }

  private createWorkspaceLabelContext(workspace: Workspace): WorkspaceLabelContext {
    const machine = pluginMachineFromState(this.state);
    return {
      machine,
      workspace,
      state: this.state,
      files: this.createWorkspaceFiles(workspace, machine.id),
      host: this.createWorkspaceHost(),
    };
  }

  private createWorkspaceFiles(workspace: Workspace, machineId: string): WorkspaceFiles {
    return createPluginWorkspaceFiles(workspacesApi, workspace, machineId, () => { void this.files.refreshFiles(); });
  }

  private createWorkspaceHost(): WorkspaceHost {
    return {
      requestRender: () => { this.requestUpdate(); },
    };
  }

  private createWorkspacePanelContext(workspace: Workspace): WorkspacePanelContext {
    const machine = pluginMachineFromState(this.state);
    const machineId = machine.id;
    const createContext = (origin: string): WorkspacePanelContext => {
      const terminalCommandRuns = this.terminalCommandRunsForOrigin(origin, machineId);
      return installWorkspacePanelScope({
        machine,
        workspace,
        state: this.state,
        files: this.createWorkspaceFiles(workspace, machineId),
        prompt: this.createPromptEditor(),
        terminal: {
          open: (options) => { void this.openRuntimeTerminal(machineId, workspace, options); },
          runCommand: (input) => terminalCommandRuns.runCommand({ ...input, workspace }),
        },
        openTerminal: (options) => { void this.openRuntimeTerminal(machineId, workspace, options); },
        host: this.createWorkspaceHost(),
        piWebUnstable: { terminalCommandRuns, managedProcesses: this.managedProcessesRuntime(machineId) },
        fileTree: this.state.fileTree,
        expandedDirs: this.state.expandedDirs,
        selectedFilePath: this.state.selectedFilePath,
        selectedFileContent: this.state.selectedFileContent,
        fileTreeStale: this.state.fileTreeStale,
        gitStatus: this.state.gitStatus,
        selectedDiffPath: this.state.selectedDiffPath,
        selectedDiff: this.state.selectedDiff,
        selectedStagedDiff: this.state.selectedStagedDiff,
        gitStale: this.state.gitStale,
        activeTerminalCount: this.state.activeTerminalCount,
        selectedTerminalId: this.state.selectedTerminalId,
        terminalAutoStart: this.terminalAutoStartWorkspaceId === workspace.id,
        workspaceUploadDefaultFolder: workspaceEffectiveUploadFolder(workspace.effectiveConfig, this.workspaceUploadDefaultFolder),
        onRefreshFiles: () => { void this.files.refreshFiles(); },
        onExpandDir: (path: string) => { void this.files.expandDir(path); },
        onSelectFile: (path: string) => { void this.files.selectFile(path); },
        onStartWorkspaceUpload: (files, options) => this.files.startWorkspaceUpload(files, options),
        onCancelWorkspaceUpload: (batchId) => { this.files.cancelWorkspaceUpload(batchId); },
        onClearWorkspaceUpload: (batchId) => { this.files.clearWorkspaceUpload(batchId); },
        onRefreshGit: () => { void this.git.refreshGit(); },
        onSelectDiff: (path: string) => { void this.git.selectDiff(path); },
        onOpenSessionFile: (sessionFile: string) => { void this.openSessionByFile(sessionFile); },
        onPromoteSpawnedSession: (sessionFile: string) => { void this.promoteSpawnedSession(sessionFile); },
        onOpenDocumentPreview: (path: string) => { this.openDocumentPreview(path); },
        onDismissNotification: this.handleDismissNotification,
        onDismissAllNotifications: this.handleDismissAllNotifications,
        onSelectTerminal: (terminalId: string | undefined, options?: { replace?: boolean | undefined }) => { this.selectTerminal(terminalId, options); },
      }, createContext);
    };
    return createContext("core");
  }

  private getActions(): AppAction[] {
    return applyActiveShortcutPreferences(this.getDefaultActions(), this.shortcutConfig);
  }

  private getDefaultActions(): AppAction[] {
    return [...this.plugins.getActions(this.createPluginRuntimeContext()), ...this.sessionActions(), ...this.navigationFocusActions(), ...this.panelLayoutActions()];
  }

  private sessionActions(): AppAction[] {
    return [
      {
        id: "app.session.toggle-dictation",
        title: "Toggle Speech Dictation",
        description: "Start or finish speech dictation in the current session composer",
        shortcutContexts: ["workbench", "composer"],
        repeatable: false,
        group: "Session",
        enabled: this.state.mainView === "chat" && this.promptEditor?.canToggleDictation() === true,
        run: () => { this.promptEditor?.toggleDictation(); },
      },
      {
        /**
         * One key into a live microphone.
         *
         * The wheel's west bearing is a thumb gesture, so a keyboard had no
         * way to reach the same dialog. This is declared in every context on
         * purpose: the moment worth catching is the one where a reader is
         * already typing and decides to talk instead, and a binding that only
         * worked from the workbench would miss exactly that moment.
         *
         * The dialog opens already listening, so this key is the whole
         * gesture. It needs a session to speak to, and nothing else.
         */
        id: "app.session.speak",
        title: "Speak to Session",
        description: "Open the voice composer with the microphone already listening",
        shortcut: "ctrl+alt+enter",
        shortcutContexts: KEYBOARD_SHORTCUT_CONTEXTS,
        repeatable: false,
        group: "Session",
        enabled: this.state.selectedSession !== undefined && this.state.selectedSession.archived !== true,
        run: () => { this.voiceComposerOpen = true; },
      },
      {
        id: "app.sessions.cleanup",
        title: "Clean Up Sessions",
        description: "Preview and manually clean up idle or archived sessions on the selected machine",
        group: "Sessions",
        run: () => { this.openSessionCleanupDialog(); },
      },
    ];
  }

  private panelLayoutActions(): AppAction[] {
    return [
      appFullscreenAction(),
      {
        id: "app.layout.reset-navigation-panel-size",
        title: "Reset Navigation Panel Size",
        description: "Restore the navigation panel to its default width",
        group: "View",
        run: () => { this.resetResizablePanel("navigation"); },
      },
      {
        id: "app.layout.reset-workspace-panel-size",
        title: "Reset Workspace Panel Size",
        description: "Restore the workspace panel to its default width",
        group: "View",
        run: () => { this.resetResizablePanel("workspace"); },
      },
      {
        id: "app.layout.reset-panel-sizes",
        title: "Reset Panel Sizes",
        description: "Restore all side panels to their default widths",
        group: "View",
        run: () => { this.resetResizablePanels(); },
      },
    ];
  }

  private navigationFocusActions(): AppAction[] {
    return [
      {
        id: "app.navigation.focus-machines",
        title: "Focus Machines",
        description: "Move keyboard focus to the machine selector",
        group: "Navigation",
        run: () => this.focusNavigationSection("machines"),
      },
      {
        id: "app.navigation.focus-projects",
        title: "Focus Projects",
        description: "Move keyboard focus to the projects list",
        group: "Navigation",
        run: () => this.focusNavigationSection("projects"),
      },
      {
        id: "app.navigation.focus-workspaces",
        title: "Focus Workspaces",
        description: "Move keyboard focus to the workspaces list",
        group: "Navigation",
        run: () => this.focusNavigationSection("workspaces"),
      },
      {
        id: "app.navigation.focus-sessions",
        title: "Focus Sessions",
        description: "Move keyboard focus to the sessions list",
        group: "Navigation",
        run: () => this.focusNavigationSection("sessions"),
      },
    ];
  }

  private ensureGatewayPluginsLoaded(): Promise<void> {
    this.gatewayPluginLoadPromise ??= this.loadExternalPlugins();
    return this.gatewayPluginLoadPromise;
  }

  private async loadExternalPlugins(): Promise<void> {
    await this.registerExternalPlugins("Forgerie plugins", () => loadExternalPlugins());
  }

  private async loadPluginsForSelectedMachine(): Promise<void> {
    const machine = this.state.selectedMachine;
    if (machine?.kind !== "remote") return;
    await this.loadPluginsForMachine(machine);
  }

  private async loadPluginsForMachine(machine: Machine): Promise<void> {
    await this.ensureGatewayPluginsLoaded();
    if (machine.kind !== "remote" || this.loadedMachinePluginIds.has(machine.id)) return;
    const existing = this.machinePluginLoadPromises.get(machine.id);
    if (existing !== undefined) return existing;

    const load = this.registerExternalPlugins(`Forgerie plugins from ${machine.name}`, () => loadExternalPlugins(`api/machines/${encodeURIComponent(machine.id)}/pi-web-plugins/manifest.json`, {
      machineId: machine.id,
      shouldLoadPlugin: (entry) => this.plugins.shouldLoadRemotePlugin(entry.id, entry.machineSpecific),
    }))
      .then((loaded) => { if (loaded) this.loadedMachinePluginIds.add(machine.id); })
      .finally(() => { this.machinePluginLoadPromises.delete(machine.id); });
    this.machinePluginLoadPromises.set(machine.id, load);
    await load;
  }

  private async registerExternalPlugins(label: string, load: () => Promise<PiWebPluginRegistration[]>): Promise<boolean> {
    try {
      const registrations = await load();
      for (const registration of registrations) {
        try {
          this.plugins.register(registration);
        } catch (error) {
          console.warn(`Failed to register Forgerie plugin ${registration.id}`, error);
        }
      }
      this.applyPreferredTheme(false);
      this.requestUpdate();
      return true;
    } catch (error) {
      console.warn(`Failed to load ${label}`, error);
      return false;
    }
  }

  private createPromptEditor(): PluginPromptEditor {
    return {
      insertText: (text: string) => this.promptEditor?.insertTextAtSelection(text) ?? false,
      getText: () => this.promptEditor?.getText() ?? "",
      getSelection: () => this.promptEditor?.getSelection() ?? null,
    };
  }

  private createPluginRuntimeContext(): PluginRuntimeContext {
    const createContext = (origin: string): PluginRuntimeContext => installPluginRuntimeScope({
      state: this.state,
      prompt: this.createPromptEditor(),
      piWebUnstable: {
        terminalCommandRuns: this.terminalCommandRunsForOrigin(origin),
        managedProcesses: this.managedProcessesRuntime(selectedMachineId(this.state)),
        openSettings: (section) => { this.openSettings(section); },
      },
      openActionPalette: () => { this.setState({ actionPaletteOpen: true }); },
      focusPrompt: () => { void this.focusChatComposer(); },
      addProject: () => { this.setState({ projectDialogOpen: true }); },
      openPromptDialog: () => { this.setState({ promptDialogOpen: true }); },
      addMachine: () => { this.openMachineDialog(); },
      refreshSelectedMachine: async () => {
        await Promise.all([this.machines.refreshMachineHealth(), this.machines.refreshMachineRuntime()]);
      },
      removeSelectedMachine: () => this.removeMachine(),
      openSelectedMachine: () => { this.openSelectedMachine(); },
      configureAuth: () => this.auth.openLogin(),
      logoutAuth: () => this.auth.openLogout(),
      openThemePicker: () => { this.openThemeDialog(); },
      openModelPicker: () => this.openModelDialog(),
      cycleModel: () => this.sessions.cycleModel("forward"),
      openThinkingLevelPicker: () => this.openThinkingDialog(),
      selectMainView: (view) => { this.selectMainView(view); },
      selectWorkspaceTool: (tool) => { this.openWorkspaceTool(tool); },
      openTerminal: (options) => { this.openTerminal(options); },
      refreshFiles: () => this.files.refreshFiles(),
      refreshGit: () => this.git.refreshGit(),
      refreshAppData: () => this.refreshAppData(),
      checkForPiWebUpdates: () => this.piWebStatusController.checkForUpdates(),
      reloadPage: () => { this.hardReloadApp(); },
      deleteWorkspace: (workspace) => this.deleteWorkspace(workspace),
      startSession: () => { this.openNewSessionComposer(); },
      openNewSessionComposer: (initialLaunchMode) => { this.openNewSessionComposer(initialLaunchMode); },
      archiveSession: () => {
        const session = this.state.selectedSession;
        if (session !== undefined) void this.archiveInboxSession(session);
      },
      reloadSession: () => {
        this.chatOpeningAttempt += 1;
        return this.sessions.reloadSession();
      },
      deleteCachedNewSession: () => this.sessions.deleteCachedNewSession(),
      stopActiveWork: () => { this.handleStopActiveWork(); },
    }, createContext);
    return createContext("core");
  }

  private async deleteWorkspace(workspace = this.state.selectedWorkspace): Promise<void> {
    if (workspace === undefined) return;
    if (!canDeleteWorkspace(workspace)) {
      this.setState({ error: "Only secondary Git worktrees can be deleted" });
      return;
    }
    if (isWorkspaceDeletionPending(this.state, workspace)) return;
    const label = workspace.branch ?? workspace.label;
    const confirmed = confirm(`Delete workspace ${label}?\n\nThis will run git worktree remove and delete:\n${workspace.path}\n\nThe Git branch will not be deleted.`);
    if (!confirmed) return;

    const machineId = selectedMachineId(this.state);
    try {
      const run = await workspacesApi.deleteWorkspace(workspace.projectId, workspace.id, machineId);
      if (selectedMachineId(this.state) !== machineId) return;
      this.recordWorkspaceDeletionRun(run, machineId);
      const commandWorkspace = await this.workspaceForCommandRun(run);
      if (selectedMachineId(this.state) !== machineId) return;
      if (commandWorkspace !== undefined) void this.openRuntimeTerminal(machineId, commandWorkspace, { terminalId: run.terminalId });
    } catch (error) {
      if (selectedMachineId(this.state) === machineId) this.setState({ error: `Failed to start workspace deletion: ${errorMessage(error)}` });
    }
  }

  private async workspaceForCommandRun(run: TerminalCommandRun): Promise<Workspace | undefined> {
    let workspaces = this.state.selectedProject?.id === run.projectId ? this.state.workspaces : this.state.workspacesByProjectId[run.projectId];
    if (workspaces === undefined || workspaces.length === 0) workspaces = await this.workspaces.refreshProjectWorkspaces(run.projectId);
    return workspaces.find((workspace) => workspace.id === run.workspaceId);
  }

  private recordWorkspaceDeletionRun(run: TerminalCommandRun, machineId: string): void {
    if (selectedMachineId(this.state) !== machineId) return;
    const workspaceId = targetWorkspaceIdForRun(run);
    if (workspaceId === undefined) return;
    this.setState({ workspaceDeletionRuns: { ...this.state.workspaceDeletionRuns, [workspaceId]: run } });
    this.updateWorkspaceDeletionPolling();
  }

  private async refreshWorkspaceDeletionRuns(): Promise<void> {
    if (this.refreshingWorkspaceDeletionRuns) return;
    const machineId = selectedMachineId(this.state);
    const project = this.state.selectedProject;
    if (project === undefined) {
      this.setState({ workspaceDeletionRuns: {} });
      this.updateWorkspaceDeletionPolling();
      return;
    }

    this.refreshingWorkspaceDeletionRuns = true;
    try {
      const runs = await this.terminalCommandRunsForOrigin("core", machineId).listCommandRuns(workspaceDeletionRunFilter(project.id));
      if (selectedMachineId(this.state) !== machineId) return;
      const latestRuns = latestWorkspaceDeletionRuns(runs);
      this.setState({ workspaceDeletionRuns: latestRuns });
      for (const run of Object.values(latestRuns)) {
        if (!isWorkspaceDeletionRunPending(run)) await this.handleCompletedWorkspaceDeletionRun(run, machineId);
      }
    } catch (error) {
      console.warn("Failed to refresh workspace deletion runs", error);
    } finally {
      this.refreshingWorkspaceDeletionRuns = false;
      this.updateWorkspaceDeletionPolling();
    }
  }

  private updateWorkspaceDeletionPolling(): void {
    const hasPendingDeletion = Object.values(this.state.workspaceDeletionRuns).some(isWorkspaceDeletionRunPending);
    if (hasPendingDeletion && this.workspaceDeletionPollTimer === undefined) {
      this.workspaceDeletionPollTimer = window.setInterval(() => { void this.refreshWorkspaceDeletionRuns(); }, 1000);
      return;
    }
    if (!hasPendingDeletion && this.workspaceDeletionPollTimer !== undefined) {
      window.clearInterval(this.workspaceDeletionPollTimer);
      this.workspaceDeletionPollTimer = undefined;
    }
  }

  private async handleCompletedWorkspaceDeletionRun(run: TerminalCommandRun, machineId = selectedMachineId(this.state)): Promise<void> {
    if (selectedMachineId(this.state) !== machineId) return;
    const runKey = machineScopedKey(machineId, run.id);
    if (this.handledWorkspaceDeletionRunIds.has(runKey)) return;
    const workspaceId = targetWorkspaceIdForRun(run);
    if (workspaceId === undefined) return;
    this.handledWorkspaceDeletionRunIds.add(runKey);

    if (run.status === "succeeded") {
      await this.workspaces.refreshAfterWorkspaceDeleted(run.projectId, workspaceId);
      if (selectedMachineId(this.state) !== machineId) return;
      this.setState({ workspaceDeletionRuns: omitWorkspaceDeletionRun(this.state.workspaceDeletionRuns, workspaceId) });
      this.updateWorkspaceDeletionPolling();
      return;
    }

    if (run.status === "failed") {
      this.setState({ error: "Workspace deletion failed. See terminal output." });
      this.updateWorkspaceDeletionPolling();
    }
  }

  private openMachineDialog(): void {
    this.setState({ machineDialogOpen: true, error: "" });
  }

  private async submitMachineDialog(input: MachineDialogSubmit): Promise<void> {
    const machine = await this.machines.addMachine(input);
    if (machine !== undefined) {
      this.setState({ machineDialogOpen: false });
      this.schedulePiWebStatusRefresh();
    }
  }

  private async removeMachine(machine: Machine | undefined = this.state.selectedMachine): Promise<void> {
    if (machine === undefined || machine.kind === "local") return;
    if (!window.confirm(`Remove ${machine.name}?\n\nThis only removes it from this Forgerie gateway.`)) return;
    const wasSelected = this.state.selectedMachine?.id === machine.id;
    if (wasSelected) this.rememberCurrentMachineNavigation();
    const fallback = await this.machines.deleteMachine(machine, { selectFallback: !wasSelected });
    if (!this.state.machines.some((candidate) => candidate.id === machine.id)) this.machineNavigation.forget(machine.id);
    if (wasSelected && fallback !== undefined) await this.selectMachineWithMemory(fallback, { rememberCurrent: false });
  }

  private openSelectedMachine(): void {
    const machine = this.state.selectedMachine;
    if (machine?.kind !== "remote" || machine.baseUrl === undefined) return;
    window.open(machine.baseUrl, "_blank", "noopener,noreferrer");
  }

  private runAction(action: AppAction): void {
    void Promise.resolve()
      .then(() => action.run())
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Action failed: ${action.id}`, error);
        this.setState({ error: `Action failed: ${message}` });
      });
  }

  private async openModelDialog() {
    if (!this.selectedChatRuntimeAvailable()) return;
    const models = await this.sessions.listModels();
    const currentProvider = this.state.status?.model?.provider;
    const currentId = this.state.status?.model?.id;
    this.setState({
      modelDialog: {
        title: "Select Model",
        ...(currentProvider !== undefined && currentId !== undefined ? { selectedValue: `${currentProvider}/${currentId}` } : {}),
        options: models.map((model) => {
          const provider = model.provider ?? "";
          const id = model.id ?? "";
          const isCurrent = provider === currentProvider && id === currentId;
          return { value: `${provider}/${id}`, label: `${id}${isCurrent ? " ✓ current" : ""}`, description: provider };
        }),
      },
    });
  }

  private async pickModel(value: string) {
    this.setState({ modelDialog: undefined });
    if (!this.selectedChatRuntimeAvailable()) return;
    const slash = value.indexOf("/");
    if (slash <= 0) return;
    await this.sessions.setModel(value.slice(0, slash), value.slice(slash + 1));
  }

  private openThemeDialog() {
    const themes = this.plugins.getThemes();
    const resolution = this.resolveCurrentThemePreference(themes);
    const selectedThemeId = resolution.selectedTheme?.id;
    const autoValue = this.themePreference.auto ? THEME_AUTO_OFF_VALUE : THEME_AUTO_ON_VALUE;
    this.setState({
      themeDialog: {
        title: "Select Theme",
        selectedValue: selectedThemeId === undefined ? autoValue : `${THEME_OPTION_PREFIX}${selectedThemeId}`,
        options: [
          {
            value: autoValue,
            label: `Auto ${this.themePreference.auto ? "✓ on" : "off"}`,
            description: this.autoThemeDescription(resolution),
          },
          ...themes.map((theme) => ({
            value: `${THEME_OPTION_PREFIX}${theme.id}`,
            label: this.themeOptionLabel(theme, selectedThemeId),
            description: this.themeOptionDescription(theme),
          })),
        ],
      },
    });
  }

  private pickTheme(value: string) {
    this.setState({ themeDialog: undefined });
    if (value === THEME_AUTO_ON_VALUE || value === THEME_AUTO_OFF_VALUE) {
      const selectedThemeId = this.resolveCurrentThemePreference().selectedTheme?.id;
      if (selectedThemeId === undefined) return;
      this.themePreference = { themeId: selectedThemeId, auto: value === THEME_AUTO_ON_VALUE };
      this.applyPreferredTheme(true);
      return;
    }
    if (!value.startsWith(THEME_OPTION_PREFIX)) return;
    const themeId = value.slice(THEME_OPTION_PREFIX.length);
    const theme = this.plugins.getThemes().find((candidate) => candidate.id === themeId);
    if (theme === undefined) return;
    this.themePreference = { themeId: theme.id, auto: this.themePreference.auto };
    this.applyPreferredTheme(true);
  }

  /** Apply an inbox density choice now and remember it for the next visit. */
  private applyInboxDensity(density: InboxDensity): void {
    if (this.inboxDensity === density) return;
    this.inboxDensity = density;
    writeInboxDensityPreference(density);
  }

  private applyPreferredTheme(persist: boolean): void {
    const theme = this.resolveCurrentThemePreference().activeTheme;
    if (theme === undefined) return;
    this.activeThemeId = theme.id;
    applyPiWebTheme(theme);
    if (persist) writeStoredThemePreference(this.themePreference);
  }

  private resolveCurrentThemePreference(themes = this.plugins.getThemes()): ThemePreferenceResolution {
    return resolveThemePreference({
      themes,
      themePairs: this.plugins.getThemePairs(),
      preference: this.themePreference,
      prefersLight: this.systemPrefersLight(),
    });
  }

  private themePairForTheme(themeId: QualifiedContributionId): QualifiedThemePairContribution | undefined {
    return findThemePairForTheme(this.plugins.getThemePairs(), themeId);
  }

  private systemPrefersLight(): boolean {
    return this.systemLightThemeMedia?.matches ?? false;
  }

  private autoThemeDescription(resolution: ThemePreferenceResolution): string {
    if (!this.themePreference.auto) return "Follow the system light/dark preference when the selected theme has a pair.";
    if (resolution.selectedTheme === undefined) return "Follow the system light/dark preference when the selected theme has a pair.";
    if (resolution.selectedThemePair === undefined) return "On, but the selected theme has no light/dark pair, so it will stay selected.";
    return `On · ${resolution.selectedThemePair.name} follows the system ${this.systemPrefersLight() ? "light" : "dark"} preference.`;
  }

  private themeOptionLabel(theme: QualifiedThemeContribution, selectedThemeId: QualifiedContributionId | undefined): string {
    const markers = [
      ...(theme.id === selectedThemeId ? ["selected"] : []),
      ...(theme.id === this.activeThemeId && theme.id !== selectedThemeId ? ["active"] : []),
    ];
    return markers.length === 0 ? theme.name : `${theme.name} ✓ ${markers.join(" · ")}`;
  }

  private themeOptionDescription(theme: QualifiedThemeContribution): string {
    const parts: string[] = [theme.colorScheme];
    if (this.themePairForTheme(theme.id) !== undefined) parts.push("auto pair");
    if (theme.description !== undefined) parts.push(theme.description);
    return parts.join(" · ");
  }

  private async openThinkingDialog() {
    if (!this.selectedChatRuntimeAvailable()) return;
    const levels = await this.sessions.listThinkingLevels();
    const current = this.state.status?.thinkingLevel ?? "off";
    this.setState({
      thinkingDialog: {
        title: "Select Thinking Level",
        selectedValue: current,
        options: levels.map((level) => { const description = thinkingDescription(level); return { value: level, label: `${level}${level === current ? " ✓ current" : ""}`, ...(description === undefined ? {} : { description }) }; }),
      },
    });
  }

  private async pickThinking(value: string) {
    this.setState({ thinkingDialog: undefined });
    if (!this.selectedChatRuntimeAvailable()) return;
    if (value !== "") await this.sessions.setThinkingLevel(value);
  }

  private sendPrompt(text: string, streamingBehavior?: "steer" | "followUp", attachments?: import("../api").PromptAttachment[], delivery?: import("../../../shared/apiTypes").PromptAttachmentDelivery): void {
    const hasAttachments = attachments !== undefined && attachments.length > 0;
    if (!hasAttachments && streamingBehavior === undefined && this.auth.handleSlashCommand(text)) return;
    const intent = this.chatNavigationIntent;
    if (intent.kind === "opening") {
      void this.sessions.sendToSession(intent.session, intent.machineId, text, streamingBehavior, attachments, delivery);
      return;
    }
    void this.sessions.send(text, streamingBehavior, attachments, delivery);
  }

  // Stable handler identities for child components. Inlined arrow closures
  // would be a fresh reference on every render, forcing Lit to re-commit the
  // bindings each time the app re-renders; bound class fields keep them constant.
  private readonly handleSendPrompt = (text: string, streamingBehavior?: "steer" | "followUp", attachments?: import("../api").PromptAttachment[], delivery?: import("../../../shared/apiTypes").PromptAttachmentDelivery): void => {
    this.sendPrompt(text, streamingBehavior, attachments, delivery);
  };

  private readonly handleNewSessionFromComposer = (): void => {
    this.openNewSessionComposer();
  };

  private readonly handleStopActiveWork = (): void => {
    if (!this.selectedChatRuntimeAvailable()) return;
    void this.sessions.stopActiveWork();
  };

  private readonly handleDoubleEscapeAction = (action: "tree" | "fork"): void => {
    if (!this.selectedChatRuntimeAvailable()) return;
    void this.sessions.runCommand(`/${action}`);
  };

  /** The composer's tree button and double-Escape share one guarded path to `/tree`. */
  private readonly handleOpenSessionTree = (): void => {
    this.handleDoubleEscapeAction("tree");
  };

  private readonly handleClearServerQueue = (): void => {
    void this.sessions.clearServerQueue();
  };

  private readonly handleSessionLaunchRecoveryAction = (sessionId: string, action: ChatSessionLaunchRecoveryActionKind): void => {
    if (action === "retry") void this.sessions.retrySessionLaunch(sessionId);
    else if (action === "changeDestination") this.openSessionLaunchDestinationComposer(sessionId);
    else if (action === "refresh") void this.sessions.refreshSessionLaunchRecovery(sessionId);
    else void this.sessions.restoreSessionLaunchPrompt(sessionId);
  };

  private readonly handleDismissWarning = (dismissId: string): void => {
    void this.sessions.dismissWarning(dismissId);
  };

  private readonly handleSubmitAsk = (askId: string, submission: AskDraftSubmission): Promise<void> => this.sessions.submitAsk(askId, submission);

  private readonly handleAnswerDialog = (dialogId: string, value: ExtensionDialogAnswer): Promise<void> => this.sessions.answerDialog(dialogId, value);

  private readonly handleCancelDialog = (dialogId: string): Promise<void> => this.sessions.cancelDialog(dialogId);

  private readonly handleDismissClosedDialog = (dialogId: string): void => {
    this.sessions.dismissClosedDialog(dialogId);
  };

  private readonly handleDismissNotification = (notificationId: string): void => {
    void this.notifications.dismissNotification(notificationId);
  };

  private readonly handleDismissAllNotifications = (): void => {
    void this.notifications.dismissAll();
  };

  private readonly handleToggleWarnings = (): void => {
    const next = toggleSessionWarnings(this.sessionWarningVisibility);
    if (next === this.sessionWarningVisibility) return;
    this.sessionWarningVisibility = next;
    this.requestUpdate();
  };

  /** The composer picked a model; the session applies it. */
  private async applySelectedModel(model: { provider?: string; id?: string }): Promise<void> {
    if (model.provider === undefined || model.id === undefined) return;
    await this.sessions.setModel(model.provider, model.id);
  }

  private readonly handleSelectModel = (): void => {
    void this.openModelDialog();
  };

  private readonly handleSelectThinking = (): void => {
    void this.openThinkingDialog();
  };

  /**
   * Where the user is, in the one row that survives every size.
   *
   * The context bar carried this until the chrome bands were retired; the
   * composer inherits a shortened form rather than reviving a band for it.
   */
  /**
   * What the chat composer can do for the selected session.
   *
   * Built here rather than inferred inside the composer, so the same
   * declaration shape serves the new-session modal.
   */
  private sessionComposerCapabilities(state: AppState, runtimeAvailable: boolean): ComposerCapabilities {
    const branch = composerBranchIdentity(state.selectedWorkspace);
    return {
      ...(branch === undefined ? {} : { context: [{ id: "branch", kind: "branch" as const, label: branch.name, title: branch.title }] }),
      model: {
        ...(state.status?.model === undefined ? {} : { model: state.status.model }),
        ...(state.status?.thinkingLevel === undefined ? {} : { thinkingLevel: state.status.thinkingLevel }),
        availableThinkingLevels: state.availableThinkingLevels,
        changeable: runtimeAvailable,
        listModels: () => this.sessions.listModels(),
        onChooseModel: (model) => { void this.applySelectedModel(model); },
        onChooseThinkingLevel: (level) => { void this.sessions.setThinkingLevel(level); },
      },
      dictation: this.sessionDictationCapability(),
      stop: { stoppable: runtimeAvailable && isActive(state), onStop: this.handleStopActiveWork },
      ...(runtimeAvailable ? { tree: { onOpenTree: this.handleOpenSessionTree } } : {}),
      ...(this.canArchiveSelectedSession(state) ? { archive: { onArchiveAndNext: this.handleArchiveAndNext } } : {}),
      ...(state.status?.contextUsage === undefined ? {} : { contextUsage: state.status.contextUsage }),
    };
  }

  /** A chat still opening has a place but no runtime to ask about it yet. */
  private openingComposerCapabilities(workspace: Workspace | undefined): ComposerCapabilities {
    const branch = composerBranchIdentity(workspace);
    return {
      ...(branch === undefined ? {} : { context: [{ id: "branch", kind: "branch" as const, label: branch.name, title: branch.title }] }),
      dictation: this.sessionDictationCapability(),
    };
  }

  private sessionDictationCapability(): NonNullable<ComposerCapabilities["dictation"]> {
    return this.sessionDictationCapabilityValue;
  }

  private selectedPromptHistory(state: AppState): readonly string[] {
    const session = state.selectedSession;
    if (session === undefined) return [];
    let latestUserMessage: ChatLine | undefined;
    for (let index = state.messages.length - 1; index >= 0; index -= 1) {
      const message = state.messages[index];
      if (message?.role === "user") { latestUserMessage = message; break; }
    }

    const sessionIdentity = machineSessionKey(selectedMachineId(state), session.id);
    const cached = this.promptHistoryCache;
    if (cached?.sessionIdentity === sessionIdentity
      && cached.pageStart === state.messagePageStart
      && cached.latestUserMessage === latestUserMessage) return cached.entries;

    const entries = promptHistoryEntries(state.messages);
    this.promptHistoryCache = { sessionIdentity, pageStart: state.messagePageStart, latestUserMessage, entries };
    return entries;
  }

  private canArchiveSelectedSession(state: AppState): boolean {
    return state.selectedSession?.archived !== true && state.globalSessions !== undefined;
  }

  private readonly handleArchiveAndNext = (): void => {
    void this.archiveAndNext();
  };

  private readonly handleRetrySelectedChat = (): void => {
    const session = this.state.selectedSession;
    if (session === undefined) return;
    this.chatOpeningAttempt += 1;
    this.chatOpenTiming.begin(selectedChatTarget(selectedMachineId(this.state), session), { source: "retry" });
    void this.sessions.selectSession(session, { updateUrl: false });
  };

  private readonly handleSelectedLoadPaint = (load: SelectedChatLoad): void => {
    this.chatOpenTiming.markSelectedLoadPainted(load);
  };

  private selectedChatRuntimeAvailable(): boolean {
    const load = this.state.selectedChatLoad;
    const session = this.state.selectedSession;
    if (!selectedChatCanUseRuntime(load) || session === undefined) return false;
    return selectedChatTargetsEqual(load.target, selectedChatTarget(selectedMachineId(this.state), session));
  }

  private renderChatView(state: AppState, session: SessionInfo) {
    const machineId = selectedMachineId(state);
    const retry = isClientPendingStartSession(session) ? undefined : this.handleRetrySelectedChat;
    const sessionLaunchRecovery = this.sessions.getSessionLaunchRecovery(session.id);
    const pendingSessionLaunch = this.sessions.pendingSessionLaunchView(machineId, session.id);
    return html`
      <chat-view .chromeSummoned=${this.appShell.isChromeSummoned} .sessionId=${session.id} .sessionTitle=${sessionDisplayLabel(session)} .selectedMachineId=${machineId} .sessionCwd=${session.cwd} .selectedLoad=${state.selectedChatLoad} .openingAttempt=${this.chatOpeningAttempt} .messages=${state.messages} .pendingSessionLaunch=${pendingSessionLaunch} .messageStart=${state.messagePageStart} .messageEnd=${state.messagePageEnd} .messageTotal=${state.messagePageTotal} .hasMore=${state.messagePageStart > 0} .loadingMore=${state.isLoadingEarlierMessages} .isSendingPrompt=${state.sendingPrompts[session.id] === true} .isCompacting=${state.status?.isCompacting === true} .clientQueuedMessages=${state.clientQueuedSessionMessages[session.id] ?? []} .sessionLaunchRecovery=${sessionLaunchRecovery} .onSessionLaunchRecoveryAction=${this.handleSessionLaunchRecoveryAction} .status=${state.status} .activity=${state.activity} .pendingAsk=${state.pendingAsk} .askComposerDictation=${this.sessionDictationCapability()} .pendingDialogs=${state.pendingDialogs} .closedDialogs=${state.closedDialogs} .onAnswerDialog=${this.handleAnswerDialog} .onCancelDialog=${this.handleCancelDialog} .onDismissClosedDialog=${this.handleDismissClosedDialog} .askDraftSessionId=${machineSessionKey(machineId, session.id)} .onSubmitAsk=${this.handleSubmitAsk} .notificationInbox=${selectedNotificationView(state.selectedNotificationInbox)} .onClearServerQueue=${this.handleClearServerQueue} .onStopActiveWork=${this.handleStopActiveWork} .onDismissWarning=${this.handleDismissWarning} .warningsVisible=${!this.sessionWarningVisibility.collapsed} .onToggleWarnings=${this.handleToggleWarnings} .onLoadMore=${() => this.withChatPrependTransition(() => this.sessions.loadEarlierMessages())} .onRetry=${retry} .onOpenSession=${this.openCreatedSession} .onSelectedLoadPaint=${this.handleSelectedLoadPaint}></chat-view>
    `;
  }

  private renderOpeningChatIntent(intent: Extract<ChatNavigationIntent, { kind: "opening" }>) {
    const target = selectedChatTarget(intent.machineId, intent.session);
    const preview = this.openingChatPreview?.identity === unreadChatIdentity(intent.machineId, intent.session)
      ? this.openingChatPreview.view
      : undefined;
    const load = preview === undefined ? selectedChatLoading(target) : selectedChatPreviewReadable(target);
    return html`<chat-view .sessionId=${intent.session.id} .sessionTitle=${sessionDisplayLabel(intent.session)} .selectedMachineId=${intent.machineId} .sessionCwd=${intent.session.cwd} .selectedLoad=${load} .openingAttempt=${this.chatOpeningAttempt} .messages=${preview?.messages ?? []} .messageStart=${preview?.messagePageStart ?? 0} .messageEnd=${preview?.messagePageEnd ?? 0} .messageTotal=${preview?.messagePageTotal ?? 0} .clientQueuedMessages=${this.state.clientQueuedSessionMessages[intent.session.id] ?? []} .onSelectedLoadPaint=${this.handleSelectedLoadPaint}></chat-view>`;
  }

  private renderOpeningComposer(intent: Extract<ChatNavigationIntent, { kind: "opening" }>) {
    const workspace = workspaceForSessionCwd(this.state, intent.session.cwd);
    return html`<prompt-editor
      .sessionId=${intent.session.id}
      .cwd=${intent.session.cwd}
      .machineId=${intent.machineId}
      .projectId=${workspace?.projectId}
      .workspaceId=${workspace?.id}
      .promptHistory=${[]}
      .disabled=${intent.session.archived === true}
      .submissionAvailable=${true}
      .runtimeControlsAvailable=${false}
      .canSteer=${false}
      .isCompacting=${false}
      .doubleEscapeAction=${undefined}
      .sending=${this.state.sendingPrompts[intent.session.id] === true}
      .chromeSummoned=${this.appShell.isChromeSummoned}
      .capabilities=${this.openingComposerCapabilities(workspace)}
      .onSend=${this.handleSendPrompt}
      .onDoubleEscapeAction=${this.handleDoubleEscapeAction}
    ></prompt-editor>`;
  }

  private renderSelectedComposer(state: AppState, session: SessionInfo, runtimeAvailable: boolean) {
    return html`<prompt-editor
      .sessionId=${session.id}
      .cwd=${state.selectedWorkspace?.path ?? session.cwd}
      .machineId=${selectedMachineId(state)}
      .projectId=${state.selectedWorkspace?.projectId}
      .workspaceId=${state.selectedWorkspace?.id}
      .promptHistory=${this.selectedPromptHistory(state)}
      .disabled=${session.archived === true}
      .submissionAvailable=${true}
      .runtimeControlsAvailable=${runtimeAvailable}
      .canSteer=${runtimeAvailable && state.status?.isStreaming === true}
      .isCompacting=${runtimeAvailable && state.status?.isCompacting === true}
      .queuedCompactionAvailable=${supportsPiWebCapability(this.selectedMachineRuntime(), PI_WEB_CAPABILITIES.queuedCompaction)}
      .doubleEscapeAction=${state.status?.doubleEscapeAction}
      .sending=${state.sendingPrompts[session.id] === true}
      .chromeSummoned=${this.appShell.isChromeSummoned}
      .capabilities=${this.sessionComposerCapabilities(state, runtimeAvailable)}
      .onSend=${this.handleSendPrompt}
      .onDoubleEscapeAction=${this.handleDoubleEscapeAction}
    ></prompt-editor>`;
  }


  private clearChatNavigationIntentForToken(seq: number): void {
    if (this.chatNavigationIntent.kind !== "opening" || this.chatNavigationIntent.seq !== seq) return;
    this.chatNavigationIntent = { kind: "none" };
    this.chatOpenTiming.supersedeActive();
  }

  private clearChatNavigationIntentForSelectedSession(): void {
    const intent = this.chatNavigationIntent;
    const session = this.state.selectedSession;
    if (intent.kind !== "opening" || session === undefined) return;
    if (this.selectedSessionMatchesNavigationTarget(intent.machineId, intent.session)) this.chatNavigationIntent = { kind: "none" };
  }

  private selectedSessionMatchesNavigationTarget(machineId: string, target: Pick<SessionInfo, "id" | "cwd">): boolean {
    const session = this.state.selectedSession;
    if (session === undefined) return false;
    return selectedChatTargetsEqual(selectedChatTarget(selectedMachineId(this.state), session), selectedChatTarget(machineId, target));
  }

  /**
   * The sheet a drag pulls in, and the scrim it dims the session with.
   *
   * Both track the finger: the sheet by its own width, the scrim by how much of
   * it shows. A look that is abandoned costs nothing, which is what allows the
   * gesture to live anywhere rather than on an edge.
   *
   * The pin inside the sheet is the one route from a look to a decision. The
   * drag itself never writes intent.
   */
  /**
   * The press that asks for a side panel.
   *
   * One control with one meaning: this panel, on or off. Pressing it opens the
   * same sheet a drag opens; pressing it again puts the panel away, whether it
   * arrived as a sheet or was pinned into the layout.
   *
   * It must stay while a panel is docked. A docked panel has no sheet, so if
   * this were hidden there the panel could be pinned and never unpinned -- the
   * trap the seam arrow used to spring.
   */
  private renderPanelOpener(side: ShellPanel) {
    if (this.panelSurfacePresentation(side).visible) return null;
    const noun = side === "navigation" ? "sessions" : "workspace";
    return html`
      <app-panel-opener
        side=${side}
        controls=${`${side}-panel`}
        label=${`Show ${noun}`}
        .attention=${side === "navigation" ? this.navigationPanelOpenerAttention() : undefined}
        .onPress=${() => { this.panelPeek.open(side); }}
      ></app-panel-opener>
    `;
  }

  private navigationPanelOpenerAttention(): "blocked" | "unread" | undefined {
    return sessionInboxAttention(buildInboxBoard(
      this.state,
      this.unreadSessionIds,
      this.cachedUnreadCompletedAt,
    ).counts);
  }

  /**
   * The one place a side panel is rendered.
   *
   * A sheet and a docked column used to be two elements with two lifetimes, so
   * pinning closed one and opened the other and the panel visibly changed
   * hands. This is a single element whose presentation changes: overlaid while
   * peeked, in the layout once pinned, at the same width either way. Pinning
   * therefore moves nothing.
   */
  private renderPanelSurface(side: ShellPanel) {
    const presentation = this.panelSurfacePresentation(side);
    if (presentation.visible) this.mountedPanelSides.add(side);
    if (!this.mountedPanelSides.has(side)) return null;
    const label = side === "navigation" ? "Sessions" : "Workspace";
    const width = this.panelSurfaceWidth(side);
    return html`
      <aside
        id=${`${side}-panel`}
        class="panel-surface"
        data-side=${side}
        data-mode=${presentation.visible ? (presentation.peeked ? "sheet" : "docked") : "hidden"}
        ?data-tracking=${presentation.peeked && this.panelPeek.isTracking}
        ?hidden=${!presentation.visible}
        aria-hidden=${String(!presentation.visible)}
        role=${presentation.peeked ? "dialog" : "complementary"}
        aria-label=${label}
        style=${presentation.peeked ? `width: ${String(width)}px; --peek-progress: ${String(this.panelPeek.progress(side))}` : ""}
      >
        ${side === "navigation"
          ? this.renderNavigationPanel(this.renderPanelControls(side))
          : this.renderWorkspacePanel(this.workspaceToolTabbed() ? undefined : this.renderPanelControls(side))}
      </aside>
    `;
  }

  private panelSurfacePresentation(side: ShellPanel): { readonly peeked: boolean; readonly visible: boolean } {
    const docked = this.panelIntent.isDocked(side);
    // Docked wins. While a peek was still finishing, a panel that had just been
    // pinned kept rendering as a sheet and played the exit slide first.
    const peeked = !docked && this.panelPeek.panel === side;
    // A third presentation, and the reason visibility cannot just test peek and
    // pin: on a narrow shell the workspace panel is also a main view of its own.
    const isMainView = side === "workspace" && mainViewClass(this.state.mainView) === "workspace-view";
    const visible = (peeked || docked || isMainView)
      && (side !== "navigation" || !this.appShell.isMobileNavigationLayout || peeked);
    return { peeked, visible };
  }

  /**
   * The panel's own pin and close.
   *
   * They belong to the panel, not to the thing presenting it: a docked panel
   * used to have neither, so it could be pinned and never unpinned. They sit at
   * the edge that faces the session, in the panel's own header row rather than
   * in a band above it.
   */
  /**
   * The close for the sessions list when it is a main view rather than a panel.
   *
   * It cannot pin -- a main view is not docked -- and closing it means going
   * back to the conversation. This replaces the back arrow that used to sit in
   * the inbox header, so the list is closed the same way wherever it appears.
   */
  private renderMainViewControls() {
    return html`
      <app-panel-controls
        noun="sessions"
        controls="navigation-panel"
        .pinnable=${false}
        .onClose=${() => { this.selectMainView("chat"); }}
      ></app-panel-controls>
    `;
  }

  private renderPanelControls(side: ShellPanel) {
    const docked = this.panelIntent.isDocked(side);
    const promotable = side === "workspace" && this.state.selectedSession !== undefined && this.state.selectedWorkspace !== undefined;
    return html`
      <app-panel-controls
        noun=${side === "navigation" ? "sessions" : "workspace"}
        controls=${`${side}-panel`}
        .pinned=${docked}
        .pinnable=${docked || canDockAt(this.clientWidth, side)}
        .promoteTitle=${promotable ? `Open ${this.sessionTabLabel(this.state.workspaceTool)} as tab` : undefined}
        .onPromote=${promotable ? () => { this.promoteSelectedWorkspaceTool(); } : undefined}
        .onPin=${() => { this.togglePanelPin(side); }}
        .onClose=${() => { this.closePanelSurface(side); }}
      ></app-panel-controls>
    `;
  }

  /** Pinning keeps the sheet exactly where it is; the layout opens around it. */
  private togglePanelPin(side: ShellPanel) {
    if (this.panelIntent.isDocked(side)) {
      this.panelIntent.toggle(side);
      return;
    }
    this.panelIntent.keep(side);
    this.panelPeek.settle();
  }

  private closePanelSurface(side: ShellPanel) {
    if (this.panelIntent.isDocked(side)) {
      this.panelIntent.toggle(side);
      return;
    }
    if (this.panelPeek.panel === side) {
      this.panelPeek.close();
      return;
    }
    // Old URLs can still name a workspace tool as the main view. Keep them
    // readable, but let the panel's own Close return to the resident chat.
    if (side === "workspace" && mainViewClass(this.state.mainView) === "workspace-view") this.selectMainView("chat");
  }

  /**
   * One width, whichever presentation the panel is in.
   *
   * Two numbers here is what made pinning jump: the sheet was a fixed 360 and
   * the column was a share of the window. The panel keeps whatever width it was
   * given, narrowed only where the shell is too small to hold it.
   */
  private panelSurfaceWidth(side: ShellPanel): number {
    return Math.min(this.panelResize.panelWidth(side), Math.round(this.clientWidth * 0.85));
  }

  /**
   * The docked track takes the width the panel already has.
   *
   * Without this the column is sized by its own rule -- a share of the window --
   * and the panel jumps at the moment of pinning, which is exactly the hand-off
   * this work removed. Set only where a panel is docked, so the collapsed rule
   * still wins when it is not.
   */
  private dockedWidthStyle(): string {
    const sides: ShellPanel[] = ["navigation", "workspace"];
    return sides
      .filter((side) => this.panelIntent.isDocked(side))
      .map((side) => `--${side}-panel-width: ${String(this.panelSurfaceWidth(side))}px;`)
      .join(" ");
  }

  private renderPeekScrim() {
    const panel = this.panelPeek.panel;
    if (panel === undefined) return null;
    const label = panel === "navigation" ? "sessions" : "workspace";
    return html`
      <button
        type="button"
        class="peek-scrim"
        aria-label=${`Close ${label}`}
        ?data-tracking=${this.panelPeek.isTracking}
        style=${`opacity: ${String(this.panelPeek.progress(panel))}`}
        @click=${() => { this.dismissPeekOnTap(); }}
      ></button>
    `;
  }

  /**
   * A tap beside the sheet puts it away. A drag that ended beside the sheet was
   * the user moving it, and it keeps whatever position they left it in.
   */
  private dismissPeekOnTap(): void {
    if (this.panelPeek.takeConsumedTap()) return;
    this.panelPeek.close();
  }

  /** The only promotion from a look to a decision. */
  private pinPeekedPanel(panel: ShellPanel): void {
    this.panelPeek.close();
    this.panelIntent.keep(panel);
  }

  /** Dismisses the summoned navigation overlay by returning to the session underneath. */
  private renderNavigationScrim(state: AppState) {
    if (!this.appShell.isMobileNavigationLayout || state.mainView !== "navigation") return null;
    return html`<button type="button" class="navigation-scrim" aria-label="Close navigation" @click=${() => { this.selectMainView("chat"); }}></button>`;
  }

  private renderContextBar() {
    if (this.appShell.isChromeSummoned) return null;
    if (!this.appShell.isMobileNavigationLayout) return null;
    const location = this.contextBarLocation();
    return html`
      <app-context-bar
        .machines=${this.state.machines}
        .machine=${location.machine}
        .project=${location.project}
        .workspace=${location.workspace}
        .session=${location.session}
        .refreshControl=${this.appShell.shouldShowAppRefreshInContextBar() ? this.renderAppRefresh() : undefined}
        .onOpenSection=${(section: NavigationSection) => { this.openNavigationSection(section); }}
        .onShowActions=${() => { this.setState({ actionPaletteOpen: true }); }}
      ></app-context-bar>
    `;
  }

  private contextBarLocation(): AppContextBarLocation {
    const intent = this.chatNavigationIntent;
    if (intent.kind !== "opening") {
      return {
        machine: this.state.selectedMachine,
        project: this.state.selectedProject,
        workspace: this.state.selectedWorkspace,
        session: this.state.selectedSession,
      };
    }
    const workspace = workspaceForSessionCwd(this.state, intent.session.cwd);
    return {
      machine: machineForId(this.state, intent.machineId),
      project: workspace === undefined ? undefined : projectForId(this.state, workspace.projectId),
      workspace,
      session: intent.session,
    };
  }

  /** The band exists only while this session has promoted tabs: chat alone pays no chrome. */
  private renderSessionTabs() {
    const tools = sessionTabsOf(this.state.selectedSession);
    if (tools.length === 0) return null;
    const tabs: AppSessionTab[] = [
      { id: "chat", label: "Chat", closeable: false },
      ...tools.map((tool): AppSessionTab => ({ id: tool, label: this.sessionTabLabel(tool), closeable: true })),
    ];
    return html`
      <app-session-tabs
        .tabs=${tabs}
        .selected=${reconciledMainView(tools, this.state.mainView)}
        .onSelect=${(view: AppState["mainView"]) => { this.selectSessionTab(view); }}
        .onClose=${(view: AppState["mainView"]) => { this.closeSessionTab(view); }}
      ></app-session-tabs>
    `;
  }

  private renderAppRefresh() {
    return html`<app-refresh-control .onReload=${() => { this.hardReloadApp(); }}></app-refresh-control>`;
  }

  override render() {
    const state = this.state;
    const intent = this.chatNavigationIntent;
    const runtimeAvailable = this.selectedChatRuntimeAvailable();
    return html`
      <div
        class=${`${this.panelIntent.shellClass(state.mainView)} ${shellLayoutModeClass(this.appShell.layoutMode)} ${chromeDisclosureClass(this.appShell.disclosure)}`}
        style=${`${this.panelResize.shellStyle({ navigation: this.resizablePanelConstraints("navigation"), workspace: this.resizablePanelConstraints("workspace") })} ${this.dockedWidthStyle()}`}
        @pointerdown=${(event: PointerEvent) => {
          this.panelPeek.onPointerDown(event);
          // TEMPORARILY DISABLED (2026-08-31): the long-press radial menu over
          // the chat. Restore by re-adding: this.radialMenu.onPointerDown(event);
        }}
        @pointermove=${(event: PointerEvent) => { this.panelPeek.onPointerMove(event); this.radialMenu.onPointerMove(event); }}
        @pointerup=${(event: PointerEvent) => { this.panelPeek.onPointerUp(event); this.radialMenu.onPointerUp(event); }}
        @pointercancel=${() => { this.panelPeek.onPointerCancel(); this.radialMenu.onPointerCancel(); }}
        @touchmove=${(event: TouchEvent) => { this.panelPeek.onTouchMove(event); this.radialMenu.onTouchMove(event); }}
        @wheel=${(event: WheelEvent) => { this.panelPeek.onWheel(event); }}
      >
        ${this.renderRadialMenu()}
        ${this.renderVoiceComposer()}
        ${this.renderPeekScrim()}
        ${this.renderPanelSurface("navigation")}
        ${this.renderNavigationPanelEdgeControl()}
        <main class=${mainViewClass(state.mainView)}>
          ${this.renderPanelOpener("navigation")}
          ${this.renderPanelOpener("workspace")}
          ${this.renderContextBar()}
          ${this.renderSessionTabs()}
          ${this.renderGlobalError(state)}
          ${this.renderNavigationScrim(state)}
          <div class="mobile-navigation-panel">${this.appShell.isMobileNavigationLayout
            ? this.renderNavigationPanel(this.renderMainViewControls())
            : null}</div>
          ${intent.kind === "opening" ? html`
            ${this.renderOpeningChatIntent(intent)}
            ${this.renderOpeningComposer(intent)}
          ` : state.selectedSession ? html`
            ${this.renderChatView(state, state.selectedSession)}
            ${this.renderSelectedComposer(state, state.selectedSession, runtimeAvailable)}
            ${state.commandDialog !== undefined ? html`<command-picker .title=${state.commandDialog.title} .options=${state.commandDialog.options} .onPick=${(value: string) => this.sessions.respondToCommand(state.commandDialog?.requestId ?? "", value)} .onCancel=${() => { this.sessions.cancelCommand(); }}></command-picker>` : null}
            ${state.modelDialog !== undefined ? html`<command-picker title=${state.modelDialog.title} .searchable=${true} .options=${state.modelDialog.options} .selectedValue=${state.modelDialog.selectedValue} .onPick=${(value: string) => { void this.pickModel(value); }} .onCancel=${() => { this.setState({ modelDialog: undefined }); }}></command-picker>` : null}
            ${state.thinkingDialog !== undefined ? html`<command-picker title=${state.thinkingDialog.title} .options=${state.thinkingDialog.options} .selectedValue=${state.thinkingDialog.selectedValue} .onPick=${(value: string) => { void this.pickThinking(value); }} .onCancel=${() => { this.setState({ thinkingDialog: undefined }); }}></command-picker>` : null}
          ` : this.renderSessionEmptyState()}
        </main>
        ${this.renderWorkspacePanelEdgeControl()}
        ${this.renderPanelSurface("workspace")}
        ${state.newSessionComposer.kind === "open" ? html`<new-session-composer
          .initialDestination=${state.newSessionComposer.initialDestination}
          .initialLaunchMode=${state.newSessionComposer.initialLaunchMode ?? "switch"}
          .recoverySeedId=${state.newSessionComposer.recoverySeedId}
          .catalog=${this.newSessionDestinationCatalog}
          .loadAgentDefaults=${(cwd: string, machineId: string) => sessionsApi.newSessionModels(cwd, machineId)}
          .dictation=${this.sessionDictationCapability()}
          .onCancel=${() => { this.closeNewSessionComposer(); }}
          .onSubmit=${(intent: NewSessionLaunchIntent) => this.submitNewSession(intent)}
          .onClaimRecoveryDraft=${(recoverySeedId: string) => this.sessions.claimSessionLaunchRecoveryDraft(recoverySeedId)}
          .onReturnRecoveryDraft=${(recoverySeedId: string, snapshot: SessionLaunchRecoveryDraftSnapshot) => { this.sessions.returnSessionLaunchRecoveryDraft(recoverySeedId, snapshot); }}
        ></new-session-composer>` : null}
        ${state.workspaceManagementDialog !== undefined ? html`<workspace-management-dialog
          .dialogState=${state.workspaceManagementDialog}
          .projects=${state.projects}
          .onSelectProject=${(project: Project) => { void this.openWorkspaceManagementDialogWorkspaceStep(project); }}
          .onCloseProject=${(project: Project) => {
            this.setState({ workspaceManagementDialog: undefined });
            void this.projects.closeProject(project.id);
          }}
          .onAddProject=${() => {
            this.setState({ workspaceManagementDialog: undefined, projectDialogOpen: true });
          }}
          .onConfirmManage=${(workspace: Workspace) => { void this.confirmManageWorkspace(workspace); }}
          .onBack=${() => {
            const current = state.workspaceManagementDialog;
            if (current !== undefined) {
              this.setState({ workspaceManagementDialog: { step: "project" } });
            }
          }}
          .onCancel=${() => { this.setState({ workspaceManagementDialog: undefined }); }}
        ></workspace-management-dialog>` : null}
        ${state.authDialog !== undefined ? html`<auth-dialog .state=${state.authDialog} .onChooseMethod=${(authType: "oauth" | "api_key") => { void this.auth.chooseLoginMethod(authType); }} .onSelectProvider=${(providerId: string, authType: "oauth" | "api_key") => { void this.auth.selectLoginProvider(providerId, authType); }} .onLogoutProvider=${(providerId: string) => { void this.auth.logoutProvider(providerId); }} .onOAuthInput=${(value: string) => { this.auth.updateOAuthInput(value); }} .onOAuthRespond=${(value?: string) => { void this.auth.respondOAuth(value); }} .onOAuthCancel=${() => { void this.auth.cancelOAuth(); }} .onCancel=${() => { this.auth.closeDialog(); }}></auth-dialog>` : null}
        ${state.actionPaletteOpen ? html`<action-palette .actions=${this.getActions()} .onRun=${(action: AppAction) => { this.setState({ actionPaletteOpen: false }); this.runAction(action); }} .onCancel=${() => { this.setState({ actionPaletteOpen: false }); }}></action-palette>` : null}
        ${this.renderSessionTreeNavigator(state)}
        ${state.projectDialogOpen ? html`<project-dialog .machineId=${selectedMachineId(state)} .onSubmit=${(path: string, create: boolean) => this.projects.addProject(path, create)} .onCancel=${() => { this.setState({ projectDialogOpen: false }); }}></project-dialog>` : null}
        ${state.promptDialogOpen ? html`<prompt-dialog .machineId=${selectedMachineId(state)} .onClose=${() => { this.setState({ promptDialogOpen: false }); }}></prompt-dialog>` : null}
        ${state.machineDialogOpen ? html`<machine-dialog .error=${state.error} .onSubmit=${(input: MachineDialogSubmit) => this.submitMachineDialog(input)} .onCancel=${() => { this.setState({ machineDialogOpen: false }); }}></machine-dialog>` : null}
        ${this.sessionCleanupDialog !== undefined ? html`<session-cleanup-dialog .preview=${this.sessionCleanupDialog.preview} .previewRequest=${this.sessionCleanupDialog.previewRequest} .result=${this.sessionCleanupDialog.result} .loading=${this.sessionCleanupDialog.loading === true} .running=${this.sessionCleanupDialog.running === true} .error=${this.sessionCleanupDialog.error ?? ""} .onPreview=${(request: SessionCleanupRequest) => { void this.previewSessionCleanup(request); }} .onRun=${(request: SessionCleanupRequest) => { void this.runSessionCleanup(request); }} .onClose=${() => { this.closeSessionCleanupDialog(); }}></session-cleanup-dialog>` : null}
        ${state.themeDialog !== undefined ? html`<command-picker title=${state.themeDialog.title} .options=${state.themeDialog.options} .selectedValue=${state.themeDialog.selectedValue} .onPick=${(value: string) => { this.pickTheme(value); }} .onCancel=${() => { this.setState({ themeDialog: undefined }); }}></command-picker>` : null}
        ${this.settingsSection !== undefined ? html`<settings-dialog .section=${this.settingsSection} .machine=${state.selectedMachine} .machineRuntime=${this.selectedMachineRuntime()} .actions=${this.getDefaultActions()} .onNavigate=${(section: SettingsSection) => { this.navigateSettings(section); }} .onClose=${() => { this.closeSettings(); }} .onConfigSaved=${(config: PiWebConfigValues) => { this.applyClientConfig(config); }} .inboxDensity=${this.inboxDensity} .onInboxDensityChange=${(density: InboxDensity) => { this.applyInboxDensity(density); }} .pluginSettings=${this.plugins.getPluginSettings()} .onRefreshMachineRuntime=${async (machineId: string) => { await this.machines.refreshMachineRuntime(machineId); }}></settings-dialog>` : null}
      </div>
    `;
  }

  private renderGlobalError(state: AppState) {
    if (state.error === "") return null;
    if (isSelectedChatFailureGlobalError(state)) return null;
    return html`<div class="error">${state.error}</div>`;
  }

  static override styles = appStyles;
}

function createPluginRegistry(): PluginRegistry {
  const registry = new PluginRegistry();
  registry.register({ id: "core", plugin: corePlugin });
  registry.register({ id: "themes", plugin: themePackPlugin });
  return registry;
}

function pluginMachineFromState(state: Pick<AppState, "selectedMachine">): PluginMachine {
  const machine = state.selectedMachine;
  if (machine !== undefined) return { id: machine.id, name: machine.name, kind: machine.kind };
  return { id: "local", name: "local", kind: "local" };
}

function sessionDisplayLabel(session: Pick<SessionInfo, "id" | "firstMessage" | "name">): string {
  const name = session.name?.trim();
  const firstMessage = session.firstMessage.trim();
  return name !== undefined && name !== "" ? name : firstMessage !== "" ? firstMessage : session.id;
}

function isClientPendingStartSession(session: SessionInfo): boolean {
  return "clientPendingStart" in session && session.clientPendingStart === true;
}

function isSelectedChatFailureGlobalError(state: Pick<AppState, "error" | "selectedChatLoad" | "selectedMachine" | "selectedSession">): boolean {
  const load = state.selectedChatLoad;
  const session = state.selectedSession;
  return load.kind === "failed"
    && session !== undefined
    && state.error === load.error
    && selectedChatTargetsEqual(load.target, selectedChatTarget(selectedMachineId(state), session));
}

function machineForId(state: Pick<AppState, "machines" | "selectedMachine">, machineId: string): Machine | undefined {
  if (state.selectedMachine?.id === machineId) return state.selectedMachine;
  return state.machines.find((machine) => machine.id === machineId);
}

function workspaceForSessionCwd(state: Pick<AppState, "workspaces" | "workspacesByProjectId">, cwd: string): Workspace | undefined {
  const selectedWorkspace = state.workspaces.find((workspace) => workspace.path === cwd);
  if (selectedWorkspace !== undefined) return selectedWorkspace;
  return Object.values(state.workspacesByProjectId).flat().find((workspace) => workspace.path === cwd);
}

function projectForId(state: Pick<AppState, "projects">, projectId: string): Project | undefined {
  return state.projects.find((project) => project.id === projectId);
}

function unreadChatIdentity(machineId: string, session: Pick<SessionInfo, "id" | "cwd">): string {
  return JSON.stringify([machineId, session.id, session.cwd]);
}

function selectedChatIdentity(state: Pick<AppState, "selectedMachine" | "selectedSession">): string | undefined {
  const session = state.selectedSession;
  return session === undefined ? undefined : unreadChatIdentity(selectedMachineId(state), session);
}

function machineUnreadInputsChanged(previous: AppState, next: AppState): boolean {
  return previous.machines !== next.machines;
}

function sessionUnreadIdsInputsChanged(previous: AppState, next: AppState): boolean {
  return previous.globalSessions !== next.globalSessions
    || previous.sessions !== next.sessions
    || selectedMachineId(previous) !== selectedMachineId(next);
}

function unreadPresenceInputsChanged(previous: AppState, next: AppState): boolean {
  return previous.machines !== next.machines
    || selectedMachineId(previous) !== selectedMachineId(next)
    || previous.projects !== next.projects
    || previous.workspaces !== next.workspaces
    || previous.workspacesByProjectId !== next.workspacesByProjectId;
}

function machineActivitySubscriptionInputsChanged(previous: AppState, next: AppState): boolean {
  return previous.machines !== next.machines
    || previous.machineStatuses !== next.machineStatuses
    || (previous.selectedMachine?.id ?? "local") !== (next.selectedMachine?.id ?? "local");
}

function shouldSubscribeToMachineActivity(machine: Machine, health: MachineHealth | undefined): boolean {
  return shouldRefreshMachineActivity(machine, health);
}

function shouldRefreshMachineActivity(machine: Machine, health: MachineHealth | undefined): boolean {
  if (machine.kind === "local") return true;
  const status = health?.status ?? machine.status;
  return status === undefined || status === "unknown" || status === "online";
}

function patchChangesState(state: AppState, patch: Partial<AppState>): boolean {
  return Object.entries(patch).some(([key, value]) => Reflect.get(state, key) !== value);
}

function sameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function sameCompletedAtRecord(a: Record<string, string>, b: Readonly<Record<string, string>>): boolean {
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  return keysA.every((k) => a[k] === b[k]);
}

function isActive(state: Pick<AppState, "status" | "activity">): boolean {
  return isSessionActive(state.status, state.activity);
}

function isTerminalEvent(event: BrowserRealtimeEvent): event is TerminalUiEvent {
  return event.type === "terminal.created" || event.type === "terminal.exited" || event.type === "terminal.closed";
}

function emptyWorkspaceRouteSurface(): WorkspaceRouteSurface {
  return {};
}

function machineScopedKey(machineId: string, value: string): string {
  return JSON.stringify([machineId, value]);
}

function remoteRouteRestoreRetryDelay(attempt: number): number {
  const index = Math.min(attempt, REMOTE_ROUTE_RESTORE_RETRY_DELAYS_MS.length - 1);
  return REMOTE_ROUTE_RESTORE_RETRY_DELAYS_MS[index] ?? 30_000;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function omitWorkspaceDeletionRun(runs: Record<string, TerminalCommandRun>, workspaceId: string): Record<string, TerminalCommandRun> {
  return Object.fromEntries(Object.entries(runs).filter(([candidate]) => candidate !== workspaceId));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => { resolve(); }));
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function thinkingDescription(level: string): string | undefined {
  switch (level) {
    case "off": return "No reasoning";
    case "minimal": return "Very brief reasoning (~1k tokens)";
    case "low": return "Light reasoning (~2k tokens)";
    case "medium": return "Moderate reasoning (~8k tokens)";
    case "high": return "Deep reasoning (~16k tokens)";
    case "xhigh": return "Maximum reasoning (~32k tokens)";
    default: return undefined; // unknown level from a newer pi: no description
  }
}

/**
 * Icons for the two wedges that are not workspace panels.
 *
 * Drawn here rather than reused from the tab strip because they answer a
 * different question: on the wheel they name a direction, not a tab. Three
 * lines mean a list, which is what the inbox is; three dots mean the rest,
 * which is what overflow holds.
 */
function renderRadialIcon(kind: "inbox" | "more"): TemplateResult {
  if (kind === "inbox") {
    return html`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" />
    </svg>`;
  }
  return html`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
  </svg>`;
}

/**
 * A wedge shows a short count, or nothing.
 *
 * A panel may return rendered markup as its badge. There is no room for that
 * on a wedge and a truncated badge would be worse than an absent one, so
 * anything that is not a short scalar is dropped.
 */
function countBadge(badge: string | number | TemplateResult | undefined): string | undefined {
  if (typeof badge === "number") return badge > 0 ? String(badge) : undefined;
  if (typeof badge !== "string") return undefined;
  const trimmed = badge.trim();
  return trimmed === "" || trimmed.length > 3 ? undefined : trimmed;
}

/**
 * Build a SessionBoard from the current AppState global sessions for use in
 * archiveAndNext. Location data is omitted because triageQueue only needs
 * state classification (session + statuses + activities + unread).
 */
function buildInboxBoard(
  state: Pick<AppState, "globalSessions">,
  unreadSessionIds: ReadonlySet<string>,
  unreadCompletedAt: Readonly<Record<string, string>>,
) {
  const projection = state.globalSessions ?? { sessions: [], statuses: {}, activities: {} };
  return deriveSessionInboxBoard({
    projection,
    unreadSessionIds,
    unreadCompletedAt,
    locationOf: (s) => ({
      projectId: s.cwd,
      projectName: s.cwd,
      projectPath: s.cwd,
    }),
  });
}

