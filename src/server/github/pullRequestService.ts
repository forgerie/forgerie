import { randomUUID } from "node:crypto";
import type { PullLink, PullSessionRef } from "../../shared/pullRequests.js";
import type { GitHubAgent } from "./githubAgent.js";
import { evaluateWatch, initialCursor } from "./pullRequestWatch.js";
import { PullRequestStore, type PullRecord } from "./pullRequestStore.js";

export interface PullSessionState { ref: PullSessionRef; available: boolean; settled: boolean; leaf: string | null }
export interface PullSessionGateway {
  inspect(ref: PullSessionRef): Promise<PullSessionState>;
  wake(ref: PullSessionRef, notice: { id: string; text: string }, stillCurrent: () => boolean): Promise<"delivered" | "busy">;
}
export interface PullServiceDependencies {
  github: Pick<GitHubAgent, "repo" | "pull" | "mergePull">;
  sessions: PullSessionGateway;
  store: PullRequestStore;
  now?: () => number;
  publish?: (link: PullLink) => void;
  onError: (error: unknown, sessionId: string) => void;
}
const POLL_MS = 60_000;
const UNREADABLE_MS = 15 * 60_000;
export function publicLink(record: PullRecord): PullLink { return { session: record.session, repo: record.repo, number: record.number, watch: record.watch }; }

/** Daemon-owned watches. Pending news stays on disk while a session is busy. Stop never waits for GitHub. */
export class PullRequestService {
  private readonly now: () => number;
  private timer: NodeJS.Timeout | undefined;
  private readonly polling = new Set<string>();
  private disposed = false;
  constructor(private readonly deps: PullServiceDependencies) { this.now = deps.now ?? Date.now; }
  start(): void {
    this.timer ??= setInterval(() => { void this.poll(); }, POLL_MS);
    this.timer.unref();
  }
  dispose(): void { this.disposed = true; clearInterval(this.timer); this.timer = undefined; }
  catalog(): { links: PullLink[] } { return { links: this.deps.store.list().map(publicLink) }; }
  isWatching(id: string): boolean { return this.deps.store.isWatching(id); }

  async created(input: { id: string; cwd: string; repo: string; number: number }): Promise<void> {
    this.publish(await this.deps.store.link(input));
  }

  async read(ref: PullSessionRef) {
    await this.requireSession(ref);
    const link = this.record(ref);
    if (link === undefined) return { link: null, pull: null };
    await this.requireRepo(link);
    const snapshot = await this.deps.github.pull(ref.cwd, link.number, true);
    const current = this.record(ref);
    if (current?.repo !== link.repo || current.number !== link.number) throw new Error("The PR link changed during the read. Refresh again.");
    return { link: publicLink(current), pull: snapshot.pull };
  }

  async link(ref: PullSessionRef, number: number) {
    const session = await this.requireSession(ref);
    if (!session.available) throw new Error("Only a writable, unarchived session can link a PR.");
    const snapshot = await this.deps.github.pull(ref.cwd, number);
    const linked = await this.deps.store.link({ ...ref, repo: snapshot.pull.repo, number });
    this.publish(linked);
    return { link: publicLink(linked), pull: snapshot.pull };
  }

  async watch(ref: PullSessionRef, number?: number): Promise<PullLink> {
    const session = await this.requireSession(ref);
    if (!session.available) throw new Error("Only a writable, unarchived session can watch a PR.");
    if (number !== undefined) await this.link(ref, number);
    const record = this.record(ref);
    if (record === undefined) throw new Error("Link a pull request before watching it.");
    await this.requireRepo(record);
    if (record.watch.kind === "watching") return publicLink(record);
    const now = this.iso();
    const snapshot = await this.deps.github.pull(ref.cwd, record.number);
    if (snapshot.pull.state === "merged" || snapshot.pull.state === "closed") throw new Error("A merged or closed PR cannot be watched.");
    if (!snapshot.pull.complete) throw new Error("The PR read is incomplete. Try again before watching.");
    const next = await this.deps.store.update(ref.id, record.revision, (current) => {
      const clean = { ...current, watch: { kind: "watching" as const, since: now, wakes: 0 }, cursor: initialCursor(now), lastReadAt: now, startLeaf: session.leaf };
      delete clean.pending;
      return clean;
    });
    if (next === undefined) throw new Error("The link changed while starting the watch. Try again.");
    this.publish(next);
    return publicLink(next);
  }

  async stop(id: string, reason = "Stopped by request."): Promise<PullLink | undefined> {
    // Retry only local compare-and-writes, never GitHub calls. Concurrent polls cannot defeat Stop.
    for (;;) {
      const current = this.deps.store.get(id);
      if (current === undefined) return undefined;
      if (current.watch.kind !== "watching" && current.pending === undefined) return publicLink(current);
      const stopped = await this.deps.store.update(id, current.revision, (record) => {
        const next: PullRecord = { ...record, watch: { kind: "stopped", reason, at: this.iso() } };
        delete next.pending;
        return next;
      });
      if (stopped !== undefined) { this.publish(stopped); return publicLink(stopped); }
    }
  }

  async stopRef(ref: PullSessionRef): Promise<PullLink | undefined> { await this.requireSession(ref); this.record(ref); return this.stop(ref.id); }

