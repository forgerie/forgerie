import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { SESSION_WORKTREE_DIRECTORY, type SessionWorktreeRecord, type SessionWorktreeInfo, type WorktreeActionResult, type WorktreeArchiveCleanupResult, type WorktreeDiscardPreview } from "../../shared/sessionWorktree.js";
import type { WorktreeCleanupOutcome } from "../../shared/worktreeCleanup.js";
import { sanitizedGitEnv } from "../git/gitEnv.js";
import { readWorktreeReview } from "./worktreeReview.js";
import { discoverGitWorktrees, isGitRepository } from "./gitWorktreeDiscovery.js";
import { SessionWorktreeStore, pathInside, worktreeInfo, type SessionWorktreeChanges, worktreeSessionMetadata } from "./sessionWorktreeStore.js";
import { runWorktreeHook, WORKTREE_POST_CREATE_HOOK_PATH, WORKTREE_PRE_REMOVE_HOOK_PATH } from "./worktreeHooks.js";

const execute = promisify(execFile);
export interface WorktreeSessionFile { id: string; cwd: string; path: string; transcriptSourcePath?: string }
type SessionFile = WorktreeSessionFile;
interface WorktreeEvents {
  /** Forget read-only project discovery after Git changes a checkout or branch. */
  worktreesChanged?(): void;
  publish(record: SessionWorktreeRecord): void;
  /** Close idle runtimes and terminals only after the durable input gate is set. */
  beforeRemoval?(record: SessionWorktreeRecord): Promise<readonly SessionFile[]>;
  beforeRelatedAction?(record: SessionWorktreeRecord, actorId?: string): Promise<void>;
  /** Session close at the destruction boundary, not on a failed Land attempt. */
  closeManagedProcesses?(record: SessionWorktreeRecord): Promise<void>;
  /** Confirm declared service shutdown before hooks, including cleanup retries after a receipt. */
  stopServices?(record: SessionWorktreeRecord): Promise<void>;
}

export interface SessionWorktreesOptions {
  now?: () => number;
  /**
   * How long info() keeps a worktree's git-derived status. Default 0: ask git on every call.
   * Session lists, project views, heartbeats and child summaries all ask for the same six git
   * answers per active worktree, and each git call is a child process started from sessiond's
   * main thread. A record change forgets the status at once.
   */
  statusCacheMs?: number;
}
type WorktreeGitStatus = Pick<SessionWorktreeInfo, "ahead" | "behind" | "dirtyFiles" | "statusError">;

/** All git lifecycle mutations are serialized per main checkout. Git's own locks protect external writers. */
export class SessionWorktrees {
  private readonly queues = new Map<string, Promise<void>>();
  /** Record ID to its git status, with the time it was read, or the read in flight. */
  private readonly status = new Map<string, { at: number; value: Promise<WorktreeGitStatus> }>();
  private readonly now: () => number;
  constructor(readonly store: SessionWorktreeStore, private readonly events: WorktreeEvents = { publish: () => undefined }, private readonly settings: SessionWorktreesOptions = {}) {
    this.now = settings.now ?? Date.now;
  }

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

  /** Stable ownership is saved before Git runs. Replay reuses the same checkout and original parent HEAD. */
  async createForChild(parent: { id: string; cwd: string }, requestId: string, fromDefault = false): Promise<SessionWorktreeRecord> {
    const id = `child-${createHash("sha256").update(JSON.stringify([parent.id, requestId])).digest("hex")}`;
    const options = fromDefault ? await this.options(parent.cwd) : undefined;
    if (options?.kind === "non-git") throw new Error("Fresh worktrees require a Git project");
    const sourceCommit = (await git(options?.repo ?? parent.cwd, "rev-parse", options?.defaultBranch ?? "HEAD")).trim();
    return this.create(parent.cwd, undefined, undefined, undefined, { id, sourceCommit, owner: parent });
  }

