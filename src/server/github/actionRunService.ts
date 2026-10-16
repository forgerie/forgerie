import { randomUUID } from "node:crypto";
import type { ActionRun, ActionRunLink, SessionActionRunsResponse } from "../../shared/actionRuns.js";
import type { PullSessionRef } from "../../shared/pullRequests.js";
import type { GitHubAgent } from "./githubAgent.js";
import type { PullSessionGateway } from "./pullRequestService.js";
import type { PullRequestStore } from "./pullRequestStore.js";
import { ActionRunStore, keyOf, type ActionRunRecord } from "./actionRunStore.js";
import { evaluateActionRunWatch, initialActionRunCursor } from "./actionRunWatch.js";
import { deliverWatch, stopWatch, watchStopReason, watchReadExpired, WATCH_POLL_MS } from "./watchLifecycle.js";

interface Dependencies {
  github: Pick<GitHubAgent, "repo" | "run" | "runsForHead" | "pull" | "dispatch">;
  sessions: PullSessionGateway;
  store: ActionRunStore;
  pulls: Pick<PullRequestStore, "forSession">;
  now?: () => number;
  publish?: (link: ActionRunLink) => void;
  publishUnlinked?: (link: ActionRunLink) => void;
  onError: (error: unknown, sessionId: string) => void;
}
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
export function publicActionRunLink(record: ActionRunRecord): ActionRunLink {
  const { provider, session, repo, runId, source, watch } = record;
  return { provider, session, repo, runId, source, watch };
}

/** Owns run links and polling. PR links are only inputs to derived rows, never dependencies of run links. */
export class ActionRunService {
  private readonly now: () => number;
  private timer: NodeJS.Timeout | undefined;
  private disposed = false;
  private readonly polling = new Set<string>();
  private readonly stopGenerations = new Map<string, number>();
  constructor(private readonly deps: Dependencies) { this.now = deps.now ?? Date.now; }
  start(): void { this.timer ??= setInterval(() => { void this.poll(); }, WATCH_POLL_MS); this.timer.unref(); }
  dispose(): void { this.disposed = true; clearInterval(this.timer); this.timer = undefined; }
  catalog(): { links: ActionRunLink[] } { return { links: this.deps.store.list().map(publicActionRunLink) }; }
  isWatching(id: string): boolean { return this.deps.store.isWatching(id); }

  async list(ref: PullSessionRef): Promise<SessionActionRunsResponse> {
    await this.requireSession(ref);
    const items = await Promise.all(this.records(ref).map(async record => {
      try { return await this.read(ref, record.runId); }
      catch (error) { return { link: publicActionRunLink(record), run: null, error: messageOf(error) }; }
    }));
    const derived = await Promise.all(this.deps.pulls.forSession(ref.id).filter(record => record.session.cwd === ref.cwd).map(async record => {
      let headSha = "";
      try {
        const repo = await this.deps.github.repo(ref.cwd);
        if (repo.slug.toLowerCase() !== record.repo.toLowerCase()) throw new Error("The session's GitHub repository changed.");
        const snapshot = await this.deps.github.pull(ref.cwd, record.number);
        headSha = snapshot.pull.headSha;
        const runs = await this.deps.github.runsForHead(ref.cwd, headSha);
        return { pull: record.number, headSha, runs: runs.map(run => ({ ...run, jobs: [] })) };
      } catch (error) { return { pull: record.number, headSha, runs: [], error: messageOf(error) }; }
    }));
    return { items, derived };
  }

  async read(ref: PullSessionRef, runId: number) {
    await this.requireSession(ref);
    const record = this.resolve(ref, runId);
    await this.requireRepo(record);
    const run = await this.deps.github.run(ref.cwd, runId);
    this.checkRun(record, run);
    const current = this.deps.store.get(keyOf(record));
    if (current === undefined) throw new Error("The run was unlinked during the read.");
    return { link: publicActionRunLink(current), run };
  }

  async link(ref: PullSessionRef, input: number | string, source: ActionRunLink["source"] = "manual") {
    const session = await this.requireSession(ref);
    if (!session.available) throw new Error("Only a writable, unarchived session can link a run.");
    const repo = await this.deps.github.repo(ref.cwd);
    const runId = parseRunId(input, repo.slug);
    const run = await this.deps.github.run(ref.cwd, runId);
    if (run.repo.toLowerCase() !== repo.slug.toLowerCase() || run.runId !== runId) throw new Error("The session repository changed during the read.");
    const record = await this.deps.store.link({ ...ref, repo: repo.slug, runId, source });
    this.publish(record);
    return { link: publicActionRunLink(record), run };
  }

