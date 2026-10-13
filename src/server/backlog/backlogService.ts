import { GITHUB_LOGIN_WARNING } from "./githubBacklog.js";
import type { BacklogScope } from "../../shared/backlog.js";
import type { BacklogSettingsStore } from "./backlogSettingsStore.js";
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import type { BacklogDetailResponse, BacklogLaunchRequest, BacklogLaunchResponse, BacklogListResponse, BacklogProviderId, BacklogReleaseRequest, BacklogReleaseResponse } from "../../shared/apiTypes.js";
import type { ProjectService } from "../projects/projectService.js";
import type { UserSessionWorktrees } from "../workspaces/sessionWorktreeRoutes.js";
import type { SessionRouteService } from "../sessions/sessionService.js";
import type { BacklogClaimStore } from "./backlogClaimStore.js";
import { BacklogError } from "./backlogError.js";
import type { BacklogProvider } from "./backlogProvider.js";
import { canonicalBacklogRoot, defaultBacklogProviders, scanProjectBacklog } from "./backlogScanner.js";

interface BacklogDependencies {
  projects: Pick<ProjectService, "list" | "requireProject">;
  claims: BacklogClaimStore;
  userSessions: Pick<UserSessionWorktrees, "start">;
  sessions: Pick<SessionRouteService, "stop">;
  isArchived: (sessionId: string) => Promise<boolean>;
  providers?: readonly BacklogProvider[];
  settings?: BacklogSettingsStore;
}

/** Requests that name no provider address markdown items, as every request did before providers existed. */
const DEFAULT_PROVIDER: BacklogProviderId = "markdown";

export class BacklogService {
  private readonly pending = new Map<string, { projectId: string; provider: BacklogProviderId; itemId: string; fingerprint: string; promise: Promise<BacklogLaunchResponse> }>();
  private readonly providers: readonly BacklogProvider[];
  constructor(private readonly deps: BacklogDependencies) { this.providers = deps.providers ?? defaultBacklogProviders; }