  async merge(ref: PullSessionRef, headSha: string, method: "rebase" | "squash" | "merge", confirmed: { repo: string; number: number }) {
    const session = await this.requireSession(ref);
    if (!session.available) throw new Error("This session is not writable.");
    const record = this.record(ref);
    if (record === undefined) throw new Error("No PR is linked to this session.");
    if (record.number !== confirmed.number || record.repo.toLowerCase() !== confirmed.repo.toLowerCase()) throw new Error("The linked PR changed after confirmation. Refresh and confirm again.");
    await this.requireRepo(record);
    const snapshot = await this.deps.github.pull(ref.cwd, record.number);
    if (snapshot.pull.headSha !== headSha) throw new Error("The PR head changed. Refresh and confirm again.");
    if (snapshot.pull.merge.kind === "blocked") throw new Error(snapshot.pull.merge.reason);
    const current = this.record(ref);
    if (current?.number !== record.number || current.repo.toLowerCase() !== record.repo.toLowerCase()) throw new Error("The linked PR changed during confirmation. Refresh and confirm again.");
    const result = await this.deps.github.mergePull(ref.cwd, record.number, headSha, method, record.repo);
    await this.stop(ref.id, "Pull request merged.");
    return result;
  }

  async poll(): Promise<void> {
    if (this.disposed) return;
    // One request group at a time limits GitHub pressure. Each session has its own overlap guard.
    for (const record of this.deps.store.list()) {
      if (this.isDisposed()) break;
      if ((record.watch.kind !== "watching" && record.pending === undefined) || this.polling.has(record.session.id)) continue;
      this.polling.add(record.session.id);
      try { await this.pollRecord(record); }
      catch (error) { this.deps.onError(error, record.session.id); }
      finally { this.polling.delete(record.session.id); }
    }
  }

  private async pollRecord(record: PullRecord): Promise<void> {
    try {
      const session = await this.deps.sessions.inspect(record.session);
      if (!session.available || (session.settled && session.leaf !== record.startLeaf)) {
        await this.stopCurrent(record, session.available ? "Session needs a response from the user." : "Session is archived, missing, or read-only.");
        return;
      }
      if (record.pending !== undefined) { await this.deliver(record); return; }
      await this.requireRepo(record);
      const snapshot = await this.deps.github.pull(record.session.cwd, record.number);
      if (this.disposed) return;
      if (snapshot.pull.repo.toLowerCase() !== record.repo.toLowerCase()) throw new Error("The session repository changed during the read.");
      if (snapshot.pull.state === "merged" || snapshot.pull.state === "closed") {
        await this.stopCurrent(record, `Pull request ${snapshot.pull.state}.`);
        return;
      }
      const report = evaluateWatch(record.cursor ?? initialCursor(record.watch.kind === "watching" ? record.watch.since : this.iso()), snapshot);
      const next = await this.deps.store.update(record.session.id, record.revision, (current) => {
        if (current.watch.kind !== "watching") return current;
        return { ...current, cursor: report.cursor, lastReadAt: this.iso(),
          watch: report.exhausted ? { kind: "stopped", reason: "10 consecutive comment-only wakes.", at: this.iso() } : { kind: "watching", since: current.watch.since, wakes: current.watch.wakes + (report.text === undefined ? 0 : 1), ...(report.text === undefined ? {} : { lastWake: this.iso() }) },
          ...(report.text === undefined ? {} : { pending: { id: randomUUID(), text: report.text } }) };
      });
      if (next === undefined) return;
      this.publish(next);
      if (next.pending !== undefined) await this.deliver(next);
    } catch (error) {
      if (this.disposed) return;
      this.deps.onError(error, record.session.id);
      const current = this.deps.store.get(record.session.id);
      if (current?.watch.kind !== "watching" || current.revision !== record.revision) return;
      const message = error instanceof Error ? error.message : String(error);
      if (this.now() - Date.parse(current.lastReadAt ?? current.watch.since) >= UNREADABLE_MS) {
        await this.stopCurrent(current, `PR unavailable for 15 minutes: ${message}`);
      } else {
        const next = await this.deps.store.update(current.session.id, current.revision, (value) => ({ ...value, watch: { ...current.watch, error: message } }));
        if (next !== undefined) this.publish(next);
      }
    }
  }

  private async stopCurrent(record: PullRecord, reason: string): Promise<void> {
    const next = await this.deps.store.update(record.session.id, record.revision, (current) => {
      delete current.pending;
      return { ...current, watch: { kind: "stopped", reason, at: this.iso() } };
    });
    if (next !== undefined) this.publish(next);
  }

  private async deliver(record: PullRecord): Promise<void> {
    if (this.disposed || record.pending === undefined || this.deps.store.get(record.session.id)?.revision !== record.revision) return;
    const result = await this.deps.sessions.wake(record.session, record.pending, () => !this.disposed && this.deps.store.get(record.session.id)?.revision === record.revision);
    if (result === "busy" || this.isDisposed()) return;
    const next = await this.deps.store.update(record.session.id, record.revision, (current) => { delete current.pending; return current; });
    if (next !== undefined) this.publish(next);
  }
  private record(ref: PullSessionRef): PullRecord | undefined {
    const record = this.deps.store.get(ref.id);
    if (record !== undefined && record.session.cwd !== ref.cwd) throw new Error("The PR link belongs to another workspace.");
    return record;
  }
  private async requireSession(ref: PullSessionRef): Promise<PullSessionState> {
    const state = await this.deps.sessions.inspect(ref);
    if (state.ref.id !== ref.id || state.ref.cwd !== ref.cwd) throw new Error("Use the full session id and its own workspace.");
    return state;
  }
  private async requireRepo(record: PullRecord): Promise<void> {
    const repo = await this.deps.github.repo(record.session.cwd);
    if (repo.slug.toLowerCase() !== record.repo.toLowerCase()) throw new Error("The session's GitHub repository changed. Link its PR again.");
  }
  private isDisposed(): boolean { return this.disposed; }
  private iso(): string { return new Date(this.now()).toISOString(); }
  private publish(record: PullRecord): void { this.deps.publish?.(publicLink(record)); }
}
