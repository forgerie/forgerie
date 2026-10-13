import { realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness, type ConversationId } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { Check, Errors } from "typebox/value";
import type { TSchema, Static } from "typebox";
import { piWebDataDir } from "../../config.js";
import { parseTriggerSchedule } from "../../shared/triggerSchedules.js";
import { TRIGGER_LIST_HISTORY, TriggerCreateSchema, TriggerUpdateSchema, TriggerRunRequestSchema, type Trigger, type TriggerCreate, type TriggerUpdate, type TriggerWorkflow, type TriggerAction, type TriggerCreator, type TriggerListResponse, type TriggerRunResponse, type TriggerWorkflowsResponse } from "../../shared/triggers.js";
import { assertProseOnly, workflowInputs, type WorkflowLibrary } from "../resources/workflowLibrary.js";
import { acquireDurableOwnership, type DurableOwnership } from "../sessions/durableOwnership.js";
import type { ProjectWorkspaceCwds } from "../workspaces/projectWorkspaceCwds.js";
import { normalizeRequestCwd } from "../workingDirectory.js";
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

interface TriggerServiceOptions {
  env: Readonly<NodeJS.ProcessEnv>;
  workflows: WorkflowLibrary;
  workspaces: ProjectWorkspaceCwds;
  fire: FireTrigger;
  publish: () => void;
  onError: (error: unknown) => void;
  now?: () => number;
}
type TriggerStore = { kind: "open"; harness: Harness; anchor: ConversationId; ownership: DurableOwnership; unsubscribe: () => void } | { kind: "unavailable"; error: string };

/** Daemon-wide owner. All clients use this boundary, including agents. */
export class TriggerService {
  private store: TriggerStore = { kind: "unavailable", error: "Trigger store is not open" };
  private readonly core: ReturnType<typeof durableTriggers>;
  readonly timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  readonly timezones = [...new Set([...Intl.supportedValuesOf("timeZone"), "UTC"])].sort();
  private constructor(private readonly options: TriggerServiceOptions) {
    this.core = durableTriggers({ fire: async (request, signal) => {
      const cwd = await this.requireWorkspace(request.action.cwd);
      if (cwd !== request.action.cwd) throw new TriggerError("The saved workspace destination changed", 400, "action.cwd");
      return options.fire({ ...request, action: { ...request.action, cwd } }, signal);
    }, now: options.now ?? Date.now });
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
      const unsubscribe = harness.subscribeCommits((publication) => {
        if (publication.changes.some((change) => change.type === "document" && change.record.kind === TRIGGERS_DOC_KIND)) options.publish();
      });
      service.store = { kind: "open", harness, anchor, ownership, unsubscribe };
      harness.resume();
    } catch (error) {
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
    const store = this.store;
    this.store = { kind: "unavailable", error: "Trigger store is closed" };
    store.unsubscribe();
    try { await store.harness.close(context); } finally { await store.ownership.release(); }
  }
  async list(): Promise<TriggerListResponse> {
    const records = await listTriggers(this.opened().harness, context);
    return { triggers: records.map((record) => ({ ...record, history: record.history.slice(0, TRIGGER_LIST_HISTORY) })), attentionCount: records.filter((record) => record.attention !== null).length, timezone: this.timezone, timezones: this.timezones };
  }
  async get(id: string): Promise<Trigger> {
    const record = (await listTriggers(this.opened().harness, context)).find((record) => record.id === id);
    if (record === undefined) throw new TriggerError(`Trigger "${id}" does not exist.`, 404);
    return record;
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
    } catch (error) { throw new TriggerError(error instanceof Error ? error.message : String(error), 400, "action.cwd"); }
    const locator = this.options.workspaces;
    const paths = locator.canonicalForCwd === undefined ? await locator.forCwd(canonical) : await locator.canonicalForCwd(canonical);
    const canonicalPaths = await Promise.all((paths ?? []).map(async (path) => {
      try { const canonicalPath = await realpath(path); return (await stat(canonicalPath)).isDirectory() ? canonicalPath : undefined; }
      catch { return undefined; }
    }));
    if (!canonicalPaths.includes(canonical)) throw new TriggerError("Choose a workspace of a registered project", 400, "action.cwd");
    return canonical;
  }
  async validateAction(action: TriggerAction): Promise<TriggerAction> {
    action = { ...action, cwd: await this.requireWorkspace(action.cwd) };
    const workflow = await this.options.workflows.read(action.cwd, action.workflow).catch((error: unknown) => { throw new TriggerError(error instanceof Error ? error.message : String(error), 400, "action.workflow"); });
    try { assertProseOnly(workflow); } catch (error) { throw new TriggerError(error instanceof Error ? error.message : String(error), 400, "action.workflow"); }
    try { workflowInputs(workflow.definition, action.inputs); } catch (error) { throw new TriggerError(error instanceof Error ? error.message : String(error), 400, "action.inputs"); }
    return action;
  }
  async create(value: unknown, creator: TriggerCreator = { kind: "user" }): Promise<Trigger> {
    const { harness, anchor } = this.opened();
    const input: TriggerCreate = triggerBody(TriggerCreateSchema, value);
    if (input.name.trim() === "") throw new TriggerError("Give the trigger a name", 400, "name");
    this.schedule(input.schedule);
    const action = await this.validateAction(input.action);
    return this.core.create(harness, anchor, { ...input, action }, context, creator);
  }
  async update(id: string, value: unknown): Promise<Trigger> {
    const { harness, anchor } = this.opened();
    const input: TriggerUpdate = triggerBody(TriggerUpdateSchema, value);
    const current = await this.get(id);
    if (input.name?.trim() === "") throw new TriggerError("Give the trigger a name", 400, "name");
    if (input.schedule !== undefined) this.schedule(input.schedule);
    const action = await this.validateAction(input.action ?? current.action);
    return this.core.update(harness, anchor, id, { ...input, ...(input.action === undefined && action.cwd === current.action.cwd ? {} : { action }) }, context);
  }
  private schedule(value: unknown): void {
    try { parseTriggerSchedule(value); } catch (error) { throw new TriggerError(error instanceof Error ? error.message : String(error), 400, "schedule.timezone"); }
  }
  pause(id: string): Promise<Trigger> { return this.core.pause(this.opened().harness, id, context); }
  resume(id: string): Promise<Trigger> { const { harness, anchor } = this.opened(); return this.core.resume(harness, anchor, id, context); }
  acknowledge(id: string): Promise<Trigger> { return this.core.acknowledge(this.opened().harness, id, context); }
  remove(id: string): Promise<void> { return this.core.remove(this.opened().harness, id, context); }
  run(id: string, value: unknown): Promise<TriggerRunResponse> { const { harness, anchor } = this.opened(); const input = triggerBody(TriggerRunRequestSchema, value); return this.core.run(harness, anchor, id, input.requestId, context); }
}
