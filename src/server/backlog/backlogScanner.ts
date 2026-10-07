import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import type { BacklogClaim, BacklogWarning, Project } from "../../shared/apiTypes.js";
import { sanitizedGitEnv } from "../git/gitEnv.js";
import { isGitRepository, parseGitWorktreeList } from "../workspaces/gitWorktreeDiscovery.js";
import { backlogErrorMessage } from "./backlogError.js";
import type { BacklogProvider, BacklogProviderScan, ScannedBacklogItem } from "./backlogProvider.js";
import { markdownBacklogProvider } from "./markdownBacklog.js";

const execute = promisify(execFile);
export const defaultBacklogProviders: readonly BacklogProvider[] = [markdownBacklogProvider];

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

/** Every provider's items for one project, with Forgerie's claims overlaid. One failing provider does not hide another's items. */
export async function scanProjectBacklog(project: Project, claims: readonly BacklogClaim[], providers: readonly BacklogProvider[] = defaultBacklogProviders): Promise<BacklogProviderScan> {
  const warnings: BacklogWarning[] = [];
  const entries: ScannedBacklogItem[] = [];
  const failed = (error: unknown) => { warnings.push({ projectId: project.id, kind: "project-error", path: project.path, message: backlogErrorMessage(error) }); };
  let repo: string;
  try { repo = await canonicalBacklogRoot(project.path); }
  catch (error) { failed(error); return { entries, warnings }; }
  for (const provider of providers) {
    try {
      const scan = await provider.scan(project, repo);
      entries.push(...scan.entries); warnings.push(...scan.warnings);
    } catch (error) { failed(error); }
  }
  for (const { item } of entries) {
    const claim = claims.find((candidate) => candidate.repo === repo && candidate.provider === item.provider && candidate.itemId === item.id);
    if (claim === undefined) continue;
    item.claim = claim;
    item.readiness = "claimed";
  }
  return { entries, warnings };
}
