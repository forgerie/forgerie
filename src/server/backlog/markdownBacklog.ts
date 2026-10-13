import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { open, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { promisify } from "node:util";
import type { BacklogConfig, BacklogWarning, Project } from "../../shared/apiTypes.js";
import { sanitizedGitEnv } from "../git/gitEnv.js";
import { isGitRepository } from "../workspaces/gitWorktreeDiscovery.js";
import { backlogErrorMessage, isMissingFile } from "./backlogError.js";
import { isOpenBacklogStatus, parseBacklogItem } from "./backlogItem.js";
import type { BacklogProvider, BacklogProviderScan, ScannedBacklogItem } from "./backlogProvider.js";

const execute = promisify(execFile);
const MAX_ITEM_BYTES = 256 * 1024;
const MAX_ENTRIES = 10_000;
export const DEFAULT_BACKLOG_DIRECTORY = ".forgerie/backlog/";

/** Repo-local markdown items with frontmatter, read from one configured directory. Never writes. */
export const markdownBacklogProvider: BacklogProvider = {
  id: "markdown",
  scan: scanMarkdownBacklog,
  prompt: ({ item, body }) => `This is backlog item ${item.id}.\n\n${body}`,
};

async function scanMarkdownBacklog(project: Project, repo: string, config: BacklogConfig | undefined): Promise<BacklogProviderScan> {
  const warnings: BacklogWarning[] = [];
  const entries: ScannedBacklogItem[] = [];
  const warn = (kind: BacklogWarning["kind"], path: string, message: string) => { warnings.push({ projectId: project.id, provider: "markdown", kind, path, message }); };
  const directory = join(repo, config?.dir ?? DEFAULT_BACKLOG_DIRECTORY);
  await assertContainedFile(repo, directory);
  if (await isGitRepository(repo) && await ignoredByGit(repo, directory)) {
    warn("ignored-directory", directory, "Backlog directory is git-ignored; items are still served. For a .forgerie/ ignore, replace it with .forgerie/* and !.forgerie/backlog/. For an override, remove or narrow the matching ignore rule.");
  }
  let visited = 0;
  const walk = async (folder: string, depth: number): Promise<void> => {
    if (depth > 16 || visited >= MAX_ENTRIES) { warn("scan-limit", folder, "Backlog scan limit reached"); return; }
    let children;
    try { children = await readdir(folder, { withFileTypes: true }); }
    catch (error) { if (isMissingFile(error) && folder === directory) return; throw error; }
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
      if (++visited > MAX_ENTRIES) { warn("scan-limit", folder, "Backlog scan limit reached"); break; }
      const path = join(folder, child.name);
      if (child.isSymbolicLink()) { warn("invalid-item", path, "Backlog scanner does not follow symbolic links"); continue; }
      if (child.isDirectory()) { await walk(path, depth + 1); continue; }
      if (!child.isFile() || !child.name.endsWith(".md")) continue;
      try {
        await assertContainedFile(directory, path);
        const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        let content: string;
        try {
          if ((await handle.stat()).size > MAX_ITEM_BYTES) throw new Error("Item exceeds 256 KiB");
          content = await handle.readFile("utf8");
          if (Buffer.byteLength(content) > MAX_ITEM_BYTES) throw new Error("Item exceeds 256 KiB");
        } finally { await handle.close(); }
        const { metadata, body } = parseBacklogItem(content);
        const status = metadata.status ?? "To Do";
        entries.push({ body, item: { ...metadata, provider: "markdown", projectId: project.id, projectName: project.name, repo,
          path: relative(repo, path), status, labels: metadata.labels ?? [], blocked_by: metadata.blocked_by ?? [],
          assignedToMe: true, assignees: [], open: isOpenBacklogStatus(status), readiness: "ready", blockingIds: [] } });
      } catch (error) { warn("invalid-item", path, backlogErrorMessage(error)); }
    }
  };
  await walk(directory, 0);
  const counts = new Map<string, number>();
  for (const { item } of entries) counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
  const unique = entries.filter(({ item }) => {
    if (counts.get(item.id) === 1) return true;
    warn("invalid-item", item.path, `Duplicate item id ${item.id}; all copies excluded`);
    return false;
  });
  const openIds = new Set(unique.filter(({ item }) => item.open).map(({ item }) => item.id));
  for (const { item } of unique) {
    item.blockingIds = [...new Set(item.blocked_by.filter((id) => openIds.has(id)))];
    item.readiness = !item.open ? "closed" : item.blockingIds.length > 0 ? "blocked" : "ready";
  }
  return { entries: unique, warnings };
}

export async function assertContainedFile(root: string, path: string): Promise<void> {
  try {
    const resolved = await realpath(path);
    const rel = relative(root, resolved);
    if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) throw new Error(`Backlog path escapes its root: ${path}`);
  } catch (error) { if (!isMissingFile(error)) throw error; }
}
async function ignoredByGit(repo: string, path: string): Promise<boolean> {
  try {
    await execute("git", ["-C", repo, "check-ignore", "--quiet", "--", `${relative(repo, path)}/`], { env: sanitizedGitEnv() });
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === 1) return false;
    throw error;
  }
}
