import { realpath, stat } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness, type ConversationId } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { Check, Errors } from "typebox/value";
import type { TSchema, Static } from "typebox";
import { TriggerFileSaveRequestSchema, type TriggerFileSaveRequest } from "../../shared/triggerFiles.js";
import { TriggerFiles } from "./triggerFiles.js";
import { TriggerFileSync, type TriggerFileSyncRuntime } from "./triggerFileSync.js";
import { editScheduleBlock, parseScheduledWorkflow } from "./triggerFileFormat.js";
import { piWebDataDir } from "../../config.js";
import { parseTriggerSchedule } from "../../shared/triggerSchedules.js";
import { DEFAULT_MISSED_GRACE_MINUTES, TRIGGER_LIST_HISTORY, TriggerCreateSchema, TriggerUpdateSchema, TriggerRunRequestSchema, type Trigger, type TriggerFileSaved, type TriggerCreate, type TriggerUpdate, type TriggerWorkflow, type TriggerAction, type TriggerCreator, type TriggerListResponse, type TriggerRunResponse, type TriggerWorkflowsResponse, type TriggerTargets } from "../../shared/triggers.js";
import { assertProseOnly, workflowInputs, type WorkflowLibrary } from "../resources/workflowLibrary.js";
import { acquireDurableOwnership, type DurableOwnership } from "../sessions/durableOwnership.js";
import type { ProjectWorkspaceCwds } from "../workspaces/projectWorkspaceCwds.js";
import { normalizeRequestCwd } from "../workingDirectory.js";
import { TriggerUnavailableError } from "./triggerFire.js";
import { durableTriggers, listTriggers, TriggerError, TRIGGERS_DOC_KIND, type FireTrigger } from "./durableTriggers.js";

