#!/usr/bin/env node
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import { WorkspaceActivityService } from "./activity/workspaceActivityService.js";
import { registerWorkspaceActivityRoutes } from "./activity/workspaceActivityRoutes.js";
import { SessionEventHub } from "./realtime/sessionEventHub.js";
import { AuthService } from "./sessions/authService.js";
import { bootstrapAndFreezeGlobalExtensionProviders } from "./sessions/globalProviderPolicy.js";
import { registerAuthRoutes } from "./sessions/authRoutes.js";
import { ModelCatalogRefresher } from "./sessions/modelCatalogRefresher.js";
import { PiSessionService } from "./sessions/piSessionService.js";
import { createPiSessionManagerGateway } from "./sessions/piSessionManagerGateway.js";
import { BacklogClaimStore } from "./backlog/backlogClaimStore.js";
import { BacklogService } from "./backlog/backlogService.js";
import { registerBacklogRoutes } from "./backlog/backlogRoutes.js";
import { withBacklogClaimRelease } from "./backlog/backlogArchive.js";
import { markdownBacklogProvider } from "./backlog/markdownBacklog.js";
import { createGitHubBacklogProvider } from "./backlog/githubBacklog.js";
import { GitHubApp } from "./github/githubApp.js";
import { GitHubAppStore } from "./github/githubAppStore.js";
import { GitHubIssueClient } from "./github/githubIssues.js";
import { GitHubAgent } from "./github/githubAgent.js";
import { GitHubAuthorTrust } from "./github/githubTrust.js";
import { registerGitHubRoutes } from "./github/githubRoutes.js";
import { PullRequestStore } from "./github/pullRequestStore.js";
import { PullRequestService } from "./github/pullRequestService.js";
import { registerPullRequestRoutes } from "./github/pullRequestRoutes.js";
import { defaultSessionNameIndexFilePath } from "./sessions/sessionNameIndex.js";
import { registerSessionRoutes } from "./sessions/sessionRoutes.js";
import { registerProcessRoutes } from "./sessions/processRoutes.js";
import { SessionNotificationStore } from "./sessions/sessionNotificationStore.js";
import { initializeSessionArchive } from "./sessions/sessionArchiveInitialization.js";
import { SessionArchiveStore, defaultSessionArchiveFilePath } from "./sessions/sessionArchiveStore.js";
import { SessionPinStore, defaultSessionPinFilePath } from "./sessions/sessionPinStore.js";
import { SessionTabsStore, defaultSessionTabsFilePath } from "./sessions/sessionTabsStore.js";
import { FileSessionUnreadPersistence, SessionUnreadStore, defaultSessionUnreadFilePath } from "./sessions/sessionUnreadStore.js";
import { ProjectScopedSpawnTargetResolver } from "./sessions/spawnTargetResolver.js";
import { RegisteredProjectWorkspaceCwds } from "./workspaces/projectWorkspaceCwds.js";
import { ProjectService } from "./projects/projectService.js";
import { ProjectStore, projectStorePath } from "./storage/projectStore.js";
import { WorkspaceService } from "./workspaces/workspaceService.js";
import { SessionWorktreeStore } from "./workspaces/sessionWorktreeStore.js";
import { SessionWorktrees } from "./workspaces/sessionWorktrees.js";
import { UserSessionWorktrees, registerSessionWorktreeRoutes } from "./workspaces/sessionWorktreeRoutes.js";
import { sessiondSocketPath } from "../sessiond/config.js";
import { TerminalService } from "./terminals/terminalService.js";
import { registerTerminalRoutes } from "./terminals/terminalRoutes.js";
import { getPiWebRuntimeComponent } from "./piWebStatus.js";
import { SESSIOND_RUNTIME_CAPABILITIES } from "../shared/capabilities.js";
import { agentSessionDirEnvKeys, effectivePiWebConfig, maxUploadBytes, offlineModeEnabled, piWebDataDir } from "../config.js";
import { createActiveAgentProfileDescriptor } from "../sessiond/activeAgentProfile.js";
import { applyAgentHttpIdleTimeout } from "./sessiond/agentHttpDispatcher.js";
import { sessionServiceDependencies } from "./sessiond/sessionServiceDependencies.js";
import { pinAgentDirEnv, scrubNonAgentVisibleEnvKeys } from "./sessiond/agentProcessEnvironment.js";
import { usesPiCodingAgentStateCompatibility } from "../shared/activeAgentProfile.js";
import { PromptResourceCatalogService } from "./resources/promptResourceCatalog.js";
import { AgentDirPromptLibrary } from "./resources/promptLibrary.js";
import { registerPromptLibraryRoutes } from "./resources/promptLibraryRoutes.js";
import { registerPromptResourceRoutes } from "./resources/promptResourceRoutes.js";

