import type { SessionWorktreeRecord } from "../../shared/sessionWorktree.js";
import type { WorktreeCleanupReport, WorktreeCleanupState } from "../../shared/worktreeCleanup.js";
import type { SessionWorktrees } from "./sessionWorktrees.js";

interface CleanupDependencies {
  worktrees: SessionWorktrees;
  inUse(record: SessionWorktreeRecord): Promise<boolean>;
  onError?(error: unknown): void;
}

/** Visits only Forgerie's ownership inventory. Unowned Git worktrees are never deletion candidates. */
export class WorktreeCleanupJob {
  private state: WorktreeCleanupState = { phase: "never-run" };
  private completed: WorktreeCleanupReport | undefined;
  private pending: Promise<WorktreeCleanupReport> | undefined;
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(private readonly dependencies: CleanupDependencies) {}

  snapshot(): WorktreeCleanupState { return structuredClone(this.state); }

  run(): Promise<WorktreeCleanupReport> {
    if (this.stopped) return Promise.reject(new Error("Worktree cleanup is stopping"));
    if (this.pending !== undefined) return this.pending;
    this.state = { phase: "running", ...(this.completed === undefined ? {} : { previous: this.completed }) };
    const pending = this.sweep().then((report) => {
      this.completed = structuredClone(report);
      this.state = { phase: "done", report: this.completed };
      return report;
    }, (error: unknown) => {
      this.state = { phase: "failed", error: error instanceof Error ? error.message : String(error), ...(this.completed === undefined ? {} : { previous: this.completed }) };
      throw error;
    });
    this.pending = pending;
    void pending.then(() => { this.pending = undefined; }, () => { this.pending = undefined; });
    return pending;
  }

  start(intervalMs = 5 * 60_000): void {
    if (this.timer !== undefined) return;
    if (this.stopped) throw new Error("Worktree cleanup is stopping");
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error("Cleanup interval must be positive");
    const run = () => { void this.run().catch((error: unknown) => { this.dependencies.onError?.(error); }); };
    this.timer = setInterval(run, intervalMs);
    this.timer.unref();
    run();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = undefined;
    await this.pending;
  }

  private async sweep(): Promise<WorktreeCleanupReport> {
    const startedAt = new Date().toISOString();
    const kept: WorktreeCleanupReport["kept"] = [];
    const removed: WorktreeCleanupReport["removed"] = [];
    for (const record of (await this.dependencies.worktrees.store.list()).filter((item) => item.cleanup.kind !== "done")) {
      const identity = { id: record.id, repo: record.repo, path: record.path, branch: record.branch };
      try {
        const outcome = await this.dependencies.worktrees.cleanupUnused(record.id, (item) => this.dependencies.inUse(item));
        if (outcome.kind === "removed") removed.push(identity);
        else kept.push({ ...identity, reason: outcome.reason, ...(outcome.detail === undefined ? {} : { detail: outcome.detail }) });
      } catch (error) {
        kept.push({ ...identity, reason: "error", detail: error instanceof Error ? error.message : String(error) });
      }
    }
    return { startedAt, finishedAt: new Date().toISOString(), kept, removed };
  }
}
