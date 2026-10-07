import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { SessionWorktreeRecord, SessionWorktreeInfo, WorktreeActionResult, WorktreeArchiveCleanupResult, WorktreeDiscardPreview } from "../../shared/sessionWorktree.js";
import { sanitizedGitEnv } from "../git/gitEnv.js";
import { discoverGitWorktrees, isGitRepository } from "./gitWorktreeDiscovery.js";
import { SessionWorktreeStore, pathInside, worktreeInfo, type SessionWorktreeChanges, worktreeSessionMetadata } from "./sessionWorktreeStore.js";
import { runWorktreeHook, WORKTREE_POST_CREATE_HOOK_PATH, WORKTREE_PRE_REMOVE_HOOK_PATH } from "./worktreeHooks.js";

const execute = promisify(execFile);
export interface WorktreeSessionFile { id: string; cwd: string; path: string; transcriptSourcePath?: string }
type SessionFile = WorktreeSessionFile;
interface WorktreeEvents {
  publish(record: SessionWorktreeRecord): void;
  /** Close idle runtimes and terminals only after the durable input gate is set. */
  beforeRemoval?(record: SessionWorktreeRecord): Promise<readonly SessionFile[]>;
}

/** All git lifecycle mutations are serialized per main checkout. Git's own locks protect external writers. */
export class SessionWorktrees {
  private readonly queues = new Map<string, Promise<void>>();
  constructor(readonly store: SessionWorktreeStore, private readonly events: WorktreeEvents = { publish: () => undefined }) {}

  /** Reconcile a branch rename interrupted between git and the ownership write. */
  async initialize(): Promise<void> {
    for (const record of await this.store.list()) {
      const intent = record.pendingRename;
      if (intent === undefined) continue;
      const checkout = (await discoverGitWorktrees(record.repo)).find((item) => item.path === record.path);
      if (checkout?.branch === intent.to) await this.change(record.id, { branch: intent.to, renamed: true, pendingRename: undefined });
      else if (checkout?.branch === intent.from) await this.change(record.id, { pendingRename: undefined });
      else throw new Error(`Cannot reconcile worktree branch rename for ${record.id}`);
    }
  }

