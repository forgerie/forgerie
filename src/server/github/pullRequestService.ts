import { randomUUID } from "node:crypto";
import type { PullLink, PullRequest, PullSessionRef } from "../../shared/pullRequests.js";
import type { GitHubAgent } from "./githubAgent.js";
import { evaluateWatch, initialCursor } from "./pullRequestWatch.js";
import { keyOf, PullRequestStore, type PullKey, type PullRecord } from "./pullRequestStore.js";

export interface PullSessionState { ref: PullSessionRef; available: boolean; settled: boolean; leaf: string | null }
export interface PullSessionGateway {
  inspect(ref: PullSessionRef): Promise<PullSessionState>;
  wake(ref: PullSessionRef, notice: { id: string; text: string }, stillCurrent: () => boolean): Promise<"delivered" | "busy">;
  /**
   * Record something the user did to a pull request outside the chat, such as a
   * merge from the panel. It goes into the transcript the agent reads, and it
   * does not start an agent turn.
   */
  note?(ref: PullSessionRef, notice: PullNote): Promise<void>;
}
export interface PullNote { text: string; details: { kind: "merged"; repo: string; number: number; headSha: string; method: "rebase" | "squash" | "merge"; base: string; url?: string } }
export interface PullServiceDependencies {
  github: Pick<GitHubAgent, "repo" | "pull" | "mergePull">;
  sessions: PullSessionGateway;
  store: PullRequestStore;
  now?: () => number;
  publish?: (link: PullLink) => void;
  /** A link was removed. Its watch went with it. */
  publishUnlinked?: (link: PullLink) => void;
  onError: (error: unknown, sessionId: string) => void;
}
/** One linked pull request as a session reads it. A failed read keeps the link and says why. */
export interface PullItem { link: PullLink; pull: PullRequest | null; error?: string }
const POLL_MS = 60_000;
const UNREADABLE_MS = 15 * 60_000;
export function publicLink(record: PullRecord): PullLink { return { session: record.session, repo: record.repo, number: record.number, watch: record.watch }; }
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
const pollKey = (key: PullKey) => `${key.id}\n${key.repo.toLowerCase()}\n${String(key.number)}`;

