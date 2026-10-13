import { claimKeyOf } from "../../shared/backlogClaimKey.js";
import { resolveDestination } from "../../shared/backlogDestination.js";
import { sourceWarnings } from "../../shared/backlogSources.js";
import { GITHUB_LOGIN_WARNING } from "./githubBacklog.js";
import type { BacklogSourceSummary, BacklogScope } from "../../shared/backlog.js";
import type { BacklogSettingsStore } from "./backlogSettingsStore.js";
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import type { BacklogDetailResponse, BacklogLaunchRequest, BacklogLaunchResponse, BacklogListResponse, BacklogProviderId, BacklogReleaseRequest, BacklogReleaseResponse } from "../../shared/apiTypes.js";
import type { ProjectService } from "../projects/projectService.js";
import type { UserSessionWorktrees } from "../workspaces/sessionWorktreeRoutes.js";
import type { SessionRouteService } from "../sessions/sessionService.js";
import type { BacklogClaimStore } from "./backlogClaimStore.js";
import { BacklogError } from "./backlogError.js";
import type { BacklogProvider, BacklogSourceProvider, ScannedBacklogItem, BacklogProviderScan } from "./backlogProvider.js";
import { canonicalBacklogRoot, defaultBacklogProviders, scanProjectBacklog, scanSourceBacklog } from "./backlogScanner.js";

interface BacklogDependencies {
  projects: Pick<ProjectService, "list" | "requireProject">;
  claims: BacklogClaimStore;
  userSessions: Pick<UserSessionWorktrees, "start">;
  sessions: Pick<SessionRouteService, "stop">;
  isArchived: (sessionId: string) => Promise<boolean>;
  providers?: readonly BacklogProvider[];
  settings?: BacklogSettingsStore;
  sourceProvider?: BacklogSourceProvider;
}

type Address = { kind: "project"; id: string } | { kind: "source"; id: string };

/** Requests that name no provider address markdown items, as every request did before providers existed. */
const DEFAULT_PROVIDER: BacklogProviderId = "markdown";

export class BacklogService {
  private readonly pending = new Map<string, { address: Address; provider: BacklogProviderId; itemId: string; fingerprint: string; promise: Promise<BacklogLaunchResponse> }>();
  private readonly providers: readonly BacklogProvider[];
  constructor(private readonly deps: BacklogDependencies) { this.providers = deps.providers ?? defaultBacklogProviders; }

