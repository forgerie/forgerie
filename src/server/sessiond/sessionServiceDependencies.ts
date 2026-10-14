import type { PiSessionServiceDependencies } from "../sessions/piSessionService.js";

/**
 * The collaborators sessiond constructs, in the shape the assembly needs them.
 *
 * Every field is required unless the capability itself is optional, so a
 * collaborator the daemon stops constructing cannot silently vanish from the
 * session service.
 */
export interface SessionServiceDependencyInput {
  agentDir: string;
  durableReader: NonNullable<PiSessionServiceDependencies["durableReader"]>;
  decisionHints?: PiSessionServiceDependencies["decisionHints"];
  managedProcesses?: PiSessionServiceDependencies["managedProcesses"];
  sessionSearch?: PiSessionServiceDependencies["sessionSearch"];
  /** Daemon-lifetime session archive, constructed against the captured daemon environment. */
  archiveStore: NonNullable<PiSessionServiceDependencies["archiveStore"]>;
  /** Daemon-lifetime pinned-session catalog, constructed against the captured daemon environment. */
  pinStore: NonNullable<PiSessionServiceDependencies["pinStore"]>;
  /** Daemon-lifetime promoted-tab catalog, constructed against the captured daemon environment. */
  tabsStore: NonNullable<PiSessionServiceDependencies["tabsStore"]>;
  sessionManager: PiSessionServiceDependencies["sessionManager"];
  modelRuntime: PiSessionServiceDependencies["modelRuntime"];
  workspaceActivity: NonNullable<PiSessionServiceDependencies["workspaceActivity"]>;
  logger: NonNullable<PiSessionServiceDependencies["logger"]>;
  notificationStore: NonNullable<PiSessionServiceDependencies["notificationStore"]>;
  unreadStore: NonNullable<PiSessionServiceDependencies["unreadStore"]>;
  /** Read-only view of the background refresher; see the assembly below. */
  catalogRefreshStatus: NonNullable<PiSessionServiceDependencies["catalogRefreshStatus"]>;
  /** Omitted when the operator has not enabled session spawning. */
  spawnTargets?: NonNullable<PiSessionServiceDependencies["spawnTargets"]>;
  projectWorkspaces?: NonNullable<PiSessionServiceDependencies["projectWorkspaces"]>;
  sessionWorktrees?: NonNullable<PiSessionServiceDependencies["sessionWorktrees"]>;
  projectTools?: PiSessionServiceDependencies["projectTools"];
  workspaceServices?: PiSessionServiceDependencies["workspaceServices"];
  triggers?: PiSessionServiceDependencies["triggers"];
  /** Whether agents may post structured question sets to the browser. */
  askUserEnabled: boolean;
  /** Whether hosted sessions start with Pi's `codemode` tool active. */
  codemodeEnabled: boolean;
  /** Durable child agents; omitted when the operator has not enabled them. */
  durableChildAgents?: NonNullable<PiSessionServiceDependencies["durableChildAgents"]>;
  /** GitHub work on each session's own repo, as Forgerie's GitHub App. */
  github: NonNullable<PiSessionServiceDependencies["github"]>;
  azurePr?: PiSessionServiceDependencies["azurePr"];
  pullRequestWatches?: PiSessionServiceDependencies["pullRequestWatches"];
  /** Auto-cancel delay for extension dialogs whose extension set no timeout; `0` waits forever. */
  extensionDialogsTimeoutMs: number;
  /** Reads the `provider/model-id` that writes session titles; `undefined` uses each session's model. */
  sessionTitleModel?: () => string | undefined;
}

/**
 * Map sessiond's constructed collaborators onto the session service's
 * dependencies.
 *
 * Extracted from `sessiond.ts`, which starts a daemon as an import side effect
 * and so cannot be loaded by a test. This function performs no side effects and
 * constructs nothing, so lifting it changes no startup ordering; it exists only
 * so a test can build a service the way the daemon does and assert what a user
 * is actually told.
 */
export function sessionServiceDependencies(input: SessionServiceDependencyInput): PiSessionServiceDependencies {
  return {
    modelRuntime: input.modelRuntime,
    durableReader: input.durableReader,
    agentDir: input.agentDir,
    ...(input.decisionHints === undefined ? {} : { decisionHints: input.decisionHints }),
    ...(input.managedProcesses === undefined ? {} : { managedProcesses: input.managedProcesses }),
    ...(input.sessionSearch === undefined ? {} : { sessionSearch: input.sessionSearch }),
    archiveStore: input.archiveStore,
    pinStore: input.pinStore,
    tabsStore: input.tabsStore,
    workspaceActivity: input.workspaceActivity,
    logger: input.logger,
    ...(input.spawnTargets === undefined ? {} : { spawnTargets: input.spawnTargets }),
    ...(input.projectWorkspaces === undefined ? {} : { projectWorkspaces: input.projectWorkspaces }),
    ...(input.sessionWorktrees === undefined ? {} : { sessionWorktrees: input.sessionWorktrees }),
    ...(input.projectTools === undefined ? {} : { projectTools: input.projectTools }),
    ...(input.workspaceServices === undefined ? {} : { workspaceServices: input.workspaceServices }),
    ...(input.triggers === undefined ? {} : { triggers: input.triggers }),
    askUserEnabled: input.askUserEnabled,
    codemodeEnabled: input.codemodeEnabled,
    ...(input.durableChildAgents === undefined ? {} : { durableChildAgents: input.durableChildAgents }),
    github: input.github,
    ...(input.azurePr === undefined ? {} : { azurePr: input.azurePr }),
    ...(input.pullRequestWatches === undefined ? {} : { pullRequestWatches: input.pullRequestWatches }),
    extensionDialogsTimeoutMs: input.extensionDialogsTimeoutMs,
    ...(input.sessionTitleModel === undefined ? {} : { sessionTitleModel: input.sessionTitleModel }),
    notificationStore: input.notificationStore,
    unreadStore: input.unreadStore,
    // Read-only, so session startup can tell a waiting user that provider
    // model lists are refreshing at the same time.
    catalogRefreshStatus: input.catalogRefreshStatus,
    sessionManager: input.sessionManager,
  };
}