/** Daemon-owned watches, one per linked pull request. Pending news stays on disk while a session is busy. Stop never waits for GitHub. */
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

  /** Every pull request linked to the session, oldest first, each read from GitHub. */
  async list(ref: PullSessionRef): Promise<{ items: PullItem[] }> {
    await this.requireSession(ref);
    const records = this.records(ref);
    const items = await Promise.all(records.map(async (record): Promise<PullItem> => {
      try {
        await this.requireRepo(record);
        const snapshot = await this.deps.github.pull(ref.cwd, record.number, true);
        return { link: publicLink(this.deps.store.get(keyOf(record)) ?? record), pull: snapshot.pull };
      } catch (error) { return { link: publicLink(record), pull: null, error: messageOf(error) }; }
    }));
    return { items };
  }

  async read(ref: PullSessionRef, number: number) {
    await this.requireSession(ref);
    const record = this.resolve(ref, number);
    await this.requireRepo(record);
    const snapshot = await this.deps.github.pull(ref.cwd, record.number, true);
    const current = this.deps.store.get(keyOf(record));
    if (current === undefined) throw new Error(`Pull request #${String(number)} was unlinked during the read.`);
    return { link: publicLink(current), pull: snapshot.pull };
  }

  /** Adds a pull request to the session. Linking one never replaces another. */
  async link(ref: PullSessionRef, number: number) {
    const session = await this.requireSession(ref);
    if (!session.available) throw new Error("Only a writable, unarchived session can link a PR.");
    const snapshot = await this.deps.github.pull(ref.cwd, number);
    const linked = await this.deps.store.link({ ...ref, repo: snapshot.pull.repo, number });
    this.publish(linked);
    return { link: publicLink(linked), pull: snapshot.pull };
  }

  async unlink(ref: PullSessionRef, number: number): Promise<PullLink> {
    await this.requireSession(ref);
    const removed = await this.deps.store.unlink(keyOf(this.resolve(ref, number)));
    if (removed === undefined) throw new Error(`Pull request #${String(number)} is not linked to this session.`);
    const link = publicLink(removed);
    this.deps.publishUnlinked?.(link);
    return link;
  }

  /** Watch one pull request. Without a number, the session must have exactly one link. A number not yet linked is linked first. */
  async watch(ref: PullSessionRef, number?: number): Promise<PullLink> {
    const session = await this.requireSession(ref);
    if (!session.available) throw new Error("Only a writable, unarchived session can watch a PR.");
    if (number !== undefined && !this.records(ref).some((record) => record.number === number)) await this.link(ref, number);
    const record = number === undefined ? this.only(ref) : this.resolve(ref, number);
    await this.requireRepo(record);
    if (record.watch.kind === "watching") return publicLink(record);
    const now = this.iso();
    const snapshot = await this.deps.github.pull(ref.cwd, record.number);
    if (snapshot.pull.state === "merged" || snapshot.pull.state === "closed") throw new Error("A merged or closed PR cannot be watched.");
    if (!snapshot.pull.complete) throw new Error("The PR read is incomplete. Try again before watching.");
    const next = await this.deps.store.update(keyOf(record), record.revision, (current) => {
      const clean = { ...current, watch: { kind: "watching" as const, since: now, wakes: 0 }, cursor: initialCursor(now), lastReadAt: now, startLeaf: session.leaf };
      delete clean.pending;
      return clean;
    });
    if (next === undefined) throw new Error("The link changed while starting the watch. Try again.");
    this.publish(next);
    return publicLink(next);
  }

  /** Stop every watch the session has: Abort, Stop, archive, and delete use this. */
  async stop(id: string, reason = "Stopped by request."): Promise<PullLink[]> {
    const stopped: PullLink[] = [];
    for (const record of this.deps.store.forSession(id)) {
      const link = await this.stopKey(keyOf(record), reason);
      if (link !== undefined) stopped.push(link);
    }
    return stopped;
  }

  /** Stop one pull request's watch, or with no number every watch the session has. */
  async stopRef(ref: PullSessionRef, number?: number): Promise<PullLink | PullLink[] | undefined> {
    await this.requireSession(ref);
    if (number === undefined) { this.records(ref); return this.stop(ref.id); }
    return this.stopKey(keyOf(this.resolve(ref, number)), "Stopped by request.");
  }

  async merge(ref: PullSessionRef, headSha: string, method: "rebase" | "squash" | "merge", confirmed: { repo: string; number: number }) {
    const session = await this.requireSession(ref);
    if (!session.available) throw new Error("This session is not writable.");
    const record = this.records(ref).find((item) => item.number === confirmed.number && item.repo.toLowerCase() === confirmed.repo.toLowerCase());
    if (record === undefined) throw new Error("The linked PR changed after confirmation. Refresh and confirm again.");
    await this.requireRepo(record);
    const snapshot = await this.deps.github.pull(ref.cwd, record.number);
    if (snapshot.pull.headSha !== headSha) throw new Error("The PR head changed. Refresh and confirm again.");
    if (snapshot.pull.merge.kind === "blocked") throw new Error(snapshot.pull.merge.reason);
    if (this.deps.store.get(keyOf(record)) === undefined) throw new Error("The linked PR changed during confirmation. Refresh and confirm again.");
    const result = await this.deps.github.mergePull(ref.cwd, record.number, headSha, method, record.repo);
    await this.stopKey(keyOf(record), "Pull request merged.");
    await this.noteMerge(ref, snapshot.pull, method, result.url);
    return result;
  }

  async poll(): Promise<void> {
    if (this.disposed) return;
    // One request group at a time limits GitHub pressure. Each pull request has its own overlap guard.
    for (const record of this.deps.store.list()) {
      if (this.isDisposed()) break;
      const key = pollKey(keyOf(record));
      if ((record.watch.kind !== "watching" && record.pending === undefined) || this.polling.has(key)) continue;
      this.polling.add(key);
      try { await this.pollRecord(record); }
      catch (error) { this.deps.onError(error, record.session.id); }
      finally { this.polling.delete(key); }
    }
  }

  /** The merge already happened on GitHub. A failed note is logged, never reported as a failed merge. */
  private async noteMerge(ref: PullSessionRef, pull: PullRequest, method: "rebase" | "squash" | "merge", url: string | undefined): Promise<void> {
    const how = method === "rebase" ? "rebased onto" : method === "squash" ? "squashed into" : "merged into";
    const text = [
      `The user merged pull request #${String(pull.number)} (${pull.repo}) from the Forgerie panel: ${pull.head} at ${pull.headSha.slice(0, 7)}, ${how} ${pull.base}.`,
      "It is merged on GitHub. Do not merge it again or push to its branch. Its watch has stopped.",
    ].join("\n");
    try { await this.deps.sessions.note?.(ref, { text, details: { kind: "merged", repo: pull.repo, number: pull.number, headSha: pull.headSha, method, base: pull.base, ...(url === undefined ? {} : { url }) } }); }
    catch (error) { this.deps.onError(error, ref.id); }
  }

  private async stopKey(key: PullKey, reason: string): Promise<PullLink | undefined> {
    // Retry only local compare-and-writes, never GitHub calls. Concurrent polls cannot defeat Stop.
    for (;;) {
      const current = this.deps.store.get(key);
      if (current === undefined) return undefined;
      if (current.watch.kind !== "watching" && current.pending === undefined) return publicLink(current);
      const stopped = await this.deps.store.update(key, current.revision, (record) => {
        const next: PullRecord = { ...record, watch: { kind: "stopped", reason, at: this.iso() } };
        delete next.pending;
        return next;
      });
      if (stopped !== undefined) { this.publish(stopped); return publicLink(stopped); }
    }
  }

  private async pollRecord(record: PullRecord): Promise<void> {
    const key = keyOf(record);
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
      const next = await this.deps.store.update(key, record.revision, (current) => {
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
      const current = this.deps.store.get(key);
      if (current?.watch.kind !== "watching" || current.revision !== record.revision) return;
      const message = messageOf(error);
      if (this.now() - Date.parse(current.lastReadAt ?? current.watch.since) >= UNREADABLE_MS) {
        await this.stopCurrent(current, `PR unavailable for 15 minutes: ${message}`);
      } else {
        const next = await this.deps.store.update(key, current.revision, (value) => ({ ...value, watch: { ...current.watch, error: message } }));
        if (next !== undefined) this.publish(next);
      }
    }
  }

  private async stopCurrent(record: PullRecord, reason: string): Promise<void> {
    const next = await this.deps.store.update(keyOf(record), record.revision, (current) => {
      delete current.pending;
      return { ...current, watch: { kind: "stopped", reason, at: this.iso() } };
    });
    if (next !== undefined) this.publish(next);
  }

  private async deliver(record: PullRecord): Promise<void> {
    const key = keyOf(record);
    const current = () => !this.disposed && this.deps.store.get(key)?.revision === record.revision;
    if (record.pending === undefined || !current()) return;
    const result = await this.deps.sessions.wake(record.session, record.pending, current);
    if (result === "busy" || this.isDisposed()) return;
    const next = await this.deps.store.update(key, record.revision, (value) => { delete value.pending; return value; });
    if (next !== undefined) this.publish(next);
  }
  /** The session's links, checked against the workspace the caller named. */
  private records(ref: PullSessionRef): PullRecord[] {
    const records = this.deps.store.forSession(ref.id);
    if (records.some((record) => record.session.cwd !== ref.cwd)) throw new Error("The PR link belongs to another workspace.");
    return records;
  }
  private resolve(ref: PullSessionRef, number: number): PullRecord {
    const matches = this.records(ref).filter((record) => record.number === number);
    const [match, ...others] = matches;
    if (match === undefined) throw new Error(`Pull request #${String(number)} is not linked to this session.`);
    if (others.length > 0) throw new Error(`Pull request #${String(number)} is linked from more than one repository. Unlink the stale one.`);
    return match;
  }
  private only(ref: PullSessionRef): PullRecord {
    const records = this.records(ref);
    const [record, ...others] = records;
    if (record === undefined) throw new Error("Link a pull request before watching it.");
    if (others.length > 0) throw new Error(`This session has ${String(records.length)} linked PRs (${records.map((item) => `#${String(item.number)}`).join(", ")}). Give the number to watch.`);
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