const daemonEnvironment: NodeJS.ProcessEnv = Object.freeze({ ...process.env });
const { config } = effectivePiWebConfig({ env: daemonEnvironment });
const activeAgentProfile = createActiveAgentProfileDescriptor({
  command: config.agent.command,
  dir: config.agent.dir,
  sessionDirEnvKeys: agentSessionDirEnvKeys(config.agent.command),
});
const app = Fastify({ logger: true, bodyLimit: maxUploadBytes(daemonEnvironment, config) });
await app.register(fastifyWebsocket);

// Agent-executed processes (bash tool, terminals, subsessions) are spawned from
// this process and inherit its environment, so hide the daemon's own
// configuration keys before any of them can start. The daemon keeps using the
// captured daemonEnvironment above; its runtime stores resolve their paths from
// it explicitly below.
const scrubbedEnvKeys = scrubNonAgentVisibleEnvKeys(process.env);
app.log.info({ scrubbedEnvKeys }, "daemon-only environment keys hidden from agent processes");
if (pinAgentDirEnv(process.env, { dir: activeAgentProfile.dir, usesPiProfileEnv: usesPiCodingAgentStateCompatibility(activeAgentProfile.command) })) {
  app.log.info({ agentDir: activeAgentProfile.dir }, "PI_CODING_AGENT_DIR pinned to the active agent profile");
}

const runtime = await createSessionDaemonRuntime();
registerSessionDaemonRoutes(runtime);
await listenSessionDaemon(runtime);

type SessionDaemonRuntime = Awaited<ReturnType<typeof createSessionDaemonRuntime>>;