  async create(cwd: string, startupToken?: string, retryId?: string, relatedSession?: SessionWorktreeRecord["relatedSession"], allocation?: { id: string; sourceCommit: string; owner: { id: string; cwd: string } }): Promise<SessionWorktreeRecord> {
    const options = await this.options(cwd);
    if (options.kind !== "git") throw new Error("Fresh worktrees require a Git project");
    return this.exclusive(options.repo, async () => {
      let record: SessionWorktreeRecord;
      const allocated = allocation === undefined ? undefined : (await this.store.list()).find((item) => item.id === allocation.id);
      const existingId = retryId ?? allocated?.id;
      if (existingId !== undefined) {
        record = await this.store.require(existingId);
        if (record.repo !== options.repo || record.sessionId !== undefined || record.state.kind !== "active" || JSON.stringify(record.relatedSession) !== JSON.stringify(relatedSession) || JSON.stringify(record.childOwner) !== JSON.stringify(allocation?.owner)) throw new Error("Only an unowned setup in this repository can be retried");
        if (allocated !== undefined && record.setup.phase === "done") {
          await assertOwnedCheckout(record);
          return record;
        }
      } else {
        const id = allocation?.id ?? randomUUID();
        const name = allocation === undefined ? `s-${id.slice(0, 8)}` : `c-${id.slice("child-".length)}`;
        const branch = allocation === undefined ? await availableBranch(options.repo, name) : name;
        const timestamp = new Date().toISOString();
        record = { id, repo: options.repo, path: join(options.repo, SESSION_WORKTREE_DIRECTORY, name), branch, defaultBranch: options.defaultBranch,
          renamed: false, setup: { phase: "creating", log: "" }, state: { kind: "active" }, cleanup: { kind: "pending" }, transcripts: [], createdAt: timestamp, updatedAt: timestamp,
          ...(allocation === undefined ? {} : { sourceCommit: allocation.sourceCommit, childOwner: allocation.owner }),
          ...(startupToken === undefined ? {} : { startupToken }), ...(relatedSession === undefined ? {} : { relatedSession }) };
        await this.store.add(record);
      }
      try {
        record = await this.change(record.id, { setup: { phase: "creating", log: "" } });
        await excludeWorktreeDirectory(record.repo);
        const existing = (await discoverGitWorktrees(record.repo)).find((item) => item.path === record.path && item.prunable !== true);
        if (existing === undefined) {
          await mkdir(dirname(record.path), { recursive: true });
          // Leave setup to the lifecycle hook below, not Git's first-checkout hook.
          // It streams setup logs and allows 15 minutes rather than Git's 2-minute deadline.
          try {
            await execute("git", ["-C", record.repo, "worktree", "add", "-b", record.branch, record.path, record.sourceCommit ?? record.defaultBranch], {
              env: { ...sanitizedGitEnv(), FORGERIE_MANAGED_WORKTREE_SETUP: "1" }, maxBuffer: 16 * 1024 * 1024, timeout: 120_000,
            });
          } finally { this.events.worktreesChanged?.(); }
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
        return await this.change(record.id, { setup: { phase: relatedSession === undefined && allocation === undefined ? "starting" : "done", log: result.log } });
      } catch (error) {
        const latest = await this.store.require(record.id);
        if (latest.setup.phase !== "failed") await this.change(record.id, { setup: { ...latest.setup, phase: "failed", error: message(error) } });
        throw error;
      }
    });
  }

  async attach(id: string, session: SessionFile): Promise<void> {
    const record = await this.store.require(id);
    if (record.relatedSession !== undefined || record.childOwner !== undefined || record.sessionId !== undefined || session.cwd !== record.path) throw new Error("Invalid worktree session ownership");
    await this.change(id, { sessionId: session.id, ownerSession: worktreeSessionMetadata(record, session), setup: { ...record.setup, phase: "done" } });
  }
  async failedStart(id: string, error: unknown): Promise<void> {
    const record = await this.store.require(id);
    await this.change(id, { setup: { ...record.setup, phase: "failed", error: message(error) } });
  }

  async info(record: SessionWorktreeRecord, sessionId: string): Promise<SessionWorktreeInfo> {
    const info = worktreeInfo(record, sessionId);
    if (record.state.kind !== "active") return info;
    return { ...info, ...await this.gitStatus(record) };
  }
  private gitStatus(record: SessionWorktreeRecord): Promise<WorktreeGitStatus> {
    const window = this.settings.statusCacheMs ?? 0;
    const now = this.now();
    const held = this.status.get(record.id);
    if (held !== undefined && now - held.at < window) return held.value;
    const value = readGitStatus(record);
    if (window > 0) {
      const entry = { at: now, value };
      this.status.set(record.id, entry);
      // Do not keep a failed read as the answer for the whole window. A record change may also
      // have replaced the entry in the meantime; leave that newer entry alone.
      void value.then((status) => { if (status.statusError !== undefined && this.status.get(record.id) === entry) this.status.delete(record.id); }, () => { if (this.status.get(record.id) === entry) this.status.delete(record.id); });
    }
    return value;
  }

  /** Changed paths for a child report, including committed changes and uncommitted work. */
  async changedFiles(id: string): Promise<string[]> {
    const record = await this.store.require(id);
    if (record.state.kind !== "active") return [];
    await assertOwnedCheckout(record);
    const committed = (await git(record.path, "diff", "--name-only", "-z", `${record.sourceCommit ?? record.defaultBranch}...HEAD`)).split("\0").filter(Boolean);
    return [...new Set([...committed, ...await dirtyFiles(record.path)])].sort();
  }

  async review(id: string) {
    const record = await this.store.require(id);
    if (record.state.kind !== "active") throw new Error("This worktree is no longer writable or available for review");
    await assertOwnedCheckout(record);
    return readWorktreeReview(record.path, record.defaultBranch);
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
      finally { this.events.worktreesChanged?.(); }
      await this.change(current.id, { branch, renamed: true, pendingRename: undefined });
    });
  }

  async land(id: string, sessions: readonly SessionFile[], actorId?: string): Promise<WorktreeActionResult> {
    const record = await this.store.require(id);
    return this.exclusive(record.repo, async () => {
      let current = await this.store.require(id);
      if (current.relatedSession !== undefined || current.childOwner !== undefined) await this.events.beforeRelatedAction?.(current, actorId);
      const related = await this.activeRelated(current);
      if (related.length > 0) return blocked("related-worktrees-active", related);
      if (current.state.kind === "discarded") throw new Error("Discarded worktrees cannot be landed");
      if (current.state.kind === "landed") {
        const sha = current.state.sha;
        if (current.relatedSession === undefined && current.childOwner === undefined) return { kind: "landed", sha, cleanup: await this.remove(current, false) };
        current = await this.change(id, { operation: "land" });
        try {
          await this.store.saveTranscripts(id, await this.removalSessions(current, sessions, actorId));
          return { kind: "landed", sha, cleanup: await this.remove(current, false) };
        } finally { await this.change(id, { operation: undefined }); }
      }
      await assertOwnedCheckout(current);
      if ((await dirtyFiles(current.path)).length !== 0) return blocked("worktree-dirty", await dirtyFiles(current.path));
      const branch = (await git(current.repo, "symbolic-ref", "--short", "HEAD")).trim();
      if (branch !== current.defaultBranch) return blocked("main-not-on-default-branch", []);
      const overlaps = await mainDirtyOverlap(current);
      if (overlaps.length !== 0) return blocked("main-dirty", overlaps);
      current = await this.change(id, { operation: "land" });
      try {
        await this.store.saveTranscripts(id, await this.removalSessions(current, sessions, actorId));
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
  async discard(id: string, token: string, sessions: readonly SessionFile[], actorId?: string): Promise<WorktreeActionResult> {
    const record = await this.store.require(id);
    return this.exclusive(record.repo, async () => {
      let current = await this.store.require(id);
      if (current.relatedSession !== undefined || current.childOwner !== undefined) await this.events.beforeRelatedAction?.(current, actorId);
      const related = await this.activeRelated(current);
      if (related.length > 0) return blocked("related-worktrees-active", related);
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
        await this.store.saveTranscripts(id, await this.removalSessions(current, sessions, actorId));
        // Persist the read-only receipt BEFORE destructive cleanup. Failed hooks leave a retryable checkout.
        current = await this.change(id, { state: current.state.kind === "discarded" ? current.state : { kind: "discarded", at: new Date().toISOString() }, discardConfirmationToken: token, discardedBranchTip: (await git(current.path, "rev-parse", "HEAD")).trim() });
        return { kind: "discarded", cleanup: await this.remove(current, true) };
      } finally { await this.change(id, { operation: undefined }); }
    });
  }

  /** Automatic cleanup admits only owned, clean, merged checkouts with no live session. */
  async cleanupUnused(id: string, inUse: (record: SessionWorktreeRecord) => Promise<boolean>): Promise<WorktreeCleanupOutcome> {
    const record = await this.store.require(id);
    return this.exclusive(record.repo, async () => {
      const current = await this.store.require(id);
      if (current.cleanup.kind === "done") return { kind: "removed" };
      if (current.operation !== undefined) return { kind: "kept", reason: "in-use" };
      if (current.setup.phase !== "done" || current.pendingRename !== undefined) return { kind: "kept", reason: "setup-incomplete" };
      const keep = async (): Promise<Extract<WorktreeCleanupOutcome, { kind: "kept" }> | undefined> => {
        if (await inUse(current) || (await this.activeRelated(current)).length > 0) return { kind: "kept", reason: "in-use" };
        try { await assertOwnedCheckout(current); } catch (error) { return { kind: "kept", reason: "checkout-changed", detail: message(error) }; }
        if ((await dirtyFiles(current.path, true)).length > 0) return { kind: "kept", reason: "dirty" };
        if ((await git(current.path, "rev-list", "--count", `${current.defaultBranch}..HEAD`)).trim() !== "0") return { kind: "kept", reason: "unmerged" };
        return undefined;
      };
      try {
        const retained = await keep();
        if (retained !== undefined) return retained;
        await this.change(id, { operation: "archive" });
        let stopped: Extract<WorktreeCleanupOutcome, { kind: "kept" }> | undefined;
        const recheck = async () => {
          stopped = await keep();
          if (stopped !== undefined) throw new Error(`Automatic cleanup kept the checkout: ${stopped.reason}`);
        };
        await recheck();
        if (current.state.kind === "active") await this.store.saveTranscripts(id, await this.removalSessions(current, []));
        const cleanup = await this.remove(current, false, async (phase) => {
          await recheck();
          // A retained active checkout stays writable. Persist its receipt only after hooks and final checks.
          if (phase === "before-remove" && current.state.kind === "active") {
            const sha = (await git(current.repo, "rev-parse", current.defaultBranch)).trim();
            await this.change(id, { state: { kind: "landed", sha, at: new Date().toISOString() } });
          }
        });
        if (cleanup.kind === "done") return { kind: "removed" };
        return stopped ?? { kind: "kept", reason: "error", ...(cleanup.kind === "failed" ? { detail: cleanup.error } : {}) };
      } catch (error) { return { kind: "kept", reason: "error", detail: message(error) }; }
      finally { if ((await this.store.require(id)).operation === "archive") await this.change(id, { operation: undefined }); }
    });
  }

  async archiveCleanup(id: string, sessions: readonly SessionFile[]): Promise<WorktreeArchiveCleanupResult> {
    const record = await this.store.require(id);
    const result = await this.exclusive<WorktreeArchiveCleanupResult>(record.repo, async () => {
      const current = await this.store.require(id);
      if (current.state.kind !== "active") return { kind: "retained", reason: "already-completed" };
      if ((await this.activeRelated(current)).length > 0) return { kind: "retained", reason: "related-worktrees-active" };
      if (sessions.some((session) => session.id !== current.sessionId && pathInside(current.path, session.cwd))) return { kind: "retained", reason: "shared" };
      try {
        // A checkout moved, removed, or switched outside Forgerie is not Forgerie's to remove. Say so with a code, not git's words.
        try { await assertOwnedCheckout(current); } catch { return { kind: "retained", reason: "checkout-changed" }; }
        if ((await dirtyFiles(current.path, true)).length !== 0) return { kind: "retained", reason: "dirty" };
        if ((await git(current.path, "rev-list", "--count", `${current.defaultBranch}..HEAD`)).trim() !== "0") return { kind: "retained", reason: "unlanded-commits" };
        await this.change(id, { operation: "archive" });
        await this.store.saveTranscripts(id, await this.removalSessions(current, sessions));
        const sha = (await git(current.repo, "rev-parse", current.defaultBranch)).trim();
        const landed = await this.change(id, { state: { kind: "landed", sha, at: new Date().toISOString() } });
        return { kind: "removed", cleanup: await this.remove(landed, false, async () => {
          await assertOwnedCheckout(landed);
          if ((await dirtyFiles(landed.path, true)).length > 0) throw new Error("Archive cleanup kept uncommitted or ignored files");
        }) };
      } catch (error) { return { kind: "retained", reason: message(error) }; }
      finally { await this.change(id, { operation: undefined }); }
    });
    await this.change(id, { archiveCleanup: result });
    return result;
  }

  private async activeRelated(record: SessionWorktreeRecord): Promise<string[]> {
    if (record.sessionId === undefined) return [];
    return (await this.store.list()).filter((item) => (item.relatedSession?.id ?? item.childOwner?.id) === record.sessionId && (item.state.kind === "active" || item.cleanup.kind !== "done")).map((item) => item.path);
  }

  private async removalSessions(record: SessionWorktreeRecord, fallback: readonly SessionFile[], actorId?: string): Promise<readonly SessionFile[]> {
    // Check again after the durable input gate is installed. A source run may
    // have started during the earlier Git reads.
    if (record.relatedSession !== undefined || record.childOwner !== undefined) await this.events.beforeRelatedAction?.(record, actorId);
    return this.events.beforeRemoval?.(record) ?? fallback;
  }

  private async remove(record: SessionWorktreeRecord, force: boolean, beforeDestruction?: (phase: "before-hook" | "before-remove") => Promise<void>): Promise<SessionWorktreeRecord["cleanup"]> {
    if (record.cleanup.kind === "done") return record.cleanup;
    try {
      const registered = (await discoverGitWorktrees(record.repo)).find((item) => item.path === record.path);
      await this.events.stopServices?.(record);
      await beforeDestruction?.("before-hook");
      if (registered !== undefined && registered.prunable !== true) {
        await assertOwnedCheckout(record);
        if (!force) await git(record.repo, "merge-base", "--is-ancestor", record.branch, record.defaultBranch);
        const result = await runWorktreeHook({ repo: record.repo, relativePath: WORKTREE_PRE_REMOVE_HOOK_PATH, target: record.path, cwd: record.repo });
        if (result.exitCode !== 0) throw new Error(`Pre-remove hook exited with ${String(result.exitCode)}: ${result.log}`);
        if (!force) await git(record.repo, "merge-base", "--is-ancestor", record.branch, record.defaultBranch);
        else if (record.discardedBranchTip !== (await git(record.repo, "rev-parse", record.branch)).trim()) throw new Error("Branch changed during discard cleanup. Request a new discard preview.");
        await beforeDestruction?.("before-remove");
        await this.events.closeManagedProcesses?.(await this.store.require(record.id));
        try { await git(record.repo, "worktree", "remove", ...(force ? ["--force"] : []), record.path); }
        finally { this.events.worktreesChanged?.(); }
      } else if (registered !== undefined) {
        throw new Error("Checkout disappeared outside Forgerie; inspect and prune its git registration before retrying cleanup");
      }
      if (registered === undefined) await this.events.closeManagedProcesses?.(await this.store.require(record.id));
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
    this.status.delete(id);
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

async function readGitStatus(record: SessionWorktreeRecord): Promise<WorktreeGitStatus> {
  try {
    await assertOwnedCheckout(record);
    const [counts, files] = await Promise.all([git(record.path, "rev-list", "--left-right", "--count", `${record.sourceCommit ?? record.defaultBranch}...HEAD`), dirtyFiles(record.path)]);
    const [behind, ahead] = counts.trim().split(/\s+/).map(Number);
    return { ahead: ahead ?? 0, behind: behind ?? 0, dirtyFiles: files.length };
  } catch (error) { return { statusError: message(error) }; }
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
  const expected = await realpath(resolve(record.repo, (await git(record.repo, "rev-parse", "--git-common-dir")).trim()));
  const actual = await realpath(resolve(record.path, (await git(record.path, "rev-parse", "--git-common-dir")).trim()));
  if (expected !== actual) throw new Error("Owned worktree repository changed");
}
async function excludeWorktreeDirectory(repo: string): Promise<void> {
  const common = resolve(repo, (await git(repo, "rev-parse", "--git-common-dir")).trim());
  const file = join(common, "info", "exclude");
  await mkdir(dirname(file), { recursive: true });
  let source = "";
  try { source = await readFile(file, "utf8"); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  const directory = `/${SESSION_WORKTREE_DIRECTORY}/`;
  if (!source.split("\n").some((line) => line === directory || line === `${SESSION_WORKTREE_DIRECTORY}/`)) await appendFile(file, `${source.endsWith("\n") || source === "" ? "" : "\n"}${directory}\n`);
}
async function dirtyFiles(cwd: string, includeIgnored = false): Promise<string[]> {
  const parts = (await git(cwd, "status", "--porcelain=v1", "-z", "--untracked-files=all", ...(includeIgnored ? ["--ignored=matching"] : []))).split("\0");
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
