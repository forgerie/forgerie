import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { BacklogClaim, BacklogConfig, BacklogProviderId, BacklogWarning, Project } from "../../shared/apiTypes.js";
import { sanitizedGitEnv } from "../git/gitEnv.js";
import { isGitRepository, parseGitWorktreeList } from "../workspaces/gitWorktreeDiscovery.js";
import { loadProjectPiWebConfig } from "../workspaces/projectPiWebConfig.js";
import { backlogErrorMessage } from "./backlogError.js";
import type { BacklogProvider, BacklogProviderScan, ScannedBacklogItem } from "./backlogProvider.js";
import { assertContainedFile, markdownBacklogProvider } from "./markdownBacklog.js";

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
export async function scanProjectBacklog(project: Project, claims: readonly BacklogClaim[], providers: readonly BacklogProvider[] = defaultBacklogProviders): Promise<BacklogProviderScan> {
  const warnings: BacklogWarning[] = [];
  const entries: ScannedBacklogItem[] = [];
  const failed = (error: unknown, provider?: BacklogProviderId) => { warnings.push({ projectId: project.id, ...(provider === undefined ? {} : { provider }), kind: "project-error", path: project.path, message: backlogErrorMessage(error) }); };
  let repo: string;
  let config: BacklogConfig | undefined;
  try {
    repo = await canonicalBacklogRoot(project.path);
    // The config decides which paths and services the scan touches, so it must not be a link out of the repo.
    await assertContainedFile(repo, join(repo, ".forgerie/config.json"));
    const loaded = await loadProjectPiWebConfig(repo);
    // A bad backlog section lists nothing rather than guessing a default folder or provider set.
    if (loaded.backlogError !== undefined) throw new Error(loaded.backlogError);
    config = loaded.config.backlog;
  } catch (error) { failed(error); return { entries, warnings }; }
  const enabled = new Set(config?.providers ?? DEFAULT_PROJECT_PROVIDERS);
  for (const provider of providers) {
    if (!enabled.has(provider.id)) continue;
    try {
      const scan = await provider.scan(project, repo, config);
      entries.push(...scan.entries); warnings.push(...scan.warnings);
    } catch (error) { failed(error, provider.id); }
  }
  for (const { item } of entries) {
    const claim = claims.find((candidate) => candidate.repo === repo && candidate.provider === item.provider && candidate.itemId === item.id);
    if (claim === undefined) continue;
    item.claim = claim;
    item.readiness = "claimed";
  }
  return { entries, warnings };
}
