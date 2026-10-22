import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, isAbsolute } from "node:path";
import { promisify } from "node:util";
import { stringify } from "yaml";
import type { BacklogSuggestion, BacklogSuggestionState } from "../../../shared/backlogSuggestions.js";
import type { Project } from "../../../shared/apiTypes.js";
import { SESSION_WORKTREE_DIRECTORY } from "../../../shared/sessionWorktree.js";
import { closeIssueTitle } from "../../../shared/fileIssues.js";
import { sanitizedGitEnv } from "../../git/gitEnv.js";
import { mainCheckoutOverlaps, type SessionWorktrees } from "../../workspaces/sessionWorktrees.js";
import { markdownBacklogProvider } from "../markdownBacklog.js";
import { parseBacklogItem } from "../backlogItem.js";

const execute = promisify(execFile);
export function suggestionBody(record: BacklogSuggestion): string {
  return `${record.body}\n\n## Context\n\n### Why\n${record.context.why}\n\n### Files\n${record.context.files.map(file => `- ${file}`).join("\n") || "None."}\n\n### Decisions\n${record.context.decisions.map(decision => `- ${decision}`).join("\n") || "None."}\n\nSuggested in ${record.sessionTitle ?? "Untitled chat"} (${record.sessionId}), ${record.createdAt.slice(0, 10)}\n`;
}
export function suggestionItemId(title: string, date: string): string {
  return `${date.slice(0, 10)}-${title.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 80).replace(/-$/u, "") || "item"}`;
}

/** A private index builds a commit before any checkout materializes the item. Never pushes. */
export async function writeMarkdownSuggestion(worktrees: Pick<SessionWorktrees, "options" | "withMainCheckout">, project: Project, record: BacklogSuggestion): Promise<BacklogSuggestionState> {
  if (record.destination.provider !== "markdown") throw new Error("Expected Markdown destination");
  const path = record.destination.path;
  const rel = relative("/", join("/", path));
  if (isAbsolute(path) || path.split("/").includes("..") || rel !== path || /[\\\0\r\n]/u.test(path)) throw new Error("Invalid backlog item path");
  const options = await worktrees.options(project.path);
  if (options.kind !== "git") throw new Error("Markdown filing requires a Git project");
  return worktrees.withMainCheckout(options.repo, async () => {
    const git = async (cwd: string, args: string[], env = sanitizedGitEnv()) => (await execute("git", ["-C", cwd, ...args], { env: { ...env, FORGERIE_MANAGED_WORKTREE_SETUP: "1" }, timeout: 120000, maxBuffer: 16 * 1024 * 1024 })).stdout.trim();
    const checkMain = async () => {
      if (await git(options.repo, ["symbolic-ref", "--short", "HEAD"]) !== options.defaultBranch) throw new Error("Main checkout is not on the default branch");
      if ((await mainCheckoutOverlaps(options.repo, [path])).length > 0) throw new Error("Main checkout has overlapping dirty files");
    };
    await checkMain();
    const branch = `backlog-${randomUUID()}`;
    const scratch = join(options.repo, SESSION_WORKTREE_DIRECTORY, branch);
    const privateDir = await mkdtemp(join(tmpdir(), "forgerie-backlog-index-"));
    try {
      await git(options.repo, ["worktree", "add", "-b", branch, scratch, options.defaultBranch]);
      const scans = await Promise.all([options.repo, scratch].map(root => markdownBacklogProvider.scan(project, root, { dir: dirname(path) })));
      if (scans.some(scan => scan.warnings.some(warning => warning.kind === "scan-limit" || warning.kind === "invalid-item"))) throw new Error("Cannot complete duplicate check: invalid or incomplete Markdown backlog");
      const matches = [...new Map(scans.flatMap(scan => scan.entries).filter(({ item }) => item.open && closeIssueTitle(item.title, record.title)).map(({ item }) => [item.path, { path: item.path, title: item.title, state: "open" }])).values()];
      if (matches.length > 0) return { kind: "duplicate", matches };
      if (await git(scratch, ["ls-tree", "HEAD", "--", path]) !== "") throw new Error("Backlog item path already exists; choose another title");
      const id = path.slice(path.lastIndexOf("/") + 1, -3);
      const content = `---\n${stringify({ id, title: record.title, status: "To Do", created: record.createdAt.slice(0, 10), source: `forgerie-suggestion ${record.sessionId}` })}---\n\n${suggestionBody(record)}`;
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
      await git(scratch, ["rebase", options.defaultBranch]);
      await checkMain();
      await git(options.repo, ["merge", "--ff-only", branch]);
      return { kind: "filed", provider: "markdown", path, at: new Date().toISOString() };
    } finally {
      try {
        if ((await git(options.repo, ["worktree", "list", "--porcelain"])).split("\n").includes(`worktree ${scratch}`)) await git(options.repo, ["worktree", "remove", "--force", scratch]);
        const branches = await git(options.repo, ["branch", "--list", branch]);
        if (branches !== "") await git(options.repo, ["branch", "-D", branch]);
      } finally { await rm(privateDir, { recursive: true, force: true }); }
    }
  });
}
