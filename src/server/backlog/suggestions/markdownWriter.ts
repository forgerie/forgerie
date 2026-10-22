import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, isAbsolute } from "node:path";
import { stringify } from "yaml";
import type { BacklogSuggestion, BacklogSuggestionState } from "../../../shared/backlogSuggestions.js";
import type { Project } from "../../../shared/apiTypes.js";
import { closeIssueTitle } from "../../../shared/fileIssues.js";
import { sanitizedGitEnv } from "../../git/gitEnv.js";
import { backlogGit as git, backlogScratchIdentity, backlogScratchIndexDirectory, removeBacklogScratch } from "./markdownScratch.js";
import { mainCheckoutOverlaps, type SessionWorktrees } from "../../workspaces/sessionWorktrees.js";
import { markdownBacklogProvider } from "../markdownBacklog.js";
import { parseBacklogItem } from "../backlogItem.js";

export function suggestionBody(record: BacklogSuggestion): string {
  return `${record.body}\n\n## Context\n\n### Why\n${record.context.why}\n\n### Files\n${record.context.files.map(file => `- ${file}`).join("\n") || "None."}\n\n### Decisions\n${record.context.decisions.map(decision => `- ${decision}`).join("\n") || "None."}\n\nSuggested in ${record.sessionTitle ?? "Untitled chat"} (${record.sessionId}), ${record.createdAt.slice(0, 10)}\n`;
}
export function suggestionItemId(title: string, date: string): string {
  return `${date.slice(0, 10)}-${title.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 80).replace(/-$/u, "") || "item"}`;
}

/** A private index builds a commit before any checkout materializes the item. Never pushes. */
export async function writeMarkdownSuggestion(worktrees: Pick<SessionWorktrees, "options" | "withMainCheckout">, project: Project, record: BacklogSuggestion, onPath?: (path: string) => Promise<void>): Promise<BacklogSuggestionState> {
  if (record.destination.provider !== "markdown") throw new Error("Expected Markdown destination");
  const originalPath = record.destination.path;
  let path = originalPath;
  const rel = relative("/", join("/", path));
  if (isAbsolute(path) || path.split("/").includes("..") || rel !== path || /[\\\0\r\n]/u.test(path)) throw new Error("Invalid backlog item path");
  const options = await worktrees.options(project.path);
  if (options.kind !== "git") throw new Error("Markdown filing requires a Git project");
  return worktrees.withMainCheckout(options.repo, async () => {
    const checkMain = async () => {
      if (await git(options.repo, ["symbolic-ref", "--short", "HEAD"]) !== options.defaultBranch) throw new Error("Main checkout is not on the default branch");
      if ((await mainCheckoutOverlaps(options.repo, [path])).length > 0) throw new Error("Main checkout has overlapping dirty files");
    };
    await checkMain();
    const { branch, path: scratch } = backlogScratchIdentity(options.repo, record.id);
    const privateDir = await backlogScratchIndexDirectory(options.repo, record.id);
    await mkdir(privateDir, { recursive: true, mode: 0o700 });
    let tip: string;
    try {
      await git(options.repo, ["worktree", "add", "-b", branch, scratch, options.defaultBranch]);
      const scans = await Promise.all([options.repo, scratch].map(root => markdownBacklogProvider.scan(project, root, { dir: dirname(path) })));
      if (scans.some(scan => scan.warnings.some(warning => warning.kind === "scan-limit" || warning.kind === "invalid-item"))) throw new Error("Cannot complete duplicate check: invalid or incomplete Markdown backlog");
      const matches = [...new Map(scans.flatMap(scan => scan.entries).filter(({ item }) => item.open && closeIssueTitle(item.title, record.title)).map(({ item }) => [item.path, { path: item.path, title: item.title, state: "open" }])).values()];
      if (matches.length > 0) return { kind: "duplicate", matches };
      const base = path.slice(0, -3);
      for (let suffix = 2; await git(scratch, ["ls-tree", "HEAD", "--", path]) !== ""; suffix++) path = `${base}-${String(suffix)}.md`;
      if (path !== originalPath) {
        if (onPath === undefined) throw new Error("A destination persistence callback is required for a path collision");
        await onPath(path);
      }
      await checkMain();
      const content = markdownSuggestionContent(record, path);
      if (Buffer.byteLength(content) > 256 * 1024) throw new Error("Backlog item exceeds 256 KiB");
      parseBacklogItem(content);
      const source = join(privateDir, "item"); await writeFile(source, content, { mode: 0o600 });
      const env = { ...sanitizedGitEnv(), GIT_INDEX_FILE: join(privateDir, "index") };
      const parent = await git(scratch, ["rev-parse", "HEAD"]);
      const blob = await git(scratch, ["hash-object", "-w", source]);
      await git(scratch, ["read-tree", "HEAD"], env);
      await git(scratch, ["update-index", "--add", "--cacheinfo", "100644", blob, path], env);
      const tree = await git(scratch, ["write-tree"], env);
      const commit = await git(scratch, ["commit-tree", tree, "-p", parent, "-m", `chore(backlog): add ${record.title}`]);
      // Move HEAD first: when reset materializes the item it is already committed.
      await git(scratch, ["update-ref", `refs/heads/${branch}`, commit, parent]);
      await git(scratch, ["reset", "--hard", commit]);
      // An external Git writer may advance main despite our in-process queue. Refuse a non-fast-forward; never create a conflict file.
      tip = commit;
    } finally {
      try {
        await removeBacklogScratch(options.repo, record.id);
      } finally { await rm(privateDir, { recursive: true, force: true }); }
    }
    // Cleanup must succeed before changing main; a cleanup error can never look like a failed filing that actually landed.
    await checkMain();
    await git(options.repo, ["merge", "--ff-only", tip]);
    return { kind: "filed", provider: "markdown", path, at: new Date().toISOString() };
  });
}

export function suggestionSource(record: Pick<BacklogSuggestion, "sessionId" | "id">): string { return `forgerie-suggestion ${record.sessionId}/${record.id}`; }
export function markdownSuggestionContent(record: BacklogSuggestion, path: string): string {
  const id = path.slice(path.lastIndexOf("/") + 1, -3);
  return `---\n${stringify({ id, title: record.title, status: "To Do", created: record.createdAt.slice(0, 10), source: suggestionSource(record) })}---\n\n${suggestionBody(record)}`;
}