  async list(scope: BacklogScope = "mine"): Promise<BacklogListResponse> {
    const claims = await this.deps.claims.list();
    const options = await this.scanOptions(scope);
    const projects = await this.deps.projects.list();
    const sources = Object.values(options.file?.sources ?? {});
    const sourceScans = await Promise.all(sources.map((source) => scanSourceBacklog(source, projects, claims, this.deps.sourceProvider, scope)));
    const scans = await Promise.all(projects.map((project) => scanProjectBacklog(project, claims, this.providers, options)));
    const summaries: BacklogSourceSummary[] = sources.map((source, index) => {
      const warnings = [...sourceScans[index]?.warnings ?? [], ...sourceWarnings(source, sources).map((message) => ({ sourceId: source.id, provider: "azure-devops", path: `${source.organization}/${source.project}`, kind: "source-overlap" as const, message }))];
      return { sourceId: source.id, label: source.project, provider: "azure-devops" as const, organization: source.organization, ...(source.areaPath === undefined ? {} : { areaPath: source.areaPath }), destination: resolveDestination({ kind: "source", sourceId: source.id, label: source.project, ...(source.destinationProjectId === undefined ? {} : { destinationProjectId: source.destinationProjectId }) }, undefined, projects), warnings };
    });
    const warnings = [...summaries.flatMap((source) => source.warnings), ...scans.flatMap((scan) => scan.warnings)];
    // Source insertion order is creation order. Retain the earliest source for overlapping migrated boards.
    const seen = new Set<string>();
    const items = [...sourceScans, ...scans].flatMap((scan) => scan.entries.map((entry) => entry.item)).filter((item) => {
      const key = claimKeyOf(item); if (seen.has(key)) return false; seen.add(key); return true;
    });
    const loginWarning = warnings.find((warning) => warning.provider === "github" && warning.message === GITHUB_LOGIN_WARNING);
    return { sources: summaries, projects: projects.map((project, index) => ({ projectId: project.id, providers: scans[index]?.sources ?? [] })), items, warnings: warnings.filter((warning) => warning.provider !== "github" || warning.message !== GITHUB_LOGIN_WARNING || warning === loginWarning), generatedAt: new Date().toISOString() };
  }
  async detail(projectId: string, itemId: string, provider: BacklogProviderId = DEFAULT_PROVIDER, scope: BacklogScope = "mine"): Promise<BacklogDetailResponse> {
    const { entry, selected } = await this.readEntry({ kind: "project", id: projectId }, itemId, provider, scope);
    return { item: entry.item, body: entry.body, initialPrompt: selected.prompt(entry), ...(entry.imageSummary === undefined ? {} : { imageSummary: entry.imageSummary }) };
  }
  async detailSource(sourceId: string, itemId: string, scope: BacklogScope = "mine"): Promise<BacklogDetailResponse> {
    const { entry, selected } = await this.readEntry({ kind: "source", id: sourceId }, itemId, "azure-devops", scope);
    return { item: entry.item, body: entry.body, initialPrompt: selected.prompt(entry), ...(entry.imageSummary === undefined ? {} : { imageSummary: entry.imageSummary }) };
  }
  private rejectProjectAzure(provider: BacklogProviderId): void {
    if (provider === "azure-devops") throw new BacklogError("not-found", "Azure items are listed under their source");
  }
  private async readEntry(address: Address, itemId: string, provider: BacklogProviderId, scope: BacklogScope): Promise<{ entry: ScannedBacklogItem; selected: Pick<BacklogProvider, "prompt" | "prepareLaunch"> }> {
    let scan: BacklogProviderScan;
    let selected: Pick<BacklogProvider, "prompt" | "prepareLaunch">;
    if (address.kind === "source") {
      const options = await this.scanOptions(scope);
      const source = options.file !== undefined && Object.hasOwn(options.file.sources, address.id) ? options.file.sources[address.id] : undefined;
      if (source === undefined) throw new BacklogError("not-found", "Backlog source not found");
      if (this.deps.sourceProvider === undefined) throw new BacklogError("not-found", "Azure DevOps is not enabled on this host");
      selected = this.deps.sourceProvider;
      scan = await scanSourceBacklog(source, await this.deps.projects.list(), await this.deps.claims.list(), this.deps.sourceProvider, scope);
    } else {
      this.rejectProjectAzure(provider);
      const candidate = this.providers.find((candidate) => candidate.id === provider);
      if (candidate === undefined) throw new BacklogError("not-found", `Backlog provider ${provider} is not enabled`);
      selected = candidate;
      const project = await this.requireProject(address.id);
      scan = await scanProjectBacklog(project, await this.deps.claims.list(), [candidate], await this.scanOptions(scope));
    }
    const failure = scan.warnings.find((warning) => warning.kind === "project-error" || warning.kind === "scan-limit"
      || warning.kind === "provider-auth" || warning.kind === "provider-install"
      || warning.kind === "provider-unavailable" && scan.entries.length === 0);
    if (failure !== undefined) throw new BacklogError("unavailable", failure.message);
    const entry = scan.entries.find(({ item }) => item.id === itemId);
    if (entry === undefined) throw new BacklogError("not-found", "Backlog item not found or invalid");
    return { entry, selected };
  }
  launch(projectId: string, itemId: string, input: BacklogLaunchRequest, provider: BacklogProviderId = DEFAULT_PROVIDER, scope: BacklogScope = "mine"): Promise<BacklogLaunchResponse> {
    this.rejectProjectAzure(provider);
    return this.launchAddress({ kind: "project", id: projectId }, itemId, input, provider, scope);
  }
  launchSource(sourceId: string, itemId: string, input: BacklogLaunchRequest, scope: BacklogScope = "mine"): Promise<BacklogLaunchResponse> {
    return this.launchAddress({ kind: "source", id: sourceId }, itemId, input, "azure-devops", scope);
  }
  private launchAddress(address: Address, itemId: string, input: BacklogLaunchRequest, provider: BacklogProviderId, scope: BacklogScope): Promise<BacklogLaunchResponse> {
    const key = JSON.stringify([address, provider, itemId, input.requestId, scope]);
    const fingerprint = createHash("sha256").update(JSON.stringify([
      input.start.cwd, input.start.modelSpec ?? null, input.start.thinkingLevel ?? null,
      input.start.destination?.kind ?? null, input.start.setupId ?? null,
    ])).digest("hex");
    const pending = this.pending.get(key);
    if (pending !== undefined) {
      if (pending.fingerprint !== fingerprint) return Promise.reject(new BacklogError("conflict", "requestId was reused with different session choices"));
      return pending.promise;
    }
    const promise = this.launchOnce(address, provider, itemId, input, fingerprint, scope);
    this.pending.set(key, { address, provider, itemId, fingerprint, promise });
    void promise.finally(() => { if (this.pending.get(key)?.promise === promise) this.pending.delete(key); }).catch(() => undefined);
    return promise;
  }
  async release(projectId: string, itemId: string, input: BacklogReleaseRequest, provider: BacklogProviderId = DEFAULT_PROVIDER): Promise<BacklogReleaseResponse> {
    this.rejectProjectAzure(provider);
    const project = await this.requireProject(projectId);
    if ([...this.pending.values()].some((pending) => pending.provider === provider && pending.itemId === itemId && pending.address.id === projectId)) {
      throw new BacklogError("conflict", "Wait for the launch to finish");
    }
    // Recovery still works after an agent closes or removes the item file, or claim binding failed.
    await this.deps.claims.release({ repo: await canonicalBacklogRoot(project.path), provider, itemId }, input.claimId);
    return { released: true };
  }
  async releaseSource(_sourceId: string, itemId: string, input: BacklogReleaseRequest): Promise<BacklogReleaseResponse> {
    if ([...this.pending.values()].some((pending) => pending.provider === "azure-devops" && pending.itemId === itemId)) throw new BacklogError("conflict", "Wait for the launch to finish");
    // Source deletion and destination removal must never strand an exact live claim.
    await this.deps.claims.release({ provider: "azure-devops", itemId }, input.claimId);
    return { released: true };
  }
  private async scanOptions(scope: BacklogScope) {
    const file = await this.deps.settings?.read();
    const githubLogin = file?.githubLogin;
    return { scope, file, ...(file === undefined ? {} : { settings: { read: () => Promise.resolve(file) } }), ...(githubLogin === undefined ? {} : { githubLogin }) };
  }
  private async requireProject(projectId: string) {
    try { return await this.deps.projects.requireProject(projectId); }
    catch (error) {
      if (error instanceof Error && error.message === "Project not found") throw new BacklogError("not-found", error.message);
      throw error;
    }
  }
  private async launchOnce(address: Address, provider: BacklogProviderId, itemId: string, input: BacklogLaunchRequest, fingerprint: string, scope: BacklogScope): Promise<BacklogLaunchResponse> {
    const { entry, selected } = await this.readEntry(address, itemId, provider, scope);
    const { item } = entry;
    if (item.contested !== undefined) throw new BacklogError("conflict", item.contested.message, item.claim);
    const key = { ...(item.repo === undefined ? {} : { repo: item.repo }), provider, itemId };
    const existing = await this.deps.claims.get(key);
    if (existing !== undefined) {
      if (existing.kind === "claimed" && (address.kind === "source" || existing.projectId === address.id) && existing.requestId === input.requestId && existing.fingerprint === fingerprint) {
        if (await this.deps.isArchived(existing.sessionId)) {
          await this.deps.claims.releaseSessions([existing.sessionId]);
          throw new BacklogError("conflict", "Launch session was archived; use a new requestId");
        }
        const content = await this.deps.claims.launchContent(existing.claimId)
          ?? await selected.prepareLaunch?.(entry) ?? { initialPrompt: selected.prompt(entry) };
        return { session: { id: existing.sessionId, cwd: existing.cwd }, claim: existing, ...content, reused: true };
      }
      throw new BacklogError("conflict", existing.kind === "interrupted" ? "Launch was interrupted. Inspect the setup/session and release the exact claim before retrying." : "Backlog item is already claimed", existing);
    }
    if (item.readiness !== "ready") throw new BacklogError("conflict", "Only open, unblocked backlog items can launch");
    let cwd: string; let repo: string;
    try { cwd = await realpath(input.start.cwd); repo = await canonicalBacklogRoot(cwd); }
    catch { throw new BacklogError("invalid-request", "Session destination must belong to a registered project"); }
    let projectId: string;
    if (item.owner.kind === "project") {
      if (repo !== item.owner.repo) throw new BacklogError("invalid-request", "Session destination must belong to the backlog item's project");
      projectId = item.owner.projectId;
    } else {
      const projects = await this.deps.projects.list();
      let destinationProjectId: string | undefined;
      // Missing registered folders cannot authorize an unrelated path.
      for (const project of projects) {
        let root: string;
        try { root = await canonicalBacklogRoot(project.path); } catch { continue; }
        if (root === repo) { destinationProjectId = project.id; break; }
      }
      if (destinationProjectId === undefined) throw new BacklogError("invalid-request", "Session destination must belong to a registered project");
      projectId = destinationProjectId;
    }
    const content = await selected.prepareLaunch?.(entry) ?? { initialPrompt: selected.prompt(entry) };
    const reservation = await this.deps.claims.reserve({ ...key, repo, projectId, ...(address.kind === "source" ? { sourceId: address.id } : {}), cwd, requestId: input.requestId, fingerprint });
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
