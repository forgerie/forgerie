import { watch } from "node:fs";
import { mkdir } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { lateText, type TriggerFileState, type WorkflowScheduleBlock } from "../../shared/triggerFiles.js";
import { DEFAULT_MISSED_GRACE_MINUTES, TriggerIdSchema, type Trigger, type TriggerCreate, type TriggerCreator, type TriggerUpdate, type TriggerTargets } from "../../shared/triggers.js";
import { Check } from "typebox/value";
import type { ProjectWorkspaceCwds } from "../workspaces/projectWorkspaceCwds.js";
import { editScheduleBlock, parseScheduledWorkflow } from "./triggerFileFormat.js";
import { TriggerError } from "./durableTriggers.js";
import type { StoredTriggers } from "./triggerMigration.js";
import type { TriggerFiles } from "./triggerFiles.js";

interface FileSyncStore {
  list(): Promise<Trigger[]>;
  create(input: TriggerCreate, creator?: TriggerCreator): Promise<Trigger>;
  update(id: string, input: TriggerUpdate): Promise<Trigger>;
  pause(id: string): Promise<Trigger>;
  resume(id: string): Promise<Trigger>;
  controls(): Promise<NonNullable<StoredTriggers["fileControls"]>>;
  clearControl(id: string): Promise<void>;
  migration(): Promise<NonNullable<StoredTriggers["fileMigration"]>>;
  plan(id: string, target: string): Promise<void>;
  rekey(id: string, target: string): Promise<void>;
  finish(skipped: string[]): Promise<void>;
}
export interface TriggerFileSyncRuntime {
  watch?: (directory: string, changed: () => void) => { close(): void };
  interval?: (callback: () => void, milliseconds: number) => () => void;
  timeout?: (callback: () => void, milliseconds: number) => () => void;
}
interface FileSyncOptions {
  files: TriggerFiles;
  store: FileSyncStore;
  workspaces: ProjectWorkspaceCwds;
  requireWorkspace: (path: string) => Promise<string>;
  requireGlobalWorkflow: (record: Trigger) => Promise<void>;
  timezone: string;
  now: () => number;
  publish: () => void;
  onError: (error: unknown) => void;
  runtime?: TriggerFileSyncRuntime;
}

interface PendingScan { kind: "queued" | "running"; dirty: boolean; force: boolean }
type BackgroundScan = { kind: "idle" } | { kind: "debouncing"; cancel: () => void } | PendingScan;

