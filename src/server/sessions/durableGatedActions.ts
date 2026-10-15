import { decisionAnnotations, riskAnnotations } from "../decisions/optionalDecisionAnnotations.js";
import { launchRiskLabel, enabledRiskLabelSettings, type RiskLabelOptions } from "../decisions/riskLabels.js";
import type { Context, JsonValue } from "@earendil-works/chord";
import { AgentDoc, LiveDoc, ToolTask, UsageDoc, defineExtension, defineTask, hook, section, type JsonObject, type CommitPublication, type Conversation, type ConversationId, type Harness, type HookApi, type ToolDiagnostic, type ToolExecutionApi, type Tx, type TaskRuntime } from "@earendil-works/pi-durable";
import type { Usage } from "@earendil-works/pi-ai";
import { Check } from "typebox/value";
import { GatedActionSchema, GATED_ACTION_ENTRY_KIND, type GatedAction, type GatedActionEntry } from "../../shared/gatedActions.js";
import { defaultAutonomyPolicySource, type AutonomyPolicySource } from "../../shared/autonomyPolicy.js";
import { GATED_ACTIONS_DOC_KIND, Gates, type GateRecord } from "./durableGateRecords.js";
import { gatedAction, type GatedActionReads } from "./gatedActions.js";
import { durableJson } from "./durableJson.js";
import { deliverInputUntilPlaced, type InputPlacementState } from "./durableInputPlacement.js";
import { durableChildRunMetadata } from "./durableChildAgents.js";
import { logDecision } from "./durableDecisions.js";
import { WorkflowError } from "../resources/workflowLibrary.js";