  async unlink(ref: PullSessionRef, runId: number): Promise<ActionRunLink> {
    await this.requireSession(ref);
    const removed = await this.deps.store.unlink(keyOf(this.resolve(ref, runId)));
    if (removed === undefined) throw new Error("The run is not linked to this session.");
    const link = publicActionRunLink(removed);
    this.deps.publishUnlinked?.(link);
    return link;
  }

  async watch(ref: PullSessionRef, runId: number): Promise<ActionRunLink> {
    const generation = this.stopGenerations.get(ref.id) ?? 0;
    const current = () => !this.disposed && generation === (this.stopGenerations.get(ref.id) ?? 0);
    const stopped = () => new Error("The watch start was stopped before it could be saved.");
    const session = await this.requireSession(ref);
    if (!session.available) throw new Error("Only a writable, unarchived session can watch a run.");
    parseRunId(runId, "");
    const existing = this.records(ref).find(record => record.runId === runId);
    if (existing !== undefined) {
      await this.requireRepo(existing);
      if (!current()) throw stopped();
      if (existing.watch.kind === "watching") return publicActionRunLink(existing);
    }
    const run = await this.deps.github.run(ref.cwd, runId, false);
    if (!current()) throw stopped();
    if (run.status === "completed") throw new Error("A completed run cannot be watched.");
    if (!run.complete) throw new Error("The run read is incomplete. Try again before watching.");
    if (existing !== undefined) this.checkRun(existing, run);
    const source = existing?.source ?? (await this.belongsToPull(ref, run) ? "pull" : "manual");
    const next = await this.deps.store.startWatch({ ...ref, repo: run.repo, runId, source },
      { since: this.iso(), leaf: session.leaf, cursor: initialActionRunCursor(run.attempt) }, current);
    if (next === undefined) throw stopped();
    this.publish(next);
    return publicActionRunLink(next);
  }

  async stop(id: string, reason = "Stopped by request."): Promise<ActionRunLink[]> {
    this.stopGenerations.set(id, (this.stopGenerations.get(id) ?? 0) + 1);
    // A start already committing is ordered before Stop; starts still reading are refused by generation.
    await this.deps.store.flush();
    const result: ActionRunLink[] = [];
    for (const record of this.deps.store.forSession(id)) {
      const next = await this.stopRecord(record, reason);
      if (next !== undefined) result.push(publicActionRunLink(next));
    }
    return result;
  }

  async stopRef(ref: PullSessionRef, runId?: number): Promise<ActionRunLink | ActionRunLink[] | undefined> {
    await this.requireSession(ref);
    const records = runId === undefined ? this.records(ref) : [this.resolve(ref, runId)];
    const result: ActionRunLink[] = [];
    for (const record of records) {
      const next = await this.stopRecord(record, "Stopped by request.");
      if (next !== undefined) result.push(publicActionRunLink(next));
    }
    return runId === undefined ? result : result[0];
  }

  async dispatch(ref: PullSessionRef, workflow: string, branch: string, inputs?: Record<string, string>): Promise<string> {
    if (!(await this.requireSession(ref)).available) throw new Error("Only a writable, unarchived session can dispatch a run.");
    const result = await this.deps.github.dispatch(ref.cwd, workflow, branch, inputs);
    if (result.runId === undefined) return "Dispatch accepted, but GitHub returned no run details (HTTP 204). No run was linked. Find it with github_read runs and link it with github_actions link. Do not dispatch again.";
    // Persist the known receipt without another GitHub read: dispatch may return before the run is readable.
    try {
      this.publish(await this.deps.store.link({ ...ref, repo: result.repo, runId: result.runId, source: "dispatch" }));
    } catch (error) { throw new Error(`Dispatched run ID ${String(result.runId)} at ${result.url}, but could not save its link: ${messageOf(error)}. Do not dispatch again; link this run.`, { cause: error }); }
    return `Dispatched and linked run ID ${String(result.runId)}.\n${result.url}`;
  }

  async poll(): Promise<void> {
    for (const record of this.deps.store.list()) {
      if (this.disposed) break;
      const key = JSON.stringify(keyOf(record));
      if ((record.watch.kind !== "watching" && record.pending === undefined) || this.polling.has(key)) continue;
      this.polling.add(key);
      try { await this.pollRecord(record); }
      catch (error) { this.deps.onError(error, record.session.id); }
      finally { this.polling.delete(key); }
    }
  }

