import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import type { BacklogClaim, BacklogConfig, BacklogProviderId, BacklogWarning, Project } from "../../shared/apiTypes.js";
import { sanitizedGitEnv } from "../git/gitEnv.js";
import { isGitRepository, parseGitWorktreeList } from "../workspaces/gitWorktreeDiscovery.js";
import { claimKeyOf } from "../../shared/backlogClaimKey.js";
import { resolveDestination } from "../../shared/backlogDestination.js";
import type { BacklogSource } from "../../shared/backlogSources.js";
import { resolveBacklogConfig } from "./backlogConfig.js";
import type { BacklogSettingsStore } from "./backlogSettingsStore.js";
import type { BacklogScope } from "../../shared/backlog.js";
import { backlogErrorMessage } from "./backlogError.js";
import type { BacklogProvider, BacklogProviderScan, BacklogSourceProvider, ScannedBacklogItem } from "./backlogProvider.js";
import { markdownBacklogProvider } from "./markdownBacklog.js";

const execute = promisify(execFile);
export const defaultBacklogProviders: readonly BacklogProvider[] = [markdownBacklogProvider];
/** A project that names no providers lists markdown items, as every project did before providers existed. */
const DEFAULT_PROJECT_PROVIDERS: readonly BacklogProviderId[] = ["markdown"];

/** Git's common directory identifies the default checkout, even from a linked worktree. */
export async function canonicalBacklogRoot(path: string): Promise<string> {
  const canonical = await realpath(path);
  if (!await isGitRepository(canonical)) return canonical;
  const { stdout: common } = await execute("git", ["-C", canonical, "rev-parse", "--path-format=absolute", "--git-common-dir"], { env: sanitizedGitEnv() });
  const { stdout } = await execute("git", ["--git-dir", common.trim(), "worktree", "list", "--porcelain"], { env: sanitizedGitEnv() });
  const main = parseGitWorktreeList(stdout)[0];
  if (main === undefined || main.bare === true) throw new Error("Backlog requires a non-bare canonical checkout");
  return realpath(main.path);
}

/**
 * Items for one project from each provider the project turns on, with Forgerie's claims overlaid.
 * `providers` is what this host can offer; the project's `backlog.providers` picks among them.
 * One failing provider does not hide another's items.
 */
export async function scanProjectBacklog(project: Project, claims: readonly BacklogClaim[], providers: readonly BacklogProvider[] = defaultBacklogProviders, options: { settings?: Pick<BacklogSettingsStore, "read">; scope?: BacklogScope; githubLogin?: string } = {}): Promise<BacklogProviderScan> {
  const warnings: BacklogWarning[] = [];
  const entries: ScannedBacklogItem[] = [];
  const failed = (error: unknown, provider?: BacklogProviderId) => { warnings.push({ projectId: project.id, ...(provider === undefined ? {} : { provider }), kind: "project-error", path: project.path, message: backlogErrorMessage(error) }); };
  let repo: string;
  let config: BacklogConfig | undefined;
  try {
    repo = await canonicalBacklogRoot(project.path);
    const resolved = await resolveBacklogConfig(project, repo, options.settings);
    config = resolved.backlog;
    for (const message of resolved.warnings ?? []) warnings.push({ projectId: project.id, path: ".forgerie/config.json", kind: "retired-repo-azure", message });
  } catch (error) { failed(error); return { entries, warnings }; }
  const enabled = new Set(config.providers ?? DEFAULT_PROJECT_PROVIDERS);
  for (const provider of providers) {
    if (provider.id === "azure-devops" || !enabled.has(provider.id)) continue;
    try {
      const scan = await provider.scan(project, repo, config, { scope: options.scope ?? "mine", ...(options.githubLogin === undefined ? {} : { githubLogin: options.githubLogin }) });
      entries.push(...scan.entries); warnings.push(...scan.warnings);
    } catch (error) { failed(error, provider.id); }
  }
  for (const { item } of entries) item.destination = resolveDestination(item.owner, item, [project]);
  overlayClaims(entries, claims, warnings);
  return { entries, warnings, sources: [...enabled].filter((provider) => provider !== "azure-devops") };
}

export function overlayClaims(entries: readonly ScannedBacklogItem[], claims: readonly BacklogClaim[], warnings: BacklogWarning[]): void {
  for (const { item } of entries) {
    const matches = claims.filter((candidate) => claimKeyOf(candidate) === claimKeyOf(item));
    const claim = matches[0];
    if (claim === undefined) continue;
    item.claim = claim; item.readiness = "claimed";
    if (matches.length > 1) {
      const message = `Azure work item has contested claims held by: ${matches.map((held) => held.kind === "claimed" ? held.sessionId : `${held.kind} claim ${held.claimId}`).join(", ")}. Release or archive holding sessions until one claim remains before launching.`;
      item.contested = { claims: [...matches], message };
      warnings.push({ ...(item.owner.kind === "source" ? { sourceId: item.owner.sourceId } : { projectId: item.owner.projectId }), provider: item.provider, path: item.path, kind: "contested-claim", message });
    }
  }
}

export async function scanSourceBacklog(source: BacklogSource, projects: readonly Project[], claims: readonly BacklogClaim[], provider: BacklogSourceProvider | undefined, scope: BacklogScope): Promise<BacklogProviderScan> {
  const warning = (message: string): BacklogWarning => ({ sourceId: source.id, provider: "azure-devops", path: `${source.organization}/${source.project}`, kind: "provider-unavailable", message });
  if (provider === undefined) return { entries: [], warnings: [warning("Azure DevOps is not enabled on this host.")] };
  try {
    const scan = await provider.scan(source, { scope });
    for (const { item } of scan.entries) item.destination = resolveDestination({ kind: "source", sourceId: source.id, label: source.project, ...(source.destinationProjectId === undefined ? {} : { destinationProjectId: source.destinationProjectId }) }, item, projects);
    overlayClaims(scan.entries, claims, scan.warnings); return scan;
  } catch (error) { return { entries: [], warnings: [warning(backlogErrorMessage(error))] }; }
}