/** Reconciles user-owned files into the existing durable scheduling operations. No second scheduling engine. */
export class TriggerFileSync {
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private watcher: { close(): void } | undefined;
  private cancelInterval: (() => void) | undefined;
  private readonly states = new Map<string, TriggerFileState>();
  private readonly lastGoodHashes = new Map<string, string>();
  private skipped = new Set<string>();
  private background: BackgroundScan = { kind: "idle" };
  private syncedHashes = new Map<string, string>();
  constructor(private readonly options: FileSyncOptions) {}
  state(id: string): TriggerFileState | undefined { return this.states.get(id); }
  managed(id: string): boolean { return !this.skipped.has(id); }
  transaction<T>(action: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new TriggerError("Trigger file sync is closed", 503));
    const next = this.queue.then(action);
    // A rejected operation must not poison subsequent saves or watcher scans.
    this.queue = next.catch(() => undefined);
    return next;
  }
  async start(): Promise<void> {
    await mkdir(this.options.files.directory, { recursive: true });
    await this.transaction(async () => { await this.migrate(); await this.scan(); });
    const changed = () => { this.requestBackgroundScan(); };
    const interval = this.options.runtime?.interval ?? ((callback, ms) => { const timer = setInterval(callback, ms); timer.unref(); return () => { clearInterval(timer); }; });
    this.cancelInterval = interval(() => { this.watch(changed); this.requestBackgroundScan(true); }, 60_000);
    this.watch(changed);
  }
  private requestBackgroundScan(force = false): void {
    if (this.closed) return;
    const current = this.background;
    if (current.kind === "queued" || current.kind === "running") {
      current.dirty = true;
      current.force ||= force;
      return;
    }
    if (current.kind === "debouncing") current.cancel();
    // The fallback must run even when continuous watch traffic never reaches a quiet period.
    if (force) { this.enqueueBackgroundScan(true); return; }
    const pending: Extract<BackgroundScan, { kind: "debouncing" }> = { kind: "debouncing", cancel: () => undefined };
    this.background = pending;
    const timeout = this.options.runtime?.timeout ?? ((callback, ms) => { const timer = setTimeout(callback, ms); timer.unref(); return () => { clearTimeout(timer); }; });
    pending.cancel = timeout(() => {
      if (!this.closed && this.background === pending) this.enqueueBackgroundScan(false);
    }, 150);
  }
  private enqueueBackgroundScan(force: boolean): void {
    const pending: PendingScan = { kind: "queued", dirty: false, force };
    this.background = pending;
    void this.transaction(async () => {
      if (this.closed) { this.background = { kind: "idle" }; return; }
      pending.kind = "running";
      // Events received while queued are covered by this read; only events during it need a follow-up.
      pending.dirty = false;
      const forced = pending.force;
      pending.force = false;
      try {
        let unchanged = false;
        if (!forced) {
          try {
            const hashes = await this.options.files.hashes();
            for (const id of this.skipped) hashes.delete(id);
            unchanged = isDeepStrictEqual(hashes, this.syncedHashes);
          } catch { /* A full scan reports file IO problems instead of treating a failed probe as an echo. */ }
        }
        if (!unchanged) await this.scan();
      } finally { this.finishBackgroundScan(pending); }
    }).catch(this.options.onError);
  }
  private finishBackgroundScan(pending: PendingScan): void {
    this.background = { kind: "idle" };
    // Events can mark the request dirty while its asynchronous reads are in progress.
    if (!this.closed && pending.dirty) this.enqueueBackgroundScan(pending.force);
  }
  private watch(changed: () => void): void {
    if (this.watcher !== undefined || this.closed) return;
    try {
      this.watcher = (this.options.runtime?.watch ?? ((directory, callback) => {
        const watcher = watch(directory, callback);
        watcher.on("error", (error) => { watcher.close(); this.watcher = undefined; this.options.onError(error); });
        return watcher;
      }))(this.options.files.directory, changed);
    } catch (error) { this.options.onError(error); }
  }
  async close(): Promise<void> {
    this.closed = true;
    this.watcher?.close(); this.cancelInterval?.();
    if (this.background.kind === "debouncing") { this.background.cancel(); this.background = { kind: "idle" }; }
    await this.queue;
  }
  async validate(id: string, text: string): Promise<NonNullable<ReturnType<typeof parseScheduledWorkflow>>> {
    const parsed = parseScheduledWorkflow(id, this.options.files.path(id), text, this.options.timezone);
    if (parsed === undefined) throw new TriggerError("A scheduled workflow needs a schedule block", 400, "schedule");
    const projects = parsed.block.projects;
    if (projects !== "all") {
      const registered = await this.options.workspaces.registeredProjects?.() ?? [];
      const cwds: string[] = [];
      for (const project of projects) {
        let path = project;
        if (!isAbsolute(project)) {
          const matches = registered.filter((entry) => entry.name === project);
          if (matches.length !== 1) throw new TriggerError(matches.length === 0 ? `Unknown project "${project}"` : `Ambiguous project "${project}"; use its absolute path`, 400, "schedule.projects", parsed.projectsLine);
          path = matches[0]?.path ?? project;
        }
        try { cwds.push(await this.options.requireWorkspace(path)); }
        catch (error) { throw new TriggerError(error instanceof Error ? error.message : String(error), 400, "schedule.projects", parsed.projectsLine); }
      }
      parsed.input.action.targets = { kind: "projects", cwds: [...new Set(cwds)] };
    }
    return parsed;
  }
  async block(record: Pick<Trigger, "name" | "schedule" | "action" | "missedGraceMinutes" | "state">): Promise<WorkflowScheduleBlock> {
    if (record.action.thinkingLevel !== undefined && record.action.model === undefined) throw new TriggerError("Choose a model when setting a thinking level in a file schedule", 400, "action.thinkingLevel");
    const projects = await this.projectNames(record.action.targets);
    return { name: record.name, at: record.schedule.at, ...(record.schedule.kind === "weekly" ? { days: record.schedule.on } : {}), timezone: record.schedule.timezone, late: lateText(record.missedGraceMinutes), projects,
      ...(record.action.model === undefined ? {} : { model: `${record.action.model}${record.action.thinkingLevel === undefined ? "" : `:${record.action.thinkingLevel}`}` }),
      ...(record.state.kind === "paused" ? { paused: true } : {}), inputs: record.action.inputs };
  }
  async projectNames(targets: TriggerTargets): Promise<WorkflowScheduleBlock["projects"]> {
    const registered = await this.options.workspaces.registeredProjects?.() ?? [];
    return targets.kind === "all" ? "all" : targets.cwds.map((cwd) => {
      const project = registered.find((entry) => entry.path === cwd);
      return project !== undefined && registered.filter((entry) => entry.name === project.name).length === 1 ? project.name : cwd;
    });
  }
  async scan(created?: { id: string; creator: TriggerCreator }): Promise<void> {
    const before = JSON.stringify([...this.states]);
    const hashes = new Map<string, string>();
    const records = await this.options.store.list();
    const controls = await this.options.store.controls();
    this.skipped = new Set((await this.options.store.migration()).skipped);
    const names = new Set([...await this.options.files.names(), ...records.filter((record) => this.managed(record.id)).map((record) => record.id)]);
    for (const id of names) {
      if (!Check(TriggerIdSchema, id)) { this.options.onError(new TriggerError(`Cannot schedule workflow "${String(id)}": invalid trigger file name`)); continue; }
      if (!this.managed(id)) continue;
      const current = records.find((record) => record.id === id);
      const control = controls[id];
      const controlState = control === undefined ? undefined : current?.state.kind;
      let document;
      try { document = await this.options.files.document(id); }
      catch (error) {
        if (error instanceof TriggerError && error.status === 404) { await this.missing(id, current); continue; }
        this.invalid(id, error, current === undefined, controlState); continue;
      }
      hashes.set(id, document.sha256);
      await this.options.files.observe(id, document.text, "outside");
      let parsed;
      try {
        if (parseScheduledWorkflow(id, document.path, document.text, this.options.timezone) === undefined) { await this.missing(id, current); continue; }
        parsed = await this.validate(id, document.text);
      } catch (error) { this.invalid(id, error, current === undefined, controlState); continue; }
      const { input, block } = parsed;
      if (control !== undefined && !control.invalid && control.sha256 === document.sha256 && (block.paused === true) !== (current?.state.kind === "paused")) {
        this.invalid(id, new TriggerError("The schedule's paused flag could not be written."), false, controlState);
        continue;
      }
      if (control !== undefined) await this.options.store.clearControl(id);
      let record = current;
      if (record === undefined) record = await this.options.store.create(input, created?.id === id ? created.creator : undefined);
      else {
        const changes: TriggerUpdate = { baseRevision: record.revision };
        if (record.name !== input.name) changes.name = input.name;
        if (!isDeepStrictEqual(record.schedule, input.schedule)) changes.schedule = input.schedule;
        if (!isDeepStrictEqual(record.action, input.action)) changes.action = input.action;
        if (record.missedGraceMinutes !== input.missedGraceMinutes) changes.missedGraceMinutes = input.missedGraceMinutes ?? DEFAULT_MISSED_GRACE_MINUTES;
        // Pause first so an edit that pauses does not create a transient active generation.
        if (block.paused === true && record.state.kind === "active") { record = await this.options.store.pause(id); changes.baseRevision = record.revision; }
        if (Object.keys(changes).length > 1) {
          for (;;) {
            try { record = await this.options.store.update(id, changes); break; }
            catch (error) {
              if (!(error instanceof TriggerError) || error.status !== 409) throw error;
              // A fire can advance the display revision while a file scan awaits IO.
              // Retry only that optimistic conflict; the file queue already serializes settings edits.
              const latest = (await this.options.store.list()).find((entry) => entry.id === id);
              if (latest === undefined) throw error;
              changes.baseRevision = latest.revision;
            }
          }
        }
      }
      if (block.paused === true && record.state.kind === "active") await this.options.store.pause(id);
      else if (block.paused !== true && record.state.kind === "paused") await this.options.store.resume(id);
      const previous = this.states.get(id);
      // Do not publish a new timestamp every minute when the same valid bytes remain on disk.
      this.states.set(id, { path: document.path, status: "ok", lastGoodAt: previous?.status === "ok" && this.lastGoodHashes.get(id) === document.sha256 ? previous.lastGoodAt ?? this.options.now() : this.options.now() });
      this.lastGoodHashes.set(id, document.sha256);
    }
    this.syncedHashes = hashes;
    if (before !== JSON.stringify([...this.states])) this.options.publish();
  }
  private invalid(id: string, error: unknown, diagnose: boolean, controlled?: "paused" | "active"): void {
    const lastGoodAt = this.states.get(id)?.lastGoodAt;
    const note = controlled === undefined ? "" : controlled === "paused" ? " Paused in Forgerie until the file is fixed. The file was not rewritten and may still say active." : " Resumed with the last good settings until the file is fixed. The file was not rewritten and may still say paused.";
    this.states.set(id, { path: this.options.files.path(id), status: "invalid", problem: { message: `${error instanceof Error ? error.message : String(error)}${note}`, ...(error instanceof TriggerError && error.line !== undefined ? { line: error.line } : {}) }, ...(lastGoodAt === undefined ? {} : { lastGoodAt }) });
    // A newly invalid file has no stored record to carry its diagnostic yet.
    if (diagnose) this.options.onError(error);
  }
  private async missing(id: string, record?: Trigger): Promise<void> {
    if (record === undefined) { this.states.delete(id); return; }
    if (record.state.kind === "active") await this.options.store.pause(id);
    const lastGoodAt = this.states.get(id)?.lastGoodAt;
    this.states.set(id, { path: this.options.files.path(id), status: "missing", ...(lastGoodAt === undefined ? {} : { lastGoodAt }) });
  }
  private async migrate(): Promise<void> {
    const migration = await this.options.store.migration();
    this.skipped = new Set(migration.skipped);
    if (migration.done) return;
    for (const record of await this.options.store.list()) {
      if (migration.migrated.includes(record.id)) continue;
      let planned = migration.pending[record.id] !== undefined;
      try {
        const target = migration.pending[record.id] ?? record.action.workflow;
        const document = await this.options.files.document(target);
        const existing = parseScheduledWorkflow(target, document.path, document.text, this.options.timezone);
        if (existing !== undefined && migration.pending[record.id] === undefined) throw new TriggerError("The global workflow already has a schedule");
        let text = document.text;
        if (existing === undefined) {
          await this.options.requireGlobalWorkflow(record);
          text = editScheduleBlock(document.text, await this.block(record));
          await this.validate(target, text);
        }
        await this.options.store.plan(record.id, target);
        planned = true;
        if (existing === undefined) await this.options.files.save(target, { text, baseSha256: document.sha256 }, async (value) => { await this.validate(target, value); }, "migration");
        await this.options.store.rekey(record.id, target);
      } catch (error) {
        if (planned) throw error;
        this.skipped.add(record.id);
        this.options.onError(new Error(`Trigger "${record.id}" was not migrated: ${error instanceof Error ? error.message : String(error)}`));
      }
    }
    await this.options.store.finish([...this.skipped]);
  }
}