export function triggerBody<S extends TSchema>(schema: S, input: unknown): Static<S> {
  if (Check(schema, input)) return input;
  const errors = Errors(schema, input);
  // TypeBox reports every failed union branch. Do not blame fields that belong to a different discriminator.
  const rejectedBranches = errors.filter((error) => error.keyword === "const").flatMap((error) => {
    const branch = /^(.*\/anyOf\/[0-9]+)(?:\/|$)/u.exec(error.schemaPath)?.[1];
    return branch === undefined ? [] : [branch];
  });
  const first = errors.find((error) => error.keyword !== "anyOf" && !rejectedBranches.some((branch) => error.schemaPath === branch || error.schemaPath.startsWith(`${branch}/`))) ?? errors[0];
  const property = first?.keyword === "required" && first.params.requiredProperties.length === 1 ? first.params.requiredProperties[0]
    : first?.keyword === "additionalProperties" && first.params.additionalProperties.length === 1 ? first.params.additionalProperties[0] : undefined;
  const path = `${first?.instancePath ?? ""}${property === undefined ? "" : `/${property}`}`;
  const field = path.replace(/^\//u, "").replaceAll("/", ".");
  throw new TriggerError(first?.message ?? "Invalid trigger body", 400, field === "" ? undefined : field);
}

interface TriggerServiceDependencies {
  env: Readonly<NodeJS.ProcessEnv>;
  workflows: WorkflowLibrary;
  workspaces: ProjectWorkspaceCwds;
  publish: () => void;
  onError: (error: unknown) => void;
  now?: () => number;
  fileSync?: TriggerFileSyncRuntime;
}
type TriggerServiceOptions = TriggerServiceDependencies & (
  | { fire: FireTrigger; fireFactory?: never }
  | { fireFactory: (validateWorkspace: (cwd: string) => Promise<void>) => FireTrigger; fire?: never }
);
type TriggerStore = { kind: "open"; harness: Harness; anchor: ConversationId; ownership: DurableOwnership; unsubscribe: () => void } | { kind: "unavailable"; error: string };

/** Daemon-wide owner. All clients use this boundary, including agents. */
export class TriggerService {
  private store: TriggerStore = { kind: "unavailable", error: "Trigger store is not open" };
  private readonly core: ReturnType<typeof durableTriggers>;
  private readonly files: TriggerFiles;
  private readonly fileSync: TriggerFileSync;
  readonly timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  readonly timezones = [...new Set([...Intl.supportedValuesOf("timeZone"), "UTC"])].sort();
  private constructor(private readonly options: TriggerServiceOptions) {
    const validateWorkspace = async (cwd: string): Promise<void> => {
      const canonical = await this.requireWorkspace(cwd);
      if (canonical !== cwd) throw new TriggerError("The saved workspace destination changed", 400, "action.targets.cwds");
    };
    const configured = options.fireFactory === undefined ? options.fire : options.fireFactory(validateWorkspace);
    this.core = durableTriggers({ fire: async (request, signal) => {
      if (request.unavailableIsSkip === true) {
        try {
          await validateWorkspace(request.action.cwd);
          const workflow = await options.workflows.read(request.action.cwd, request.action.workflow);
          assertProseOnly(workflow);
          workflowInputs(workflow.definition, request.action.inputs);
        } catch (error) { throw new TriggerUnavailableError(error instanceof Error ? error.message : String(error)); }
      } else if (options.fireFactory === undefined) {
        await validateWorkspace(request.action.cwd);
        const workflow = await options.workflows.read(request.action.cwd, request.action.workflow);
        assertProseOnly(workflow);
        workflowInputs(workflow.definition, request.action.inputs);
      }
      return configured(request, signal);
    }, resolveProjects: (action) => this.targetCwds(action.targets), now: options.now ?? Date.now });
    this.files = new TriggerFiles(options.workflows.globalDirectory, join(piWebDataDir(options.env), "triggers", "versions"), this.timezone, options.now ?? Date.now);
    this.fileSync = new TriggerFileSync({ files: this.files, timezone: this.timezone, now: options.now ?? Date.now, workspaces: options.workspaces,
      requireWorkspace: (path) => this.requireWorkspace(path),
      requireGlobalWorkflow: async (record) => {
        for (const cwd of await this.targetCwds(record.action.targets)) {
          const workflow = await options.workflows.read(cwd, record.action.workflow);
          if (workflow.path !== this.files.path(record.action.workflow)) throw new TriggerError(`Workflow resolves to a project copy in ${cwd}, not the global file`);
        }
      }, publish: options.publish, onError: options.onError, ...(options.fileSync === undefined ? {} : { runtime: options.fileSync }),
      store: {
        list: () => listTriggers(this.opened().harness, context),
        create: (input, creator) => { const { harness, anchor } = this.opened(); return this.core.create(harness, anchor, input, context, creator); },
        update: (id, input) => { const { harness, anchor } = this.opened(); return this.core.update(harness, anchor, id, input, context); },
        pause: (id) => this.core.pause(this.opened().harness, id, context),
        resume: (id) => { const { harness, anchor } = this.opened(); return this.core.resume(harness, anchor, id, context); },
        migration: () => this.core.fileMigration(this.opened().harness, context),
        plan: (id, target) => this.core.planFileMigration(this.opened().harness, id, target, context),
        rekey: (id, target) => this.core.rekey(this.opened().harness, id, target, context),
        finish: (skipped) => this.core.finishFileMigration(this.opened().harness, skipped, context),
      },
    });
  }
  static async open(options: TriggerServiceOptions): Promise<TriggerService> {
    const service = new TriggerService(options);
    let ownership: DurableOwnership | undefined;
    let harness: Harness | undefined;
    try {
      ownership = await acquireDurableOwnership(join(piWebDataDir(options.env), "triggers", "state.sqlite"));
      const registry = createRegistry();
      registry.install(service.core.extension);
      harness = await Harness.open(await openNodeSqliteStorage(ownership.databasePath), { models: createModels(), registry, ...(options.now === undefined ? {} : { now: options.now }) }, context);
      const anchor = (await harness.root(context)).id;
      await service.core.initialize(harness, context);
      const unsubscribe = harness.subscribeCommits((publication) => {
        if (publication.changes.some((change) => change.type === "document" && change.record.kind === TRIGGERS_DOC_KIND)) options.publish();
      });
      service.store = { kind: "open", harness, anchor, ownership, unsubscribe };
      await service.fileSync.start();
      harness.resume();
    } catch (error) {
      await service.fileSync.close();
      await harness?.close(context);
      await ownership?.release();
      service.store = { kind: "unavailable", error: error instanceof Error ? error.message : String(error) };
      options.onError(error);
    }
    return service;
  }
  private opened() {
    if (this.store.kind !== "open") throw new TriggerError(this.store.error, 503);
    try { this.store.ownership.assertOwned(); } catch (error) { throw new TriggerError(error instanceof Error ? error.message : String(error), 503); }
    return this.store;
  }
  async close(): Promise<void> {
    if (this.store.kind !== "open") return;
    await this.fileSync.close();
    const store = this.store;
    this.store = { kind: "unavailable", error: "Trigger store is closed" };
    store.unsubscribe();
    try { await store.harness.close(context); } finally { await store.ownership.release(); }
  }
  private withFile(record: Trigger): Trigger {
    const file = this.fileSync.state(record.id);
    return file === undefined ? record : { ...record, file };
  }
  async syncFiles(): Promise<void> { this.opened(); await this.fileSync.transaction(() => this.fileSync.scan()); }
  async file(id: string) { await this.get(id); return this.files.document(id); }
  async saveFile(id: string, value: unknown): Promise<TriggerFileSaved> {
    const request: TriggerFileSaveRequest = triggerBody(TriggerFileSaveRequestSchema, value);
    return this.fileSync.transaction(async () => {
      await this.get(id);
      if (!this.fileSync.managed(id)) throw new TriggerError("This legacy trigger has no workflow schedule file", 400);
      let normalized = request;
      if (request.schedule !== undefined) {
        const parsed = await this.fileSync.validate(id, editScheduleBlock(request.text, request.schedule));
        normalized = { ...request, schedule: { ...request.schedule, projects: await this.fileSync.projectNames(parsed.input.action.targets) } };
      }
      const document = await this.files.save(id, normalized, async (text) => { await this.fileSync.validate(id, text); });
      await this.fileSync.scan();
      return { trigger: await this.get(id), document };
    });
  }
  async versions(id: string) { await this.get(id); return this.files.versions(id); }
  async version(id: string, versionId: string) { await this.get(id); return this.files.version(id, versionId); }
  async list(actorCwd?: string): Promise<TriggerListResponse> {
    const scope = await this.projectScope(actorCwd);
    const records =  (await listTriggers(this.opened().harness, context)).filter((record) => scope === undefined || this.inScope(record.action, scope));
    return { triggers: records.map((record) => ({ ...this.withFile(record), history: record.history.slice(0, TRIGGER_LIST_HISTORY) })), attentionCount: records.filter((record) => record.attention !== null || this.fileSync.state(record.id)?.status === "invalid").length, timezone: this.timezone, timezones: this.timezones };
  }
  async get(id: string, actorCwd?: string): Promise<Trigger> {
    const scope = await this.projectScope(actorCwd);
    const record = (await listTriggers(this.opened().harness, context)).find((record) => record.id === id);
    if (record === undefined) throw new TriggerError(`Trigger "${id}" does not exist.`, 404);
    if (scope !== undefined && !this.inScope(record.action, scope)) throw new TriggerError("Triggers are limited to the calling session's project", 400, "action.targets.cwds");
    return this.withFile(record);
  }
  async workflows(cwd: string): Promise<TriggerWorkflowsResponse> {
    this.opened();
    cwd = await this.requireWorkspace(cwd);
    const inventory = await this.options.workflows.list(cwd);
    return { diagnostics: inventory.diagnostics, workflows: inventory.workflows.map((workflow): TriggerWorkflow => {
      let kind: "prose" | "script" = "prose";
      try { assertProseOnly(workflow); } catch { kind = "script"; }
      return { name: workflow.name, ...(workflow.description === undefined ? {} : { description: workflow.description }), kind, inputs: workflow.definition.inputs ?? {}, hasLandStop: workflow.definition.stages?.some((stage) => stage.stop === "land") ?? false };
    }) };
  }
  async requireWorkspace(cwd: string): Promise<string> {
    let canonical: string;
    try {
      normalizeRequestCwd(cwd);
      canonical = await realpath(cwd);
      if (!(await stat(canonical)).isDirectory()) throw new Error("cwd must be an existing directory");
    } catch (error) { throw new TriggerError(error instanceof Error ? error.message : String(error), 400, "action.targets.cwds"); }
    const locator = this.options.workspaces;
    const paths = locator.canonicalForCwd === undefined ? await locator.forCwd(canonical) : await locator.canonicalForCwd(canonical);
    const canonicalPaths = await Promise.all((paths ?? []).map(async (path) => {
      try { const canonicalPath = await realpath(path); return (await stat(canonicalPath)).isDirectory() ? canonicalPath : undefined; }
      catch { return undefined; }
    }));
    if (!canonicalPaths.includes(canonical)) throw new TriggerError("Choose a workspace of a registered project", 400, "action.targets.cwds");
    return canonical;
  }
  private assertAgentTargets(action: TriggerAction, scope?: string[]): void {
    if (scope !== undefined && (action.targets.kind !== "projects" || action.targets.cwds.length !== 1)) throw new TriggerError("Triggers are limited to the calling session's project", 400, "action.targets");
  }
  private inScope(action: TriggerAction, scope: string[]): boolean {
    return action.targets.kind === "projects" && action.targets.cwds.length === 1 && scope.includes(action.targets.cwds[0] ?? "");
  }
  private async targetCwds(targets: TriggerTargets): Promise<string[]> {
    if (targets.kind === "projects") return [...targets.cwds];
    if (this.options.workspaces.registeredCwds === undefined) throw new TriggerError("Registered project inventory is unavailable", 503);
    return this.options.workspaces.registeredCwds();
  }
  async commonWorkflows(targets: TriggerTargets): Promise<TriggerWorkflowsResponse> {
    this.opened();
    const selected = await this.targetCwds(targets);
    const cwds = targets.kind === "projects" ? [...new Set(await Promise.all(selected.map((cwd) => this.requireWorkspace(cwd))))] : selected;
    const inventories = await Promise.all(cwds.map(async (cwd) => {
      try { return { cwd, inventory: await this.options.workflows.list(await this.requireWorkspace(cwd)) }; }
      catch (error) { return { cwd, inventory: { workflows: [], diagnostics: [{ name: "", path: cwd, error: error instanceof Error ? error.message : String(error) }] } }; }
    }));
    const diagnostics: TriggerWorkflowsResponse["diagnostics"] = inventories.flatMap(({ cwd, inventory }) => inventory.diagnostics.map((problem) => ({ ...problem, reason: "unreadable" as const, cwds: [cwd] })));
    const names = [...new Set(inventories.flatMap(({ inventory }) => inventory.workflows.map((workflow) => workflow.name)))].sort();
    const workflows: TriggerWorkflow[] = [];
    for (const name of names) {
      const resolved = inventories.map(({ cwd, inventory }) => ({ cwd, workflow: inventory.workflows.find((workflow) => workflow.name === name), unreadable: inventory.diagnostics.some((problem) => problem.name === name || problem.name === "") }));
      const reference = resolved.find(({ workflow }) => workflow !== undefined);
      const first = reference?.workflow;
      let common = first !== undefined;
      for (const { cwd, workflow, unreadable } of resolved) {
        let error: string | undefined;
        let reason: NonNullable<TriggerWorkflowsResponse["diagnostics"][number]["reason"]> = "missing";
        let diagnosticCwds = [cwd];
        if (workflow === undefined && unreadable) { common = false; continue; }
        if (workflow === undefined) error = `Workflow is unavailable in ${cwd}`;
        else {
          try { assertProseOnly(workflow); } catch { error = `Workflow must resolve to prose in ${cwd}`; reason = "script"; }
          if (error === undefined && reference?.workflow !== undefined && !isDeepStrictEqual(reference.workflow.definition.inputs ?? {}, workflow.definition.inputs ?? {})) {
            error = `Workflow input declarations differ between ${reference.cwd} and ${cwd}`;
            reason = "inputs-differ";
            diagnosticCwds = [reference.cwd, cwd];
          }
        }
        if (error !== undefined) { diagnostics.push({ name, path: workflow?.path ?? cwd, error, reason, cwds: diagnosticCwds }); common = false; }
      }
      if (common && first !== undefined) workflows.push({ name, ...(first.description === undefined ? {} : { description: first.description }), kind: "prose", inputs: first.definition.inputs ?? {}, hasLandStop: resolved.every(({ workflow }) => workflow?.definition.stages?.some((stage) => stage.stop === "land") === true) });
    }
    return { workflows, diagnostics };
  }
  async validateAction(action: TriggerAction): Promise<TriggerAction> {
    if (action.targets.kind === "projects") {
      const cwds = [...new Set(await Promise.all(action.targets.cwds.map((cwd) => this.requireWorkspace(cwd))))];
      action = { ...action, targets: { kind: "projects", cwds } };
    }
    const inventory = await this.commonWorkflows(action.targets);
    const workflow = inventory.workflows.find((workflow) => workflow.name === action.workflow);
    if (workflow === undefined) throw new TriggerError(inventory.diagnostics.find((problem) => problem.name === action.workflow)?.error ?? "Choose a prose workflow common to every target project", 400, "action.workflow");
    let inputs = action.inputs;
    for (const cwd of await this.targetCwds(action.targets)) {
      const resolved = await this.options.workflows.read(cwd, action.workflow);
      try { inputs = workflowInputs(resolved.definition, action.inputs); } catch (error) { throw new TriggerError(error instanceof Error ? error.message : String(error), 400, "action.inputs"); }
    }
    return { ...action, inputs };
  }
  private async projectScope(actorCwd?: string): Promise<string[] | undefined> {
    if (actorCwd === undefined) return undefined;
    const canonical = await this.requireWorkspace(actorCwd);
    const locator = this.options.workspaces;
    const paths = locator.canonicalForCwd === undefined ? await locator.forCwd(canonical) : await locator.canonicalForCwd(canonical);
    if (paths === undefined) throw new TriggerError("The calling session's project is no longer registered", 400, "action.targets.cwds");
    return Promise.all(paths.map((path) => this.requireWorkspace(path)));
  }
  async create(value: unknown, creator: TriggerCreator = { kind: "user" }, actorCwd?: string): Promise<Trigger> {
    this.opened();
    const input: TriggerCreate = triggerBody(TriggerCreateSchema, value);
    if (input.name.trim() === "") throw new TriggerError("Give the trigger a name", 400, "name");
    this.schedule(input.schedule);
    const scope = await this.projectScope(actorCwd);
    this.assertAgentTargets(input.action, scope);
    const action = await this.validateAction(input.action);
    if (scope !== undefined && !this.inScope(action, scope)) throw new TriggerError("Triggers are limited to the calling session's project", 400, "action.targets");
    return this.fileSync.transaction(async () => {
      const id = action.workflow;
      let document;
      try { document = await this.files.document(id); }
      catch (error) { if (error instanceof TriggerError && error.status === 404) throw new TriggerError(`Create needs a global workflow file named "${id}" with no schedule yet`, 400, "action.workflow"); throw error; }
      if (parseScheduledWorkflow(id, document.path, document.text, this.timezone) !== undefined) throw new TriggerError(`Global workflow "${id}" already has a schedule`, 400, "action.workflow");
      const block = await this.fileSync.block({ ...input, action: { ...action, inputs: input.action.inputs }, missedGraceMinutes: input.missedGraceMinutes ?? DEFAULT_MISSED_GRACE_MINUTES, state: { kind: "active", nextFireAt: 0 } });
      await this.files.save(id, { text: document.text, baseSha256: document.sha256, schedule: block }, async (text) => { await this.fileSync.validate(id, text); });
      await this.fileSync.scan({ id, creator });
      return this.get(id, actorCwd);
    });
  }
  async update(id: string, value: unknown, actorCwd?: string): Promise<Trigger> {
    const { harness, anchor } = this.opened();
    const input: TriggerUpdate = triggerBody(TriggerUpdateSchema, value);
    const current = await this.get(id, actorCwd);
    if (input.name?.trim() === "") throw new TriggerError("Give the trigger a name", 400, "name");
    if (input.schedule !== undefined) this.schedule(input.schedule);
    const scope = await this.projectScope(actorCwd);
    this.assertAgentTargets(input.action ?? current.action, scope);
    const action = await this.validateAction(input.action ?? current.action);
    if (scope !== undefined && !this.inScope(action, scope)) throw new TriggerError("Triggers are limited to the calling session's project", 400, "action.targets");
    if (!this.fileSync.managed(id)) return this.core.update(harness, anchor, id, { ...input, action }, context, scope);
    if (action.workflow !== id) throw new TriggerError("A file-backed trigger cannot change its workflow name", 400, "action.workflow");
    return this.fileSync.transaction(async () => {
      await this.fileSync.scan();
      const latest = await this.get(id, actorCwd);
      if (latest.revision !== input.baseRevision) throw new TriggerError(`Trigger revision is ${String(latest.revision)}; read it again before editing.`, 409, "baseRevision");
      const document = await this.files.document(id);
      const block = await this.fileSync.block({ ...latest, ...input, action: { ...action, inputs: input.action?.inputs ?? document.schedule?.inputs ?? {} } });
      await this.files.save(id, { text: document.text, baseSha256: document.sha256, schedule: block }, async (text) => { await this.fileSync.validate(id, text); });
      await this.fileSync.scan();
      return this.get(id, actorCwd);
    });
  }
  private schedule(value: unknown): void {
    try { parseTriggerSchedule(value); } catch (error) { throw new TriggerError(error instanceof Error ? error.message : String(error), 400, "schedule.timezone"); }
  }
  private async setPaused(id: string, paused: boolean, actorCwd?: string): Promise<Trigger> {
    const current = await this.get(id, actorCwd);
    if (!this.fileSync.managed(id)) {
      const { harness, anchor } = this.opened();
      return paused ? this.core.pause(harness, id, context, await this.projectScope(actorCwd)) : this.core.resume(harness, anchor, id, context, await this.projectScope(actorCwd));
    }
    return this.fileSync.transaction(async () => {
      await this.fileSync.scan();
      await this.get(id, actorCwd);
      const document = await this.files.document(id);
      const existing = document.schedule;
      const block = existing ?? await this.fileSync.block(current);
      await this.files.save(id, { text: document.text, baseSha256: document.sha256, schedule: { ...block, paused } }, async (text) => { await this.fileSync.validate(id, text); });
      await this.fileSync.scan();
      return this.get(id, actorCwd);
    });
  }
  async pause(id: string, actorCwd?: string): Promise<Trigger> { return this.setPaused(id, true, actorCwd); }
  async resume(id: string, actorCwd?: string): Promise<Trigger> { return this.setPaused(id, false, actorCwd); }
  async acknowledge(id: string, actorCwd?: string): Promise<Trigger> { await this.core.acknowledge(this.opened().harness, id, context, await this.projectScope(actorCwd)); return this.get(id, actorCwd); }
  async remove(id: string, actorCwd?: string): Promise<void> {
    await this.fileSync.transaction(async () => {
      await this.fileSync.scan();
      await this.get(id, actorCwd);
      if (this.fileSync.managed(id)) {
        try {
          const document = await this.files.document(id);
          await this.files.save(id, { text: editScheduleBlock(document.text, null), baseSha256: document.sha256 }, () => Promise.resolve());
        } catch (error) { if (!(error instanceof TriggerError && error.status === 404)) throw error; }
      }
      await this.core.remove(this.opened().harness, id, context, await this.projectScope(actorCwd));
      await this.fileSync.scan();
    });
  }
  async run(id: string, value: unknown, actorCwd?: string): Promise<TriggerRunResponse> {
    const { harness, anchor } = this.opened();
    const input = triggerBody(TriggerRunRequestSchema, value);
    const record = await this.get(id, actorCwd);
    let cwd: string | undefined;
    if (input.cwd !== undefined) {
      try {
        normalizeRequestCwd(input.cwd);
        const saved = record.action.targets.kind === "projects" ? record.action.targets.cwds : await this.targetCwds(record.action.targets);
        cwd = saved.includes(input.cwd) ? input.cwd : await this.requireWorkspace(input.cwd);
      }
      catch (error) { throw new TriggerError(error instanceof Error ? error.message : String(error), 400, "cwd"); }
      if (record.action.targets.kind === "projects" && !record.action.targets.cwds.includes(cwd)) throw new TriggerError("Choose one of the trigger's target projects", 400, "cwd");
    }
    return this.core.run(harness, anchor, id, input.requestId, context, await this.projectScope(actorCwd), cwd);
  }
}