export const GATED_ACTION_GUIDANCE = "Irreversible actions and actions outside the project in the user's name are gated. While approval waits, keep working on parts that do not depend on it. Do not retry the blocked call; its result will arrive as a message. Discarding files in a scratch clone under /tmp or in a child worktree is not gated: run the Git command from that tree, or name it with git -C <path>. A cd joined to the command with && or | still gates.";
/* eslint-disable @typescript-eslint/consistent-type-definitions */
type RunInput = { parent: ConversationId; id: string; cwd: string; nestedTools?: string };
type RunState = { phase: "ready" } | { phase: "unknown" };
/* eslint-enable @typescript-eslint/consistent-type-definitions */
export function gatedActionsChanged(publication: CommitPublication, parent: ConversationId): boolean {
  return publication.changes.some(change => change.type === "document" && change.conversationId === parent && change.record.kind === GATED_ACTIONS_DOC_KIND);
}
function publicGate(record: GateRecord): GatedAction {
  const plain: unknown = JSON.parse(JSON.stringify(record));
  if (!Check(GatedActionSchema, plain)) throw new Error("Invalid gated action record");
  return plain;
}
export async function gatedActions(harness: Harness, parent: ConversationId, context: Context): Promise<GatedAction[]> {
  const labels = riskAnnotations(harness, parent);
  return Object.values((await harness.snapshot(Gates, parent, context))?.records ?? {}).map(record => {
    const gate = publicGate(record);
    const label = labels.find(entry => entry.target === "gate" && entry.id === gate.id)?.label;
    return label === undefined ? gate : { ...gate, riskLabel: label };
  }).sort((a, b) => b.requestedAt - a.requestedAt || b.id.localeCompare(a.id));
}
export async function waitingGatedActions(harness: Harness, parent: ConversationId, context: Context): Promise<number> {
  return (await gatedActions(harness, parent, context)).filter(gate => gate.state.kind === "waiting").length;
}
async function recipient(tx: Tx, parent: ConversationId, original: ConversationId): Promise<ConversationId> {
  return original !== parent && await tx.conversation(original) !== undefined && (await tx.doc(LiveDoc, original)).run !== undefined ? original : parent;
}
const Delivery = defineTask<{ id: string; original: ConversationId; text: string }, InputPlacementState, null>({
  name: "forgerie.gated-action-delivery", version: 1, initial: () => ({phase: "deliver"}),
  phases: { deliver: (task, runtime, context) => deliverInputUntilPlaced(runtime, task.state.checkpoint, {
    requestId: `gate-result:${task.input.id}`, content: task.input.text, previousRecipient: task.input.original,
    selectRecipient: tx => recipient(tx, runtime.conversationId, task.input.original),
  }, context) },
  abort: (_task, runtime, context) => runtime.commit(() => ({status: "terminal", outcome: {status: "aborted"}}), context),
});
async function finish(tx: Tx, parent: ConversationId, id: string, state: GateRecord["state"]): Promise<void> {
  const gate = (await tx.doc(Gates, parent)).records[id];
  if (gate === undefined) throw new Error("Gated action disappeared");
  gate.state = state;
  const text = state.kind === "refused" ? `The user refused gate ${id}: ${gate.description}.`
    : state.kind === "failed" ? `Gate ${id} failed: ${state.error}` : state.kind === "ran" ? `Gate ${id} ran: ${gate.description}. Result: ${JSON.stringify(state.result)}` : "";
  await tx.createTask(Delivery, {id, original: gate.conversationId, text}, {conversationId: parent, ownership: {kind: "conversation"}, background: true});
}
const Run = defineTask<RunInput, RunState, null>({
  name: "forgerie.gated-action-run", version: 1, initial: () => ({phase: "ready"}),
  phases: {
    ready: async (task, runtime, context) => {
      const gate = (await runtime.snapshot(Gates, task.input.parent, context))?.records[task.input.id];
      if (gate?.state.kind !== "approved") throw new Error("Gated run has no approval");
      const agent = await runtime.agent(context);
      const tool = (task.input.nestedTools === undefined ? agent.tools : runtime.registry.extension(task.input.nestedTools)?.tools ?? []).find(candidate => candidate.name === gate.tool);
      // This intent commits BEFORE any non-idempotent effect. Only this invocation can execute it.
      // Restart enters unknown, including a crash immediately after this commit and before execute.
      await runtime.commit(() => ({status: "running", checkpoint: {phase: "unknown"}}), context);
      let state: GateRecord["state"];
      let usage: Usage | undefined;
      let output = "";
      const diagnostics: ToolDiagnostic[] = [];
      let details: JsonValue | undefined;
      try {
        if (tool === undefined) throw new Error(`Approved tool ${gate.tool} is no longer available`);
        if (agent.cwd !== task.input.cwd) throw new Error("The conversation cwd changed since this action was blocked; the action was not run");
        const api: ToolExecutionApi = {
          taskId: runtime.taskId, conversationId: runtime.conversationId, callId: `gate:${gate.id}`, registry: runtime.registry,
          agent: runtime.agent.bind(runtime), models: runtime.models, env: await runtime.env(context), outputWindow: undefined,
          output: chunk => { output = (output + (typeof chunk === "string" ? chunk : Buffer.from(chunk).toString())).slice(-65536); }, diagnostic: diagnostic => { diagnostics.push(diagnostic); },
          details: value => { details = value; return Promise.resolve(); }, snapshot: runtime.snapshot.bind(runtime), snapshotAsOf: runtime.snapshotAsOf.bind(runtime), watchDoc: runtime.watchDoc.bind(runtime),
          commit: (change, ctx) => commitValue(runtime, change, ctx),
          memo: runtime.memo.bind(runtime), getTask: runtime.getTask.bind(runtime), waitForTask: runtime.waitForTask.bind(runtime), conversation: runtime.conversation.bind(runtime),
          createTask: (definition, input, options, ctx) => commitValue(runtime, tx => tx.createTask(definition, input, options), ctx),
        };
        const result = await tool.execute(gate.args, api, context);
        const allDiagnostics = [...diagnostics, ...result.diagnostics ?? []];
        const saved = durableJson({...result, content: result.content ?? [{type: "text", text: output}], details: result.details ?? details, diagnostics: allDiagnostics});
        usage = result.usage;
        state = result.isError === true || allDiagnostics.some(diagnostic => diagnostic.severity === "error") ? {kind: "failed", error: JSON.stringify(saved), at: Date.now()} : {kind: "ran", result: saved, at: Date.now()};
      } catch (error) {
        if (runtime.signal.aborted) throw error;
        state = {kind: "failed", error: [error instanceof Error ? error.message : String(error), output].filter(text => text !== "").join("\n"), at: Date.now()};
      }
      await runtime.commit(async tx => { await finish(tx, task.input.parent, task.input.id, state); if (usage !== undefined) await recordToolUsage(tx, runtime.conversationId, gate.tool, usage); return {status: "terminal", outcome: {status: "completed", result: null}}; }, context);
    },
    unknown: (task, runtime, context) => runtime.commit(async tx => {
      await finish(tx, task.input.parent, task.input.id, {kind: "failed", error: "Unknown outcome: the approved action was interrupted and may have run. It will not be run again. Check its effects before requesting another action.", at: Date.now()});
      return {status: "terminal", outcome: {status: "completed", result: null}};
    }, context),
  },
  abort: (task, runtime, context) => runtime.commit(async tx => {
    await finish(tx, task.input.parent, task.input.id, {kind: "failed", error: "Unknown outcome: approved action stopped; it will not be run again.", at: Date.now()});
    return {status: "terminal", outcome: {status: "aborted"}};
  }, context),
});
export interface GatedActionsExtensionOptions {
  harness(): Harness;
  parent: ConversationId;
  reads: GatedActionReads;
  policy?: AutonomyPolicySource;
  riskLabels?: RiskLabelOptions;
  name?: string;
}
export function gatedActionsExtension(options: GatedActionsExtensionOptions) {
  const labels = options.riskLabels;
  if (labels !== undefined) decisionAnnotations(options.harness()).setRiskVisibility(() => enabledRiskLabelSettings(labels.hints) !== undefined);
  return defineExtension({name: options.name ?? "forgerie.gated-actions", tasks: [Run, Delivery], sections: [section("gated-actions", () => GATED_ACTION_GUIDANCE)], hooks: [hook(ToolTask, {
    beforeTool: async (call, api, context) => {
      const block = await gateToolCall(options, call, api, context);
      return block === undefined ? undefined : {block};
    },
  })]});
}
export interface NestedGateCall { index: number; cwd: string; extension: string }