  async list(scope: BacklogScope = "mine"): Promise<BacklogListResponse> {
    const claims = await this.deps.claims.list();
    const options = await this.scanOptions(scope);
    const projects = await this.deps.projects.list();
    const scans = await Promise.all(projects.map((project) => scanProjectBacklog(project, claims, this.providers, options)));
    const warnings = scans.flatMap((scan) => scan.warnings);
    // The username is host-wide. Offer its fix once, not once for each GitHub project.
    const loginWarning = warnings.find((warning) => warning.provider === "github" && warning.message === GITHUB_LOGIN_WARNING);
    return { projects: projects.map((project, index) => ({ projectId: project.id, providers: scans[index]?.sources ?? [] })), items: scans.flatMap((scan) => scan.entries.map((entry) => entry.item)), warnings: warnings.filter((warning) => warning.provider !== "github" || warning.message !== GITHUB_LOGIN_WARNING || warning === loginWarning), generatedAt: new Date().toISOString() };
  }
  async detail(projectId: string, itemId: string, provider: BacklogProviderId = DEFAULT_PROVIDER, scope: BacklogScope = "mine"): Promise<BacklogDetailResponse> {
    const { entry, selected } = await this.readEntry(projectId, itemId, provider, scope);
    return { item: entry.item, body: entry.body, initialPrompt: selected.prompt(entry), ...(entry.imageSummary === undefined ? {} : { imageSummary: entry.imageSummary }) };
  }
  private async readEntry(projectId: string, itemId: string, provider: BacklogProviderId, scope: BacklogScope) {
    const selected = this.providers.find((candidate) => candidate.id === provider);
    if (selected === undefined) throw new BacklogError("not-found", `Backlog provider ${provider} is not enabled`);
    const project = await this.requireProject(projectId);
    const scan = await scanProjectBacklog(project, await this.deps.claims.list(), [selected], await this.scanOptions(scope));
    const failure = scan.warnings.find((warning) => warning.kind === "project-error" || warning.kind === "scan-limit"
      || warning.kind === "provider-auth" || warning.kind === "provider-install"
      || warning.kind === "provider-unavailable" && scan.entries.length === 0);
    if (failure !== undefined) throw new BacklogError("unavailable", failure.message);
    const entry = scan.entries.find(({ item }) => item.id === itemId);
    if (entry === undefined) throw new BacklogError("not-found", "Backlog item not found or invalid");
    return { entry, selected };
  }
  launch(projectId: string, itemId: string, input: BacklogLaunchRequest, provider: BacklogProviderId = DEFAULT_PROVIDER, scope: BacklogScope = "mine"): Promise<BacklogLaunchResponse> {
    const key = JSON.stringify([projectId, provider, itemId, input.requestId, scope]);
    const fingerprint = createHash("sha256").update(JSON.stringify([
      input.start.cwd, input.start.modelSpec ?? null, input.start.thinkingLevel ?? null,
      input.start.destination?.kind ?? null, input.start.setupId ?? null,
    ])).digest("hex");
    const pending = this.pending.get(key);
    if (pending !== undefined) {
      if (pending.fingerprint !== fingerprint) return Promise.reject(new BacklogError("conflict", "requestId was reused with different session choices"));
      return pending.promise;
    }
    const promise = this.launchOnce(projectId, provider, itemId, input, fingerprint, scope);
    this.pending.set(key, { projectId, provider, itemId, fingerprint, promise });
    void promise.finally(() => { if (this.pending.get(key)?.promise === promise) this.pending.delete(key); }).catch(() => undefined);
    return promise;
  }
  async release(projectId: string, itemId: string, input: BacklogReleaseRequest, provider: BacklogProviderId = DEFAULT_PROVIDER): Promise<BacklogReleaseResponse> {
    const project = await this.requireProject(projectId);
    if ([...this.pending.values()].some((pending) => pending.provider === provider && pending.itemId === itemId)) {
      throw new BacklogError("conflict", "Wait for the launch to finish");
    }
    // Recovery still works after an agent closes or removes the item file, or claim binding failed.
    await this.deps.claims.release({ repo: await canonicalBacklogRoot(project.path), provider, itemId }, input.claimId, true);
    return { released: true };
  }
  private async scanOptions(scope: BacklogScope) {
    const githubLogin = (await this.deps.settings?.read())?.githubLogin;
    return { scope, ...(this.deps.settings === undefined ? {} : { settings: this.deps.settings }), ...(githubLogin === undefined ? {} : { githubLogin }) };
  }
  private async requireProject(projectId: string) {
    try { return await this.deps.projects.requireProject(projectId); }
    catch (error) {
      if (error instanceof Error && error.message === "Project not found") throw new BacklogError("not-found", error.message);
      throw error;
    }
  }
  private async launchOnce(projectId: string, provider: BacklogProviderId, itemId: string, input: BacklogLaunchRequest, fingerprint: string, scope: BacklogScope): Promise<BacklogLaunchResponse> {
    const { entry, selected } = await this.readEntry(projectId, itemId, provider, scope);
    const { item } = entry;
    const key = { repo: item.repo, provider, itemId };
    const existing = await this.deps.claims.get(key);
    if (existing !== undefined) {
      if (existing.kind === "claimed" && existing.projectId === projectId && existing.requestId === input.requestId && existing.fingerprint === fingerprint) {
        if (await this.deps.isArchived(existing.sessionId)) {
          await this.deps.claims.releaseSessions([existing.sessionId]);
          throw new BacklogError("conflict", "Launch session was archived; use a new requestId");
        }
        const content = this.deps.claims.launchContent(existing.claimId)
          ?? await selected.prepareLaunch?.(entry) ?? { initialPrompt: selected.prompt(entry) };
        return { session: { id: existing.sessionId, cwd: existing.cwd }, claim: existing, ...content, reused: true };
      }
      throw new BacklogError("conflict", existing.kind === "interrupted" ? "Launch was interrupted. Inspect the setup/session and release the exact claim before retrying." : "Backlog item is already claimed", existing);
    }
    if (item.readiness !== "ready") throw new BacklogError("conflict", "Only open, unblocked backlog items can launch");
    const cwd = await realpath(input.start.cwd);
    if (await canonicalBacklogRoot(cwd) !== item.repo) throw new BacklogError("invalid-request", "Session destination must belong to the backlog item's project");
    const content = await selected.prepareLaunch?.(entry) ?? { initialPrompt: selected.prompt(entry) };
    const reservation = await this.deps.claims.reserve({ ...key, projectId, cwd, requestId: input.requestId, fingerprint });
    let session;
    try {
      // A server-owned token cannot collide with an unrelated composer launch.
      session = await this.deps.userSessions.start({ ...input.start, cwd, startupToken: `backlog-${reservation.claimId}` });
    } catch (error) {
      await this.deps.claims.release(key, reservation.claimId, true);
      throw error;
    }
    let claim;
    try { claim = await this.deps.claims.bind(reservation.claimId, session.id, session.cwd, session.worktree?.branch, provider === "azure-devops" ? content : undefined); }
    catch (error) {
      await this.deps.sessions.stop(session);
      // Keep the durable reservation. Restart marks it interrupted; explicit recovery cannot double-launch silently.
      throw error;
    }
    if (await this.deps.isArchived(session.id)) {
      await this.deps.claims.releaseSessions([session.id]);
      throw new BacklogError("conflict", "Session was archived during launch");
    }
    // The existing composer sends the returned prompt through the normal prompt endpoint.
    return { session: { id: session.id, cwd: session.cwd }, claim, ...content, reused: false };
  }
}
