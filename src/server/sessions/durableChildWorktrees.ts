import type { ChildWorktreeSummary, SessionWorktreeRecord, WorktreeActionResult, WorktreeDiscardPreview } from "../../shared/sessionWorktree.js";
import type { SessionWorktrees } from "../workspaces/sessionWorktrees.js";

/** Child ownership and summaries over the existing Git lifecycle, including its durable removal receipts. */
export class DurableChildWorktrees {
  private pending: Promise<void> = Promise.resolve();

  /** Admission and removal share this lock, so removal cannot race a new child submission. */
  async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const before = this.pending;
    let release!: () => void;
    this.pending = new Promise<void>((resolve) => { release = resolve; });
    await before;
    try { return await operation(); } finally { release(); }
  }

  constructor(private readonly worktrees: SessionWorktrees, private readonly parent: { id: string; cwd: string }) {}

  async prepare(requestId: string, fromDefault = false): Promise<{ id: string; path: string }> {
    await this.worktrees.store.assertWritable(this.parent);
    const record = await this.worktrees.createForChild(this.parent, requestId, fromDefault);
    return { id: record.id, path: record.path };
  }

  async summary(id: string): Promise<ChildWorktreeSummary> {
    const record = await this.owned(id);
    const common = { path: record.path, branch: record.branch, repo: record.repo, defaultBranch: record.defaultBranch, cleanup: record.cleanup };
    if (record.state.kind !== "active") return { ...common, state: record.state.kind, ahead: 0, dirty: false,
      ...(record.state.kind === "discarded" && record.cleanup.kind !== "done" && record.discardConfirmationToken !== undefined ? { cleanupRetryToken: record.discardConfirmationToken } : {}) };
    const info = await this.worktrees.info(record, this.parent.id);
    return { ...common, state: "active", ahead: info.ahead ?? 0, dirty: (info.dirtyFiles ?? 0) > 0,
      ...(info.statusError === undefined ? {} : { statusError: info.statusError }) };
  }

  /** Paths of this session's child worktrees that are still on disk and in use. */
  async activePaths(): Promise<string[]> {
    return (await this.worktrees.store.list()).filter((record) => this.owns(record) && record.state.kind === "active").map((record) => record.path);
  }

  async report(id: string): Promise<string> {
    const summary = await this.summary(id);
    const files = await this.worktrees.changedFiles(id);
    const names = files.slice(0, 20).join(", ");
    const changed = files.length === 0 ? "none" : `${names}${files.length > 20 ? `, and ${String(files.length - 20)} more` : ""}`;
    return `Worktree branch: ${summary.branch}. Commits ahead of the parent's starting HEAD: ${String(summary.ahead)}. Files changed: ${changed}.`;
  }

  async assertWritable(id: string): Promise<void> {
    await this.worktrees.store.assertWritable(this.parent);
    if ((await this.owned(id)).state.kind !== "active") throw new Error("This child's worktree is no longer writable. Spawn a new child for new work.");
  }

  async review(id: string) {
    await this.owned(id);
    return this.worktrees.review(id);
  }

  async land(id: string): Promise<WorktreeActionResult> {
    await this.owned(id);
    return this.worktrees.land(id, [], this.parent.id);
  }

  async discardPreview(id: string): Promise<WorktreeDiscardPreview> {
    await this.owned(id);
    return this.worktrees.discardPreview(id);
  }

  async discard(id: string, confirmationToken: string): Promise<WorktreeActionResult> {
    await this.owned(id);
    return this.worktrees.discard(id, confirmationToken, [], this.parent.id);
  }

  private async owned(id: string): Promise<SessionWorktreeRecord> {
    const record = await this.worktrees.store.require(id);
    if (!this.owns(record)) throw new Error("This worktree is not owned by a child of this session");
    return record;
  }

  private owns(record: SessionWorktreeRecord): boolean {
    return record.sourceCommit !== undefined && record.childOwner?.id === this.parent.id && record.childOwner.cwd === this.parent.cwd;
  }
}