async function createSessionDaemonRuntime() {
  // Apply the active agent profile's httpIdleTimeoutMs before any other
  // startup work so even catalog-refresh fetches run under the configured
  // HTTP idle timeouts (issue #113).
  const appliedHttpIdleTimeout = applyAgentHttpIdleTimeout({ agentDir: activeAgentProfile.dir, cwd: process.cwd() });
  if (appliedHttpIdleTimeout.warning !== undefined) {
    app.log.warn({ httpIdleTimeoutMs: appliedHttpIdleTimeout.timeoutMs }, appliedHttpIdleTimeout.warning);
  } else {
    app.log.info({ httpIdleTimeoutMs: appliedHttpIdleTimeout.timeoutMs }, "applied agent profile HTTP idle timeout to the session daemon HTTP stack");
  }
  const eventHub = new SessionEventHub();
  const notificationStore = new SessionNotificationStore();
  const unreadStore = new SessionUnreadStore({
    persistence: new FileSessionUnreadPersistence(defaultSessionUnreadFilePath(daemonEnvironment)),
    onPersistenceError(operation, error) {
      app.log.error({ err: error, operation }, "session unread persistence failed");
    },
  });
  await unreadStore.load();
  const archiveStore = new SessionArchiveStore(defaultSessionArchiveFilePath(daemonEnvironment));
  await initializeSessionArchive(archiveStore.initialize(), app.log);
  const backlogClaims = new BacklogClaimStore(join(piWebDataDir(daemonEnvironment), "backlog-claims.json"));
  await backlogClaims.initialize();
  await backlogClaims.releaseSessions((await archiveStore.list()).map((record) => record.sessionId));
  const githubStore = new GitHubAppStore(join(piWebDataDir(daemonEnvironment), "github-app.json"));
  await githubStore.initialize();
  const fetchGitHub = (input: string, init?: RequestInit) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(30_000) });
  const github = new GitHubApp({ store: githubStore, fetch: fetchGitHub });
  const githubTrust = new GitHubAuthorTrust({ fetch: fetchGitHub });
  const githubIssues = new GitHubIssueClient({ app: github, fetch: fetchGitHub, trust: githubTrust });
  const pullStore = new PullRequestStore(join(piWebDataDir(daemonEnvironment), "pull-requests.json"));
  await pullStore.initialize();
  const githubAgent: GitHubAgent = new GitHubAgent({ app: github, fetch: fetchGitHub, trust: githubTrust, onPullCreated: (input): Promise<void> => pulls.created(input) });
  const pinStore = new SessionPinStore(defaultSessionPinFilePath(daemonEnvironment));
  const tabsStore = new SessionTabsStore(defaultSessionTabsFilePath(daemonEnvironment));
  const workspaceActivity = new WorkspaceActivityService(eventHub);
  const auth = await AuthService.create({ agentDir: activeAgentProfile.dir, logger: app.log });
  // Capture providers registered by global extensions while the runtime is
  // still mutable, then freeze every later extension-provider mutation before
  // any real session can load project resources.
  await bootstrapAndFreezeGlobalExtensionProviders(auth.runtime, activeAgentProfile.dir, app.log);
  // The shared model runtime is constructed offline so request paths never
  // wait on provider-catalog fetches; this is the single bounded network
  // refresher, and auth changes (login/logout) ask it for a prompt run. It
  // stays fully inert when the operator asked for offline behavior.
  const catalogRefresher = new ModelCatalogRefresher({
    runtime: auth.runtime,
    logger: app.log,
    offline: offlineModeEnabled(daemonEnvironment),
  });
  catalogRefresher.start();
  auth.subscribe(() => { catalogRefresher.requestRefresh(); });
  // Cross-workspace session relationships are reported regardless of whether
  // agents may spawn sessions: children can predate a config change, and the
  // session tree should stay honest about them either way.
  const projectWorkspaceDeps = { projects: new ProjectService(new ProjectStore(projectStorePath(daemonEnvironment))), workspaces: new WorkspaceService() };
  const projectWorkspaces = new RegisteredProjectWorkspaceCwds(projectWorkspaceDeps);
  const spawnTargets = config.spawnSessions ? new ProjectScopedSpawnTargetResolver(projectWorkspaceDeps) : undefined;
  const worktreeStore = new SessionWorktreeStore(join(piWebDataDir(daemonEnvironment), "session-worktrees.json"));
  await worktreeStore.initialize(await archiveStore.list());
  const sessionWorktrees: SessionWorktrees = new SessionWorktrees(worktreeStore, {
    publish(record) {
      const event = { type: "session.worktree", worktree: record } as const;
      eventHub.publishGlobal(event);
      for (const id of new Set([...(record.sessionId === undefined ? [] : [record.sessionId]), ...record.transcripts.map((item) => item.id)])) eventHub.publish(id, event);
    },
    async beforeRemoval(record) {
      const affected = await sessions.prepareWorktreeRemoval(record.path);
      for (const cwd of new Set([record.path, ...affected.map((session) => session.cwd)])) terminals.closeForCwd(cwd);
      return affected;
    },
  });
  await sessionWorktrees.initialize();
  const sessions: PiSessionService = new PiSessionService(eventHub, sessionServiceDependencies({
    modelRuntime: auth.runtime,
    agentDir: activeAgentProfile.dir,
    archiveStore: withBacklogClaimRelease(archiveStore, backlogClaims),
    pinStore,
    tabsStore,
    workspaceActivity,
    logger: app.log,
    ...(spawnTargets === undefined ? {} : { spawnTargets }),
    projectWorkspaces,
    sessionWorktrees,
    subsessionsEnabled: config.subsessions,
    askUserEnabled: config.askUser,
    codemodeEnabled: config.codemode,
    github: {
      read: (cwd, request) => githubAgent.read(cwd, request),
      write: (cwd, id, request) => githubAgent.write(cwd, id, request),
      watch: (cwd, id, action, number) => action === "start" ? pulls.watch({ id, cwd }, number) : pulls.stopRef({ id, cwd }),
    },
    pullRequestWatches: { isWatching: (id) => pullStore.isWatching(id), stop: (id, reason) => pulls.stop(id, reason) },
    extensionDialogsTimeoutMs: config.extensionDialogsTimeoutMs,
    notificationStore,
    unreadStore,
    catalogRefreshStatus: catalogRefresher,
    sessionManager: createPiSessionManagerGateway({
      agentDir: activeAgentProfile.dir,
      env: daemonEnvironment,
      sessionDirEnvKeys: activeAgentProfile.sessionDirEnvKeys,
      sessionNameIndexFilePath: defaultSessionNameIndexFilePath(daemonEnvironment),
      onSessionNameIndexPersistenceError: (operation, error) => {
        app.log.error({ err: error, operation }, "session name index persistence failed");
      },
    }),
  }));
  const pulls: PullRequestService = new PullRequestService({ github: githubAgent, store: pullStore,
    sessions: { inspect: (ref) => sessions.inspectPullSession(ref), wake: (ref, notice, current) => sessions.wakePullSession(ref, notice, current) },
    publish: (link) => {
      eventHub.publish(link.session.id, { type: "session.pull-request", link });
      eventHub.publishGlobal({ type: "session.pull-request", link });
      sessions.publishPullWatchStatus(link.session.id);
    },
    onError: (error, sessionId) => { app.log.error({ err: error, sessionId }, "pull request watch failed"); },
  });
  auth.subscribe((change) => { sessions.applyAuthChange(change); });
  const terminals = new TerminalService(eventHub, workspaceActivity);
  const promptResources = new PromptResourceCatalogService({ agentDir: activeAgentProfile.dir });
  const promptLibrary = new AgentDirPromptLibrary(activeAgentProfile.dir);
  const runtimeComponent = Object.freeze({
    ...getPiWebRuntimeComponent("sessiond", SESSIOND_RUNTIME_CAPABILITIES),
    activeAgentProfile,
  });
  const userSessions = new UserSessionWorktrees(sessionWorktrees, sessions);
  const backlog = new BacklogService({ projects: projectWorkspaceDeps.projects, claims: backlogClaims, userSessions, sessions, isArchived: (id) => archiveStore.isArchived(id),
    providers: [markdownBacklogProvider, createGitHubBacklogProvider({ issues: githubIssues })] });
  return { eventHub, workspaceActivity, auth, sessions, terminals, unreadStore, activeAgentProfile, runtimeComponent, catalogRefresher, promptResources, promptLibrary, userSessions, backlog, github, pulls };
}