  async options(cwd: string): Promise<{ kind: "non-git" } | { kind: "git"; repo: string; defaultBranch: string; defaultDestination: "fresh-worktree" }> {
    if (!await isGitRepository(cwd)) return { kind: "non-git" };
    const worktrees = await discoverGitWorktrees(cwd);
    const main = worktrees[0];
    if (main === undefined || main.bare === true) throw new Error("A non-bare main checkout is required");
    const repo = await realpath(main.path);
    const remote = await optionalGit(repo, "symbolic-ref", "--short", "refs/remotes/origin/HEAD");
    const configured = await optionalGit(repo, "config", "--get", "init.defaultBranch");
    const candidates = [remote?.replace(/^origin\//, ""), configured, "main", "master", main.branch];
    for (const branch of candidates) {
      if (branch !== undefined && await optionalGit(repo, "show-ref", "--verify", `refs/heads/${branch}`) !== undefined) {
        return { kind: "git", repo, defaultBranch: branch, defaultDestination: "fresh-worktree" };
      }
    }
    throw new Error("Cannot resolve a local default branch with a commit");
  }

  async create(cwd: string, startupToken?: string, retryId?: string): Promise<SessionWorktreeRecord> {
    const options = await this.options(cwd);
    if (options.kind !== "git") throw new Error("Fresh worktrees require a Git project");
    return this.exclusive(options.repo, async () => {
      let record: SessionWorktreeRecord;
      if (retryId !== undefined) {
        record = await this.store.require(retryId);
        if (record.repo !== options.repo || record.sessionId !== undefined || record.state.kind !== "active") throw new Error("Only an unowned setup in this repository can be retried");
      } else {
        const id = randomUUID();
        const name = `s-${id.slice(0, 8)}`;
        const branch = await availableBranch(options.repo, name);
        const timestamp = new Date().toISOString();
        record = { id, repo: options.repo, path: join(options.repo, ".worktree", name), branch, defaultBranch: options.defaultBranch,
          renamed: false, setup: { phase: "creating", log: "" }, state: { kind: "active" }, cleanup: { kind: "pending" }, transcripts: [], createdAt: timestamp, updatedAt: timestamp,
          ...(startupToken === undefined ? {} : { startupToken }) };
        await this.store.add(record);
      }
      try {
        record = await this.change(record.id, { setup: { phase: "creating", log: "" } });
        await excludeWorktreeDirectory(record.repo);
        const existing = (await discoverGitWorktrees(record.repo)).find((item) => item.path === record.path && item.prunable !== true);
        if (existing === undefined) {
          await mkdir(dirname(record.path), { recursive: true });
          await git(record.repo, "worktree", "add", "-b", record.branch, record.path, record.defaultBranch);
        } else if (existing.branch !== record.branch) throw new Error("Setup checkout no longer has its owned branch");
        record = await this.change(record.id, { setup: { phase: "hook", log: "" } });
        let writes = Promise.resolve();
        let lastSavedAt = 0;
        const result = await runWorktreeHook({ repo: record.repo, relativePath: WORKTREE_POST_CREATE_HOOK_PATH, target: record.path, cwd: record.path, onLog: (log) => {
          this.events.publish({ ...record, updatedAt: new Date().toISOString(), setup: { phase: "hook", log } });
          if (Date.now() - lastSavedAt < 200) return;
          lastSavedAt = Date.now();
          writes = writes.then(async () => { await this.change(record.id, { setup: { phase: "hook", log } }); });
          void writes.catch(() => undefined);
        } });
        await writes;
        if (result.exitCode !== 0) {
          await this.change(record.id, { setup: { phase: "failed", ...result, error: `Post-create hook exited with ${String(result.exitCode)}` } });
          throw new Error(`Post-create hook exited with ${String(result.exitCode)}`);
        }
        return await this.change(record.id, { setup: { phase: "starting", log: result.log } });
      } catch (error) {
        const latest = await this.store.require(record.id);
        if (latest.setup.phase !== "failed") await this.change(record.id, { setup: { ...latest.setup, phase: "failed", error: message(error) } });
        throw error;
      }
    });
  }

  async attach(id: string, session: SessionFile): Promise<void> {
    const record = await this.store.require(id);
    if (record.sessionId !== undefined || session.cwd !== record.path) throw new Error("Invalid worktree session ownership");
    await this.change(id, { sessionId: session.id, ownerSession: worktreeSessionMetadata(record, session), setup: { ...record.setup, phase: "done" } });
  }
  async failedStart(id: string, error: unknown): Promise<void> {
    const record = await this.store.require(id);
    await this.change(id, { setup: { ...record.setup, phase: "failed", error: message(error) } });
  }

  async info(record: SessionWorktreeRecord, sessionId: string): Promise<SessionWorktreeInfo> {
    const info = worktreeInfo(record, sessionId);
    if (record.state.kind !== "active") return info;
    try {
      const [counts, files] = await Promise.all([git(record.path, "rev-list", "--left-right", "--count", `${record.defaultBranch}...HEAD`), dirtyFiles(record.path)]);
      const [behind, ahead] = counts.trim().split(/\s+/).map(Number);
      return { ...info, ahead: ahead ?? 0, behind: behind ?? 0, dirtyFiles: files.length };
    } catch (error) { return { ...info, statusError: message(error) }; }
  }

  async renameFromTitle(sessionId: string, title: string): Promise<void> {
    const record = (await this.store.list()).find((item) => item.sessionId === sessionId);
    if (record === undefined || record.renamed || record.state.kind !== "active") return;
    await this.exclusive(record.repo, async () => {
      const current = await this.store.require(record.id);
      if (current.renamed || current.operation !== undefined || current.state.kind !== "active") return;
      await assertOwnedCheckout(current);
      const upstream = await optionalGit(current.path, "rev-parse", "--symbolic-full-name", "@{upstream}");
      const remotes = (await git(current.path, "for-each-ref", "--format=%(refname:short)", "refs/remotes")).trim().split("\n").filter(Boolean);
      const uniqueCommits = (await git(current.path, "rev-list", `${current.defaultBranch}..HEAD`)).trim().split("\n").filter(Boolean);
      if (upstream !== undefined || remotes.some((ref) => ref.endsWith(`/${current.branch}`))) return;
      for (const sha of uniqueCommits) {
        if ((await git(current.path, "for-each-ref", `--contains=${sha}`, "--format=%(refname)", "refs/remotes")).trim() !== "") return;
      }
      const slug = title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60).replace(/-$/, "");
      if (slug === "") return;
      const branch = await availableBranch(current.repo, slug);
      await this.change(current.id, { pendingRename: { from: current.branch, to: branch } });
      try { await git(current.path, "branch", "-m", branch); }
      catch (error) { await this.change(current.id, { pendingRename: undefined }); throw error; }
      await this.change(current.id, { branch, renamed: true, pendingRename: undefined });
    });
  }

  async land(id: string, sessions: readonly SessionFile[]): Promise<WorktreeActionResult> {
    const record = await this.store.require(id);
    return this.exclusive(record.repo, async () => {
      let current = await this.store.require(id);
      if (current.state.kind === "discarded") throw new Error("Discarded worktrees cannot be landed");
      if (current.state.kind === "landed") return { kind: "landed", sha: current.state.sha, cleanup: await this.remove(current, false) };
      await assertOwnedCheckout(current);
      if ((await dirtyFiles(current.path)).length !== 0) return blocked("worktree-dirty", await dirtyFiles(current.path));
      const branch = (await git(current.repo, "symbolic-ref", "--short", "HEAD")).trim();
      if (branch !== current.defaultBranch) return blocked("main-not-on-default-branch", []);
      const overlaps = await mainDirtyOverlap(current);
      if (overlaps.length !== 0) return blocked("main-dirty", overlaps);
      current = await this.change(id, { operation: "land" });
      try {
        await this.store.saveTranscripts(id, await this.removalSessions(current, sessions));
        try { await git(current.path, "rebase", current.defaultBranch); }
        catch (error) {
          const conflicts = (await git(current.path, "diff", "--name-only", "--diff-filter=U", "-z")).split("\0").filter(Boolean);
          const rebaseDirectory = await optionalGit(current.path, "rev-parse", "--git-path", "rebase-merge");
          // `rebase --abort` is attempted even for a non-conflict failure. A failed abort must remain visible.
          const aborted = await optionalGit(current.path, "rebase", "--abort");
          if (aborted === undefined && conflicts.length !== 0) throw new Error(`Failed to abort rebase after conflicts: ${message(error)}; ${rebaseDirectory ?? ""}`, { cause: error });
          if (conflicts.length === 0) throw error;
          return { kind: "conflict", files: conflicts, defaultBranch: current.defaultBranch,
            prompt: `Land failed while rebasing onto ${current.defaultBranch}. Forgerie aborted the rebase. Resolve these conflicts in this worktree, commit the resolution, and tell me when Land can retry:\n${conflicts.join("\n")}` };
        }
        const overlapsAfterRebase = await mainDirtyOverlap(current);
        if (overlapsAfterRebase.length !== 0) return blocked("main-dirty", overlapsAfterRebase);
        if ((await git(current.repo, "symbolic-ref", "--short", "HEAD")).trim() !== current.defaultBranch) return blocked("main-not-on-default-branch", []);
        await git(current.repo, "merge", "--ff-only", current.branch);
        const sha = (await git(current.repo, "rev-parse", current.defaultBranch)).trim();
        current = await this.change(id, { state: { kind: "landed", sha, at: new Date().toISOString() } });
        return { kind: "landed", sha, cleanup: await this.remove(current, false) };
      } finally { await this.change(id, { operation: undefined }); }
    });
  }

  async discardPreview(id: string): Promise<WorktreeDiscardPreview> {
    const record = await this.store.require(id);
    if (record.state.kind === "landed" || record.cleanup.kind === "done") throw new Error("This worktree no longer needs discard confirmation");
    await assertOwnedCheckout(record);
    const commits = (await git(record.path, "log", "--format=%H%x00%s", `${record.defaultBranch}..HEAD`)).trim().split("\n").filter(Boolean).map((line) => {
      const split = line.indexOf("\0");
      return { sha: line.slice(0, split), subject: line.slice(split + 1) };
    });
    const files = await dirtyFiles(record.path);
    return { worktreeId: id, branch: record.branch, defaultBranch: record.defaultBranch, commits, dirtyFiles: files, confirmationToken: await discardFingerprint(record, files) };
  }
  async discard(id: string, token: string, sessions: readonly SessionFile[]): Promise<WorktreeActionResult> {
    const record = await this.store.require(id);
    return this.exclusive(record.repo, async () => {
      let current = await this.store.require(id);
      if (current.state.kind === "landed") throw new Error("Landed worktrees cannot be discarded");
      if (current.state.kind === "discarded") {
        if (current.cleanup.kind === "done") return { kind: "discarded", cleanup: current.cleanup };
        if (!(await discoverGitWorktrees(current.repo)).some((item) => item.path === current.path)) {
          return { kind: "discarded", cleanup: await this.remove(current, true) };
        }
      }
      const preview = await this.discardPreview(id);
      if (preview.confirmationToken !== token) return { kind: "stale-preview" };
      current = await this.change(id, { operation: "discard" });
      try {
        await this.store.saveTranscripts(id, await this.removalSessions(current, sessions));
        // Persist the read-only receipt BEFORE destructive cleanup. Failed hooks leave a retryable checkout.
        current = await this.change(id, { state: current.state.kind === "discarded" ? current.state : { kind: "discarded", at: new Date().toISOString() }, discardConfirmationToken: token, discardedBranchTip: (await git(current.path, "rev-parse", "HEAD")).trim() });
        return { kind: "discarded", cleanup: await this.remove(current, true) };
      } finally { await this.change(id, { operation: undefined }); }
    });
  }

  async archiveCleanup(id: string, sessions: readonly SessionFile[]): Promise<WorktreeArchiveCleanupResult> {
    const record = await this.store.require(id);
    const result = await this.exclusive<WorktreeArchiveCleanupResult>(record.repo, async () => {
      const current = await this.store.require(id);
      if (current.state.kind !== "active") return { kind: "retained", reason: "already-completed" };
      if (sessions.some((session) => session.id !== current.sessionId && pathInside(current.path, session.cwd))) return { kind: "retained", reason: "shared" };
      try {
        await assertOwnedCheckout(current);
        if ((await dirtyFiles(current.path)).length !== 0) return { kind: "retained", reason: "dirty" };
        if ((await git(current.path, "rev-list", "--count", `${current.defaultBranch}..HEAD`)).trim() !== "0") return { kind: "retained", reason: "unlanded-commits" };
        await this.change(id, { operation: "archive" });
        await this.store.saveTranscripts(id, await this.removalSessions(current, sessions));
        const sha = (await git(current.repo, "rev-parse", current.defaultBranch)).trim();
        const landed = await this.change(id, { state: { kind: "landed", sha, at: new Date().toISOString() } });
        return { kind: "removed", cleanup: await this.remove(landed, false) };
      } catch (error) { return { kind: "retained", reason: message(error) }; }
      finally { await this.change(id, { operation: undefined }); }
    });
    await this.change(id, { archiveCleanup: result });
    return result;
  }

  private removalSessions(record: SessionWorktreeRecord, fallback: readonly SessionFile[]): Promise<readonly SessionFile[]> {
    return this.events.beforeRemoval?.(record) ?? Promise.resolve(fallback);
  }

  private async remove(record: SessionWorktreeRecord, force: boolean): Promise<SessionWorktreeRecord["cleanup"]> {
    if (record.cleanup.kind === "done") return record.cleanup;
    try {
      const registered = (await discoverGitWorktrees(record.repo)).find((item) => item.path === record.path);
      if (registered !== undefined && registered.prunable !== true) {
        await assertOwnedCheckout(record);
        if (!force) await git(record.repo, "merge-base", "--is-ancestor", record.branch, record.defaultBranch);
        const result = await runWorktreeHook({ repo: record.repo, relativePath: WORKTREE_PRE_REMOVE_HOOK_PATH, target: record.path, cwd: record.repo });
        if (result.exitCode !== 0) throw new Error(`Pre-remove hook exited with ${String(result.exitCode)}: ${result.log}`);
        if (!force) await git(record.repo, "merge-base", "--is-ancestor", record.branch, record.defaultBranch);
        else if (record.discardedBranchTip !== (await git(record.repo, "rev-parse", record.branch)).trim()) throw new Error("Branch changed during discard cleanup. Request a new discard preview.");
        await git(record.repo, "worktree", "remove", ...(force ? ["--force"] : []), record.path);
      } else if (registered !== undefined) {
        throw new Error("Checkout disappeared outside Forgerie; inspect and prune its git registration before retrying cleanup");
      }
      if (await optionalGit(record.repo, "show-ref", "--verify", `refs/heads/${record.branch}`) !== undefined) {
        // A landed receipt permits deletion only while the default branch still contains its branch tip.
        if (!force) await git(record.repo, "merge-base", "--is-ancestor", record.branch, record.defaultBranch);
        else if (record.discardedBranchTip !== (await git(record.repo, "rev-parse", record.branch)).trim()) throw new Error("Branch changed after discard. Inspect it before deleting it.");
        await git(record.repo, "branch", "-D", record.branch);
      }
      return (await this.change(record.id, { cleanup: { kind: "done" } })).cleanup;
    } catch (error) { return (await this.change(record.id, { cleanup: { kind: "failed", error: message(error) } })).cleanup; }
  }
  private async change(id: string, changes: SessionWorktreeChanges): Promise<SessionWorktreeRecord> {
    const record = await this.store.update(id, changes);
    this.events.publish(record);
    return record;
  }
  private async exclusive<T>(repo: string, action: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(repo) ?? Promise.resolve();
    let release = (): void => undefined;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.queues.set(repo, current);
    await previous;
    try { return await action(); } finally { release(); if (this.queues.get(repo) === current) this.queues.delete(repo); }
  }
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execute("git", ["-C", cwd, ...args], { env: sanitizedGitEnv(), maxBuffer: 16 * 1024 * 1024, timeout: 120_000 })).stdout;
}
async function optionalGit(cwd: string, ...args: string[]): Promise<string | undefined> {
  try { return (await git(cwd, ...args)).trim(); } catch { return undefined; }
}
async function availableBranch(repo: string, base: string): Promise<string> {
  for (let n = 1; n < 10_000; n++) {
    const candidate = n === 1 ? base : `${base}-${String(n)}`;
    if (await optionalGit(repo, "show-ref", "--verify", `refs/heads/${candidate}`) === undefined) return candidate;
  }
  throw new Error("Cannot allocate an available branch name");
}
async function assertOwnedCheckout(record: SessionWorktreeRecord): Promise<void> {
  const registered = (await discoverGitWorktrees(record.repo)).find((item) => item.path === record.path && item.prunable !== true);
  if (registered?.branch !== record.branch) throw new Error("Owned worktree path or branch no longer matches git");
  if ((await git(record.path, "symbolic-ref", "--short", "HEAD")).trim() !== record.branch) throw new Error("Owned worktree branch changed");
}
async function excludeWorktreeDirectory(repo: string): Promise<void> {
  const common = resolve(repo, (await git(repo, "rev-parse", "--git-common-dir")).trim());
  const file = join(common, "info", "exclude");
  await mkdir(dirname(file), { recursive: true });
  let source = "";
  try { source = await readFile(file, "utf8"); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  if (!source.split("\n").some((line) => line === "/.worktree/" || line === ".worktree/")) await appendFile(file, `${source.endsWith("\n") || source === "" ? "" : "\n"}/.worktree/\n`);
}
async function dirtyFiles(cwd: string): Promise<string[]> {
  const parts = (await git(cwd, "status", "--porcelain=v1", "-z", "--untracked-files=all")).split("\0");
  const files: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === undefined || part === "") continue;
    files.push(part.slice(3));
    if (part.slice(0, 2).includes("R") || part.slice(0, 2).includes("C")) { const old = parts[++i]; if (old !== undefined) files.push(old); }
  }
  return [...new Set(files)];
}
async function mainDirtyOverlap(record: SessionWorktreeRecord): Promise<string[]> {
  const [dirty, touched] = await Promise.all([dirtyFiles(record.repo), git(record.path, "diff", "--name-only", "-z", `${record.defaultBranch}...HEAD`)]);
  const paths = touched.split("\0").filter(Boolean);
  return dirty.filter((file) => paths.some((path) => path === file || pathInside(file, path) || pathInside(path, file)));
}
async function discardFingerprint(record: SessionWorktreeRecord, files: string[]): Promise<string> {
  const hash = createHash("sha256");
  hash.update(record.id).update(record.branch).update(await git(record.path, "rev-parse", "HEAD", record.defaultBranch));
  hash.update(await git(record.path, "diff", "HEAD", "--binary"));
  for (const file of files) {
    hash.update(file);
    try { hash.update(await readFile(join(record.path, file))); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; hash.update("deleted"); }
  }
  return hash.digest("hex");
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function blocked(reason: string, files: string[]): WorktreeActionResult { return { kind: "blocked", reason, files }; }