  private async pollRecord(record: ActionRunRecord): Promise<void> {
    const key = keyOf(record);
    try {
      const state = await this.deps.sessions.inspect(record.session);
      const reason = watchStopReason(state, record.startLeaf);
      if (reason !== undefined) { await this.stopRecord(record, reason); return; }
      if (record.pending !== undefined) { await this.deliver(record); return; }
      await this.requireRepo(record);
      const run = await this.deps.github.run(record.session.cwd, record.runId, false);
      if (this.disposed) return;
      this.checkRun(record, run);
      const report = evaluateActionRunWatch(record.cursor ?? initialActionRunCursor(run.attempt), run);
      const next = await this.deps.store.update(key, record.revision, current => {
        if (current.watch.kind !== "watching") return current;
        return { ...current, cursor: report.cursor, conclusion: run.conclusion, lastReadAt: this.iso(),
          watch: { kind: "watching", since: current.watch.since, wakes: current.watch.wakes + (report.text === undefined ? 0 : 1), ...(report.text === undefined ? {} : { lastWake: this.iso() }) },
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
      if (watchReadExpired(current.lastReadAt ?? current.watch.since, this.now())) await this.stopRecord(current, `Run unavailable for 15 minutes: ${message}`);
      else {
        const next = await this.deps.store.update(key, current.revision, value => ({ ...value, watch: { ...current.watch, error: message } }));
        if (next !== undefined) this.publish(next);
      }
    }
  }

  private async deliver(record: ActionRunRecord): Promise<void> {
    await deliverWatch(this.deps.store, keyOf(record), record, this.deps.sessions, () => this.disposed, value => { this.publish(value); }, value => {
      if (value.cursor?.concluded === true) value.watch = { kind: "stopped", reason: `Run completed (${value.conclusion ?? "unknown"}).`, at: this.iso() };
      return value;
    });
  }

  private stopRecord(record: ActionRunRecord, reason: string) {
    return stopWatch(this.deps.store, keyOf(record), reason, () => this.iso(), value => { this.publish(value); });
  }
  private records(ref: PullSessionRef): ActionRunRecord[] { return this.deps.store.forSession(ref.id).filter(record => record.session.cwd === ref.cwd); }
  private resolve(ref: PullSessionRef, runId: number): ActionRunRecord {
    const records = this.records(ref).filter(record => record.runId === runId);
    if (records.length !== 1 || records[0] === undefined) throw new Error("The run is not uniquely linked to this session and workspace.");
    return records[0];
  }
  private async requireSession(ref: PullSessionRef) {
    const state = await this.deps.sessions.inspect(ref);
    if (state.ref.id !== ref.id || state.ref.cwd !== ref.cwd) throw new Error("Use the full session id and its own workspace.");
    return state;
  }
  private async requireRepo(record: ActionRunRecord): Promise<void> {
    if ((await this.deps.github.repo(record.session.cwd)).slug.toLowerCase() !== record.repo.toLowerCase()) throw new Error("The session's GitHub repository changed. Link its run again.");
  }
  private checkRun(record: ActionRunRecord, run: ActionRun): void {
    if (run.repo.toLowerCase() !== record.repo.toLowerCase() || run.runId !== record.runId) throw new Error("The session repository changed during the read.");
  }
  private async belongsToPull(ref: PullSessionRef, run: ActionRun): Promise<boolean> {
    for (const pull of this.deps.pulls.forSession(ref.id).filter(record => record.session.cwd === ref.cwd && record.repo.toLowerCase() === run.repo.toLowerCase())) {
      if ((await this.deps.github.pull(ref.cwd, pull.number)).pull.headSha === run.headSha) return true;
    }
    return false;
  }
  private iso(): string { return new Date(this.now()).toISOString(); }
  private publish(record: ActionRunRecord): void { this.deps.publish?.(publicActionRunLink(record)); }
}

function parseRunId(input: number | string, repo: string): number {
  let value = typeof input === "number" ? String(input) : input.trim();
  if (value.startsWith("https://")) {
    const url = new URL(value);
    const match = /^\/([^/]+\/[^/]+)\/actions\/runs\/([1-9]\d*)(?:\/attempts\/[1-9]\d*)?\/?$/u.exec(url.pathname);
    if (url.origin !== "https://github.com" || url.username !== "" || url.password !== "" || match?.[1]?.toLowerCase() !== repo.toLowerCase()) throw new Error("Use a run URL on the session's GitHub repository.");
    value = match[2] ?? "";
  }
  if (!/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("Use a positive run ID or a GitHub run URL.");
  return Number(value);
}