function registerSessionDaemonRoutes({ eventHub, workspaceActivity, auth, sessions, terminals, runtimeComponent, promptResources, promptLibrary, userSessions, backlog, github, pulls }: SessionDaemonRuntime): void {
  registerBacklogRoutes(app, backlog);
  registerGitHubRoutes(app, github);
  registerPullRequestRoutes(app, pulls);
  registerWorkspaceActivityRoutes(app, workspaceActivity);
  registerAuthRoutes(app, auth);
  registerSessionWorktreeRoutes(app, userSessions);
  registerSessionRoutes(app, sessions, eventHub, "", userSessions);
  registerProcessRoutes(app, sessions);
  registerTerminalRoutes(app, terminals);
  registerPromptResourceRoutes(app, promptResources);
  registerPromptLibraryRoutes(app, promptLibrary);

  app.get("/health", () => ({
    ok: true,
    activeSessions: sessions.activeCount(),
    checkedAt: new Date().toISOString(),
    version: {
      component: runtimeComponent.component,
      label: runtimeComponent.label,
      ...(runtimeComponent.runtimeVersion === undefined ? {} : { runtimeVersion: runtimeComponent.runtimeVersion }),
      stale: false,
      available: runtimeComponent.available,
    },
  }));

  app.get("/runtime", () => runtimeComponent);
}

async function listenSessionDaemon({ auth, sessions, terminals, unreadStore, catalogRefresher, pulls }: SessionDaemonRuntime): Promise<void> {
  pulls.start();
  let shuttingDown = false;
  async function shutdown(signal: NodeJS.Signals): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "shutting down session daemon");
    const attempt = async (operation: string, run: () => void | Promise<void>): Promise<void> => {
      try {
        await run();
      } catch (error: unknown) {
        process.exitCode = 1;
        app.log.error({ err: error, operation }, "session daemon shutdown operation failed");
      }
    };
    await attempt("dispose PR watches", () => { pulls.dispose(); });
    await attempt("dispose terminals", () => { terminals.dispose(); });
    await attempt("dispose catalog refresher", () => { catalogRefresher.dispose(); });
    await attempt("dispose auth", () => { auth.dispose(); });
    await attempt("dispose sessions", () => sessions.dispose());
    await attempt("flush session unread state", () => unreadStore.flush());
    await attempt("close server", () => app.close());
  }

  process.once("SIGINT", (signal) => { void shutdown(signal); });
  process.once("SIGTERM", (signal) => { void shutdown(signal); });

  // Runs while the daemon serves. Sessions an agent made while no daemon was
  // watching are unmarked, and only their parents' transcripts still say so;
  // without this they stay in the inbox forever. Reading every transcript is
  // slow, so it must never gate startup or a listing.
  void sessions.repairSpawnMarks().then(
    (report) => { if (report !== undefined && report.marked > 0) app.log.info(report, "recovered agent-spawned session marks"); },
    (error: unknown) => { app.log.warn({ err: error }, "agent-spawned mark repair failed"); },
  );

  const portValue = daemonEnvironment["PI_WEB_SESSIOND_PORT"];
  const port = portValue !== undefined && portValue !== "" ? Number(portValue) : undefined;
  const host = daemonEnvironment["PI_WEB_SESSIOND_HOST"] ?? "127.0.0.1";

  if (port !== undefined) {
    await app.listen({ port, host });
  } else {
    const path = sessiondSocketPath(daemonEnvironment);
    await mkdir(dirname(path), { recursive: true });
    await rm(path, { force: true });
    await app.listen({ path });
    process.on("exit", () => void rm(path, { force: true }));
  }
}