/** The hook and SDK nested calls share admission, policy, identity, attribution and transcript receipts. */
export async function gateToolCall(options: GatedActionsExtensionOptions, call: {name: string; arguments: Record<string, unknown>},
  api: Pick<HookApi, "conversationId" | "taskId">, context: Context, nested?: NestedGateCall): Promise<string | undefined> {
  const id = `g:${String(api.conversationId)}:${String(api.taskId)}${nested === undefined ? "" : `:nested:${String(nested.index)}`}`;
  const harness = options.harness();
  if ((await harness.snapshot(Gates, options.parent, context))?.records[id] !== undefined) return blocked(id);
  const cwd = (await harness.snapshot(AgentDoc, api.conversationId, context))?.cwd ?? ".";
  // Shared SDK tools keep their owner's cwd even when the caller is a worktree child.
  const executionCwd = nested?.cwd ?? cwd;
  const found = await gatedAction(call.name, call.arguments, executionCwd, options.reads);
  if (found === undefined || !(await (options.policy ?? defaultAutonomyPolicySource).read(executionCwd)).gated[found.category]) return undefined;
  const childName = api.conversationId === options.parent ? undefined : Object.entries(await durableChildRunMetadata(harness, options.parent, context)).find(([, child]) => child.conversationId === api.conversationId)?.[0];
  const admitted = await harness.commit(async tx => {
    const doc = await tx.doc(Gates, options.parent);
    if (Object.hasOwn(doc.records, id)) return false;
    const by = api.conversationId === options.parent ? "parent" : `child ${childName ?? String(api.conversationId)}`;
    doc.records[id] = {id, conversationId: api.conversationId, by, tool: call.name, args: jsonArgs(call.arguments), ...found, requestedAt: Date.now(), state: {kind: "waiting"}};
    doc.cwd[id] = cwd;
    if (nested !== undefined) { doc.nestedTools ??= {}; doc.nestedTools[id] = nested.extension; }
    const entry: GatedActionEntry = {id, by, tool: call.name, ...found, command: preview(call.name, call.arguments)};
    await tx.appendEntry(options.parent, {kind: GATED_ACTION_ENTRY_KIND, data: durableJson(entry)});
    return true;
  }, context);
  if (admitted && options.riskLabels !== undefined) launchRiskLabel(options.riskLabels.hints,
    {tool: call.name, args: call.arguments, cwd: executionCwd, gate: found}, async label => {
      // Labels have no write access to the gate document or its harness.
      await decisionAnnotations(harness).write(String(options.parent), `gate:${id}`, durableJson({target: "gate", id, label}));
    }, options.riskLabels.onError);
  return blocked(id);
}
const blocked = (id: string) => `Blocked until the user approves (gate ${id}). Keep working on anything that does not depend on it; you will get the result as a message.`;
function preview(tool: string, args: Record<string, unknown>): string {
  const command = typeof args["command"] === "string" ? redactPreviewText(args["command"]) : `${tool} ${JSON.stringify(redactPreviewValue(args))}`;
  return command.slice(0, 4000);
}
function redactPreviewText(text: string): string {
  return text.replace(/(https?:\/\/)[^@\s/"']+@/giu, "$1[redacted]@")
    .replace(/(--(?:password|passwd|token|api[-_]?key|access[-_]?token|secret)(?:=|\s+))(?:'[^']*'|"[^"]*"|[^\s;|&]+)/giu, "$1[redacted]")
    .replace(/(Authorization:\s*)(?:(?:Bearer|Basic)\s+)?[^\s'";\\]+/giu, "$1[redacted]");
}
function redactPreviewValue(value: unknown): unknown {
  if (typeof value === "string") return redactPreviewText(value);
  if (Array.isArray(value)) return value.map(redactPreviewValue);
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
    /^(?:password|passwd|token|api[-_]?key|access[-_]?token|authorization|secret)$/iu.test(key) ? "[redacted]" : redactPreviewValue(entry)]));
  return value;
}
export async function decideGatedAction(harness: Harness, parent: Conversation, id: string, choice: "approved" | "refused", context: Context): Promise<GatedAction> {
  const record = await parent.commit(async tx => {
    const doc = await tx.doc(Gates, parent.id);
    const gate = Object.hasOwn(doc.records, id) ? doc.records[id] : undefined;
    if (gate === undefined) throw new WorkflowError(404, "Gated action not found in this session");
    if (gate.state.kind !== "waiting") throw new WorkflowError(409, "Gated action is not waiting");
    gate.state = {kind: choice};
    await logDecision(tx, parent.id, {id: `gate:${id}`, kind: "gated", by: "user", question: gate.description, choice, reason: `The user ${choice} this tool call`, flagged: false}, gate.conversationId);
    if (choice === "refused") await finish(tx, parent.id, id, {kind: "refused"});
    else await tx.createTask(Run, {parent: parent.id, id, cwd: doc.cwd[id] ?? ".", ...(doc.nestedTools?.[id] === undefined ? {} : {nestedTools: doc.nestedTools[id]})}, {conversationId: gate.conversationId, ownership: {kind: "conversation"}, background: true});
    return publicGate(gate);
  }, context);
  harness.resume();
  // Admission is durable. Do not keep the HTTP connection open for an arbitrary shell command.
  return record;
}

function jsonArgs(value: unknown): JsonObject {
  const json = durableJson(value);
  if (json === null || typeof json !== "object" || Array.isArray(json)) throw new Error("Tool arguments must be an object");
  return json;
}

async function commitValue<T>(runtime: TaskRuntime<RunInput, RunState, null, object>, change: (tx: Tx) => T | Promise<T>, context: Context): Promise<T> {
  const saved: {result?: {value: T}} = {};
  await runtime.commit(async tx => { saved.result = {value: await change(tx)}; return undefined; }, context);
  if (saved.result === undefined) throw new Error("Commit returned no result");
  return saved.result.value;
}

async function recordToolUsage(tx: Tx, conversation: ConversationId, tool: string, usage: Usage): Promise<void> {
  const ledger = await tx.doc(UsageDoc, conversation);
  const old = ledger.tools[tool];
  ledger.tools[tool] = {
    input: (old?.input ?? 0) + usage.input, output: (old?.output ?? 0) + usage.output,
    cacheRead: (old?.cacheRead ?? 0) + usage.cacheRead, cacheWrite: (old?.cacheWrite ?? 0) + usage.cacheWrite, totalTokens: (old?.totalTokens ?? 0) + usage.totalTokens,
    ...(usage.reasoning === undefined && old?.reasoning === undefined ? {} : {reasoning: (old?.reasoning ?? 0) + (usage.reasoning ?? 0)}),
    ...(usage.cacheWrite1h === undefined && old?.cacheWrite1h === undefined ? {} : {cacheWrite1h: (old?.cacheWrite1h ?? 0) + (usage.cacheWrite1h ?? 0)}),
    cost: {input: (old?.cost.input ?? 0) + usage.cost.input, output: (old?.cost.output ?? 0) + usage.cost.output,
      cacheRead: (old?.cost.cacheRead ?? 0) + usage.cost.cacheRead, cacheWrite: (old?.cost.cacheWrite ?? 0) + usage.cost.cacheWrite, total: (old?.cost.total ?? 0) + usage.cost.total},
  };
}
