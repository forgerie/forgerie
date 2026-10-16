import { readToolRiskIdentity } from "./toolRiskIdentity.js";
import { withRiskAnnotations, withToolInvocationIds } from "../decisions/optionalDecisionAnnotations.js";
import { RISK_LABEL_ENTRY_KIND, RiskLabelEntrySchema, type RiskLabelEntry } from "../../shared/riskLabels.js";
import { launchRiskLabel, enabledRiskLabelSettings } from "../decisions/riskLabels.js";
/**
 * Durable-native child agents inside a Forgerie session.
 *
 * A child is an ordinary Durable conversation in the parent session's own storage. A background anchor task of the
 * parent conversation owns it, so the parent's Esc does not reach it, and its work survives a restart with the parent's
 * storage. A child asks its parent first. Only irreversible or external escalations wait on the user.
 *
 * Pattern from pi-durable test/examples/23-subagent-background.ts. Findings: prototypes/durable-child-spike/README.md.
 */
import { setTimeout as sleep } from "node:timers/promises";
import type { Context } from "@earendil-works/chord";
import { Type, type AssistantMessage, type Message } from "@earendil-works/pi-ai";
import {
  AgentDoc, AssistantEntry, CompactionTask, GenerationTask, LiveDoc, configure, defineDoc, defineExtension, defineTask, defineTool, hook, section, wrapTool,
  type Conversation, type ConversationId, type EntryId, type Extension, type Harness, type TaskGraph, type TaskId,
  type ToolRegistration, type Tx, type Storage, type EntryRecord, type Cursor,
} from "@earendil-works/pi-durable";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { Check } from "typebox/value";
import { Type as Schema } from "typebox";
import { parseModelReference, type ThinkingLevel } from "../../shared/thinkingLevels.js";
import { ChildRetrySchema, type ChildRetry } from "../../shared/childRetry.js";
import type { DurableSdkTools, DurableSdkToolsOptions } from "./durableSdkTools.js";
import type { ChildAgentCatalog, ChildAgentProfile } from "./durableChildProfiles.js";
import type { DurableChildSummary } from "../../shared/childAgents.js";
import type { WorktreeActionResult, WorktreeDiscardPreview } from "../../shared/sessionWorktree.js";
import type { DurableChildWorktrees } from "./durableChildWorktrees.js";
import { planChildRuntime, runtimeGaps, childIsWriter, missingToolsRefusal, type ChildRuntimePlan, type ChildSkill } from "./durableChildRuntime.js";
import { readsImages, watchdogDiffTool } from "./durableChildTools.js";
import { associateWorkflowChild, settleWorkflowChild, deliveredWorkflowChild, undeliveredWorkflowChild, workflowChildRefusal, workflowWorkerModel } from "./durableWorkflowRuns.js";
import { deliverInputUntilPlaced, type InputPlacementState } from "./durableInputPlacement.js";
import { logDecision } from "./durableDecisions.js";
import { WorkflowError } from "../resources/workflowLibrary.js";
import { readChildActivity, readStoredChildActivity } from "./durableChildActivity.js";
import { readChildDocument } from "./durableChildStorageReads.js";

export const CHILD_TOOL_NAME = "child_agent";
export const CHILD_QUESTION_KIND = "forgerie.child-question";
export const CHILD_ANSWER_KIND = "forgerie.child-answer";
/** The user steered or stopped a child from its view. The parent model sees it, so it does not undo the user. */
export const CHILD_NOTE_KIND = "forgerie.child-note";
const CHILD_ENTRY_KINDS = new Set([CHILD_QUESTION_KIND, CHILD_ANSWER_KIND, CHILD_NOTE_KIND]);
export const isChildEntryKind = (kind: string): boolean => CHILD_ENTRY_KINDS.has(kind);

// defineDoc needs JSON-compatible type aliases; interfaces lack the index signature.
/* eslint-disable @typescript-eslint/consistent-type-definitions */
type ChildRecord = { conversationId: ConversationId; reported: EntryId[]; agent: string | null; createdAt: number; worktreeId?: string; agentFile?: { path: string; sha256: string } };
type QuestionRouting = { kind: "parent" } | { kind: "user"; escalation: "irreversible" | "external"; guess: string; why: string }
  | { kind: "answered"; by: "parent" | "user"; provisional: boolean };
// No routing field means a user-facing question created before parent-first routing.
type ChildQuestion = { child: ConversationId; childName: string; question: string; answer: string | null; askedAt: number; closed?: boolean; routing?: QuestionRouting; resolvedBy?: string };
type ReporterInput = { name: string; conversationId: ConversationId; message: string; followUp: boolean; worktreeId?: string; workflowSend?: boolean };
type ReporterState = { phase: "deliver"; attempt?: number; error?: string } | { phase: "retry"; attempt: number; error: string; until: number; run?: string }
  | { phase: "observe"; run: string; owner: TaskId } | { phase: "report"; report?: string; suppressed?: "duplicate" | "aborted" };
type ChildRetryOwner = { owner: TaskId; conversationId: ConversationId; requestId: string };
/* eslint-enable @typescript-eslint/consistent-type-definitions */

export const CHILD_AGENTS_DOC_KIND = "forgerie.durable-children";
const Children = defineDoc<{ agents: Record<string, ChildRecord>; reporters: Record<string, TaskId>;
  failureRuns?: Record<string, string>; retryOwners?: Record<string, ChildRetryOwner>;
  continuations?: Record<string, { from: number; text: string; conversationId: number }> }>({
  kind: CHILD_AGENTS_DOC_KIND, version: 1, scope: "conversation", history: "latest", fork: "initial",
  initial: () => ({ agents: {}, reporters: {} }),
});
export const CHILD_QUESTIONS_DOC_KIND = "forgerie.child-questions";
const Questions = defineDoc<{ items: Record<string, ChildQuestion> }>({
  kind: CHILD_QUESTIONS_DOC_KIND, version: 1, scope: "conversation", history: "latest", fork: "initial",
  initial: () => ({ items: {} }),
});

const textOf = (message: AssistantMessage | undefined): string =>
  (message?.content ?? []).flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");

const isAssistant = (message: unknown): message is AssistantMessage =>
  typeof message === "object" && message !== null && "role" in message && message.role === "assistant";

const Anchor = defineTask<null, { phase: "done" }, null>({
  name: "forgerie.child-anchor", version: 1, initial: () => ({ phase: "done" }),
  phases: { done: (_task, runtime, context) => runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), context) },
  abort: (_task, runtime, context) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});

const CHILD_RETRY_DELAYS = [30_000, 120_000, 300_000] as const;

// Do not treat credentials, quota, billing or context limits as temporary transport failures.
const TRANSIENT_CHILD_ERROR = /overloaded|\b5\d{2}\b|auth_unavailable|server[ _-]?busy|high demand|at capacity|rate[ _-]?limit|too many requests|\b429\b|service[ _-]?unavailable|(?:internal|server)[ _-]?error|websocket.*(?:closed|error)|stream.*(?:disconnect|ended|closed)|connection.*(?:reset|closed|lost|refused)|socket hang up|fetch failed|network.*error|timed? out|timeout|EAI_AGAIN|ECONNRESET|upstream.*(?:connect|error)/i;
const PERMANENT_CHILD_ERROR = /invalid.*(?:api[ _-]?key|credentials)|insufficient_quota|quota exceeded|billing|out of budget|usage limit reached|context.*(?:window|limit)|too many tokens/i;
function transientChildError(detail: string): boolean {
  return !PERMANENT_CHILD_ERROR.test(detail) && TRANSIENT_CHILD_ERROR.test(detail);
}

/**
 * Workflow declaration > requested > agent file > the session's. Null is the user's choice of the default: the agent
 * file's model, and the agent's request is ignored. A thinking suffix overrides agent-file thinking.
 */
function workflowWorkerModelChoice(declared: string | null | undefined, requested?: string, profile?: Pick<ChildAgentProfile, "model" | "thinkingLevel">): {
  spec: string | undefined; choice: { model: { provider: string; modelId: string } | undefined; thinkingLevel: ThinkingLevel | undefined } | null;
} {
  if (declared === null) return { spec: undefined, choice: { model: profile?.model, thinkingLevel: profile?.thinkingLevel } };
  const spec = declared ?? requested;
  const parsed = spec === undefined ? undefined : modelChoice(spec);
  return { spec, choice: parsed === null ? null : {
    model: parsed?.model ?? profile?.model,
    thinkingLevel: parsed?.thinkingLevel ?? profile?.thinkingLevel,
  } };
}

/** Apply a declared model only between turns. The caller may wait, or keep a user steer in the current turn. */
async function applyWorkflowWorkerModel(tx: Tx, parentId: ConversationId, childId: ConversationId, name: string, catalog?: ChildAgentCatalog): Promise<TaskId | undefined> {
  const declared = await workflowWorkerModel(tx, parentId, name);
  if (declared === undefined) return undefined;
  const record = (await tx.doc(Children, parentId)).agents[name];
  const profile = record?.agent == null ? undefined : await catalog?.find(record.agent);
  const { choice } = workflowWorkerModelChoice(declared, undefined, profile);
  if (choice === null) throw new WorkflowError(400, `Invalid workflow model for ${name}: ${declared ?? "default"}`);
  const parent = await tx.doc(AgentDoc, parentId);
  const model = choice.model ?? parent.model;
  const thinkingLevel = choice.thinkingLevel ?? parent.thinkingLevel ?? "off";
  const configured = await tx.doc(AgentDoc, childId);
  if (configured.model?.provider === model?.provider && configured.model?.modelId === model?.modelId && (configured.thinkingLevel ?? "off") === thinkingLevel) return undefined;
  const busy = (await tx.doc(LiveDoc, childId)).run?.taskId;
  if (busy !== undefined) return busy;
  await configure(tx, childId, { model: model ?? null, thinkingLevel });
  return undefined;
}

const REPORTER_KIND = "forgerie.child-reporter";
function childReporter(resolve: (conversationId: ConversationId, context: Context) => Promise<DurableChildExtensionOptions>) {
  return defineTask<ReporterInput, ReporterState, null>({
  name: REPORTER_KIND, version: 1, initial: () => ({ phase: "deliver" }),
  phases: {
    deliver: async (reporter, runtime, context) => {
      const { name, conversationId, message, followUp } = reporter.input;
      const child = await runtime.conversation(conversationId, context);
      if (child === undefined) throw new Error(`Child conversation ${String(conversationId)} is missing`);
      const attempt = reporter.state.checkpoint.attempt ?? 0;
      const content = attempt === 0 ? message : `Continue where you stopped; the last request failed with: ${reporter.state.checkpoint.error ?? "model_error"}`;
      if (reporter.input.workflowSend === true && attempt === 0) {
        const selected = await resolve(runtime.conversationId, context);
        // A model switch must not affect later tool rounds of an already running turn. Wait for that turn,
        // then resolve the current declaration again: the user can edit it while delivery is waiting.
        for (;;) {
          let busy: TaskId | undefined;
          await runtime.commit(async (tx) => {
            if (await tx.submissionByRequest(conversationId, `child:${String(reporter.id)}`) !== undefined) return;
            busy = await applyWorkflowWorkerModel(tx, runtime.conversationId, conversationId, name, selected.catalog);
          }, context);
          if (busy === undefined) break;
          await runtime.waitForTask(busy, context);
        }
      }
      const submission = await child.submit({ type: "input", content, whenBusy: attempt > 0 || followUp ? "followUp" : "steer",
        requestId: attempt === 0 ? `child:${String(reporter.id)}` : `child:${String(reporter.id)}:retry:${String(attempt)}` }, context);
      const selected = await resolve(runtime.conversationId, context);
      await selected.flushRunRecords?.();
      const settled = await submission.wait(context);
      const detail = settled.status === "unanswered" && settled.detail !== undefined ? (typeof settled.detail === "string" ? settled.detail : JSON.stringify(settled.detail)) : undefined;
      const delay = CHILD_RETRY_DELAYS[attempt];
      if (settled.status === "unanswered" && settled.reason === "model_error") {
        const progress = { delegated: false };
        await runtime.commit(async (tx) => {
          const doc = await tx.doc(Children, runtime.conversationId);
          const run = doc.failureRuns?.[String(settled.id)] ?? `input:${String(settled.id)}`;
          const claim = doc.retryOwners?.[run];
          if (claim !== undefined && claim.owner !== reporter.id) {
            progress.delegated = true;
            return { status: "running", checkpoint: { phase: "observe", run, owner: claim.owner } };
          }
          if (claim === undefined) doc.retryOwners = { ...doc.retryOwners, [run]: { owner: reporter.id, conversationId, requestId: `child:${String(reporter.id)}` } };
          if (detail !== undefined && transientChildError(detail) && delay !== undefined) {
            progress.delegated = true;
            return { status: "running", checkpoint: { phase: "retry", attempt: attempt + 1, error: detail, until: runtime.now() + delay, run } };
          }
          return undefined;
        }, context);
        if (progress.delegated) return;
      }
      // Ancillary accounting/reporting must not replace the child's durable submission outcome.
      await runtime.commit(async (tx) => { await settleWorkflowChild(tx, runtime.conversationId, reporter.id, settled); }, context);
      const worktreeReport = settled.status !== "unanswered" && reporter.input.worktreeId !== undefined
        ? await requireWorktrees(selected.worktrees).report(reporter.input.worktreeId) : undefined;
      await runtime.commit(async (tx) => {
        const next = (report?: string, suppressed: "duplicate" | "aborted" = "aborted"): { status: "running"; checkpoint: ReporterState } => ({ status: "running", checkpoint: report === undefined ? { phase: "report", suppressed } : { phase: "report", report } });
        if (settled.status === "unanswered") {
          return next(settled.reason === "aborted" ? undefined : `[subagent ${name} failed: ${settled.reason}${detail === undefined ? "" : `: ${detail}`}]`);
        }
        if (settled.type !== "input") return next();
        const agent = (await tx.doc(Children, runtime.conversationId)).agents[name];
        const answer = (await tx.entry(AssistantEntry, settled.answer))?.model?.[0];
        if (agent === undefined || agent.reported.includes(settled.answer)) return next(undefined, agent?.reported.includes(settled.answer) === true ? "duplicate" : "aborted");
        agent.reported.push(settled.answer);
        return next(`[subagent ${name} answered, no reply needed] ${textOf(isAssistant(answer) ? answer : undefined)}${worktreeReport === undefined ? "" : `\n\n${worktreeReport}`}`);
      }, context);
    },
    retry: async (reporter, runtime, context) => {
      const { attempt, error, until, run } = reporter.state.checkpoint;
      await runtime.sleep(until, context);
      await runtime.commit(async (tx) => {
        const claim = run === undefined ? undefined : (await tx.doc(Children, runtime.conversationId)).retryOwners?.[run];
        // Publish the next receipt before admission. A steer joining that retry inherits this owner and budget.
        if (claim !== undefined) claim.requestId = `child:${String(reporter.id)}:retry:${String(attempt)}`;
        return { status: "running", checkpoint: { phase: "deliver", attempt, error } };
      }, context);
    },
    observe: async (reporter, runtime, context) => {
      const { run, owner } = reporter.state.checkpoint;
      const finished = await runtime.waitForTask(owner, context);
      // Returning with the same checkpoint faults the task. Keep waiting in this invocation until it can advance.
      for (;;) {
        const progress = { pending: false };
        await runtime.commit(async (tx) => {
          const claim = (await tx.doc(Children, runtime.conversationId)).retryOwners?.[run];
          const submission = claim === undefined ? undefined : await tx.submissionByRequest(claim.conversationId, claim.requestId);
          const accepted = await tx.submissionByRequest(runtime.conversationId, `child-report:${String(owner)}`);
          if (accepted === undefined && finished.state.outcome.status === "aborted") {
            await undeliveredWorkflowChild(tx, runtime.conversationId, reporter.id, "aborted");
            return { status: "terminal", outcome: { status: "completed", result: null } };
          }
          // An ancillary reporter failure need not have stopped its admitted child input.
          if (submission?.status === "queued" || submission?.status === "placed") { progress.pending = true; return undefined; }
          if (submission !== undefined) await settleWorkflowChild(tx, runtime.conversationId, reporter.id, submission);
          return { status: "running", checkpoint: { phase: "report", suppressed: accepted === undefined ? "aborted" : "duplicate" } };
        }, context);
        if (!progress.pending) return;
        await runtime.sleep(runtime.now() + 250, context);
      }
    },
    report: async (reporter, runtime, context) => {
      const checkpoint = reporter.state.checkpoint;
      const report = "report" in checkpoint ? checkpoint.report : undefined;
      if (report !== undefined) {
        const main = await runtime.conversation(runtime.conversationId, context);
        if (main === undefined) throw new Error("Child report parent is missing");
        await main.submit({ type: "input", content: report, whenBusy: "followUp", requestId: `child-report:${String(reporter.id)}` }, context);
      }
      await runtime.commit(async (tx) => {
        if (report === undefined) await undeliveredWorkflowChild(tx, runtime.conversationId, reporter.id, checkpoint.suppressed ?? "aborted");
        else await deliveredWorkflowChild(tx, runtime.conversationId, reporter.id);
        return { status: "terminal", outcome: { status: "completed", result: null } };
      }, context);
    },
  },
  abort: (task, runtime, context) => runtime.commit(async (tx) => {
    const accepted = await tx.submissionByRequest(runtime.conversationId, `child-report:${String(task.id)}`);
    // Preserve an answer already committed before Stop. Backoff cancellation itself settles as stopped.
    if (task.state.checkpoint.phase === "deliver") {
      const attempt = task.state.checkpoint.attempt ?? 0;
      const submission = await tx.submissionByRequest(task.input.conversationId, attempt === 0 ? `child:${String(task.id)}` : `child:${String(task.id)}:retry:${String(attempt)}`);
      if (submission !== undefined && submission.status !== "queued" && submission.status !== "placed") await settleWorkflowChild(tx, runtime.conversationId, task.id, submission);
    }
    if (accepted !== undefined) await deliveredWorkflowChild(tx, runtime.conversationId, task.id);
    else await undeliveredWorkflowChild(tx, runtime.conversationId, task.id, "aborted");
    for (const question of Object.values((await tx.doc(Questions, runtime.conversationId)).items)) {
      if (question.child === task.input.conversationId && question.answer === null) question.closed = true;
    }
    return { status: "terminal", outcome: { status: "aborted" } };
  }, context),
  });
}

interface CommitApi { conversationId: ConversationId; commit<T>(change: (tx: Tx) => T | Promise<T>, context: Context): Promise<T> }

async function parentOf(api: CommitApi, context: Context): Promise<ConversationId> {
  const parent = await api.commit(async (tx) => (await tx.conversation(api.conversationId))?.owner?.conversationId, context);
  if (parent === undefined) throw new Error("This conversation has no parent to ask");
  return parent;
}

/** Saving the question and outbox is atomic. Queued questions stay pending until placement, including across aborts. */
const QuestionDelivery = defineTask<{ questionId: string; text: string }, InputPlacementState, null>({
  name: "forgerie.child-question-delivery", version: 1, initial: () => ({ phase: "deliver" }),
  phases: { deliver: async (task, runtime, context) => {
    const question = (await runtime.snapshot(Questions, runtime.conversationId, context))?.items[task.input.questionId];
    if (question?.closed === true || question?.answer !== null) {
      await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), context);
      return;
    }
    await deliverInputUntilPlaced(runtime, task.state.checkpoint, { requestId: `child-question:${task.input.questionId}`, content: task.input.text,
      previousRecipient: runtime.conversationId, selectRecipient: () => Promise.resolve(runtime.conversationId) }, context);
  } },
  abort: (_task, runtime, context) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});

/** ask_human retains its agent-file name, but asks the parent first. */
const askHumanTool = defineTool({
  name: "ask_human",
  description: "Ask your parent agent one question and wait for its answer. Use it only when blocked and you cannot decide from your task, code or docs. The parent answers or escalates under the autonomy policy.",
  parameters: Type.Object({ question: Type.String({ minLength: 1, maxLength: 65536 }) }, { additionalProperties: false }),
  replay: "safe",
  execute: async (args, api, context) => {
    if (args.question.trim() === "") return { content: [{ type: "text" as const, text: "A nonblank question is required" }], isError: true };
    const parentId = await parentOf(api, context);
    const questionId = `q:${String(api.taskId)}`;
    await api.commit(async (tx) => {
      const doc = await tx.doc(Questions, parentId);
      if (doc.items[questionId] !== undefined) return;
      const agents = (await tx.doc(Children, parentId)).agents;
      const childName = Object.entries(agents).find(([, agent]) => agent.conversationId === api.conversationId)?.[0] ?? "child";
      doc.items[questionId] = { child: api.conversationId, childName, question: args.question, answer: null, askedAt: Date.now(), routing: { kind: "parent" } };
      await tx.createTask(QuestionDelivery, { questionId, text: `[child ${childName} asks ${questionId}] ${args.question}` }, { conversationId: parentId, ownership: { kind: "conversation" }, background: true });
    }, context);
    for (;;) {
      const item = (await api.snapshot(Questions, parentId, context))?.items[questionId];
      if (typeof item?.answer === "string") {
        const routing = item.routing;
        const prefix = routing?.kind === "answered" && routing.provisional ? "Provisional answer from the parent, which the user may overturn: "
          : routing?.kind === "answered" && routing.by === "parent" ? "The parent answered: " : "The user answered: ";
        return { content: [{ type: "text" as const, text: `${prefix}${item.answer}` }] };
      }
      if (item?.closed === true) return { content: [{ type: "text" as const, text: "This question was closed without an answer." }], isError: true };
      await sleep(250, undefined, { signal: context.abortSignal });
    }
  },
});

const codingTools: readonly ToolRegistration[] = CodingTools.tools ?? [];
const readTool = codingTools.find((tool) => tool.name === "read");
const bashTool = codingTools.find(tool => tool.name === "bash");

/** The tools a child gets: every child tool, or the ones its agent file names as `planChildRuntime` translates them. */
function childToolsFor(plan: ChildRuntimePlan, extra: readonly ToolRegistration[], shared: readonly ToolRegistration[]): ToolRegistration[] {
  const native = [askHumanTool, ...codingTools, watchdogDiffTool, ...extra];
  return plan.tools === undefined ? [...native, ...shared.filter(tool => tool.name === "process")] : [...native, ...shared].filter((tool) => plan.tools?.includes(tool.name) === true);
}

export interface DurableChildExtensions {
  /** Installed and selected for the parent. */
  parent: readonly Extension[];
  /** Installed for task definitions and children; removed from the parent's selection. */
  childOnly: readonly Extension[];
  /** Rebuild declarations from the live session registry after extension tool registration. */
  refresh(): DurableChildExtensions;
}

export interface DurableChildExtensionOptions {
  /** Agent files a spawn may name. Without one, every child is a general helper. */
  catalog?: ChildAgentCatalog;
  /** Names and descriptions shown in the tool description; resolved when the session opens. */
  agents?: readonly Pick<ChildAgentProfile, "name" | "description">[];
  /** The project's AGENTS.md text, for children whose agent file inherits project context. */
  projectContext?: string;
  /** Skills the parent session sees; an agent file's `skills` resolve against them. */
  sessionSkills?: readonly ChildSkill[];
  /** Extra tools every child may use. Tests pass a deterministic one. */
  extraTools?: readonly ToolRegistration[];
  /** A getter because reload replaces the parent's tool registry. */
  sessionTools?: () => DurableSdkTools;
  riskLabels?: DurableSdkToolsOptions["riskLabels"];
  childToolsDeny?: readonly string[];
  worktrees?: DurableChildWorktrees;
  flushRunRecords?: () => Promise<void>;
  /** Built-in hooks are read-only; the owning host supplies its Durable mutation line for shared retry receipts. */
  commit?: (change: (tx: Tx) => Promise<void>, context: Context) => Promise<void>;
  /** Composition resolves the owning adapter for tools, reporter tasks, and child hooks. */
  resolveOptions?: (conversationId: ConversationId, context: Context) => Promise<DurableChildExtensionOptions>;
}

const extensionOptions = new WeakMap<DurableChildExtensions, DurableChildExtensionOptions>();
export function routeDurableChildExtensions(source: DurableChildExtensions, resolve: (conversationId: ConversationId, context: Context) => Promise<DurableChildExtensions>): DurableChildExtensions {
  const options = extensionOptions.get(source);
  if (options === undefined) return source;
  return durableChildExtensions({ ...options, resolveOptions: async (id, ctx) => {
    const selected = extensionOptions.get(await resolve(id, ctx));
    if (selected === undefined) throw new Error("Child owner has no extension configuration");
    return selected;
  } });
}

export function durableChildExtensions(options: DurableChildExtensionOptions = {}): DurableChildExtensions {
  const extraTools = options.extraTools ?? [];
  const resolve = (id: ConversationId, context: Context) => options.resolveOptions?.(id, context) ?? Promise.resolve(options);
  const sessionTools = options.sessionTools;
  const sharedTools = sessionTools === undefined ? [] : sessionTools().childTools(sessionTools, options.childToolsDeny ?? []);
  // A spawn may name only shared tools this extension declared, as the selected parent currently offers them.
  const availableNames = (selected: DurableChildExtensionOptions) => {
    const current = selected.sessionTools === undefined ? [] : selected.sessionTools().childTools(selected.sessionTools, selected.childToolsDeny ?? []);
    return [...(selected.extraTools ?? []).map((tool) => tool.name), ...current.filter((tool) => sharedTools.some((installed) => installed.name === tool.name)).map((tool) => tool.name)];
  };
  const Reporter = childReporter(resolve);
  const ChildTools = defineExtension({
    name: "forgerie.child-tools",
    // Save the accounting boundary before any generation or compaction can spend money.
    hooks: [
      hook(GenerationTask, {
        beforeRequest: async (_request, api, ctx) => { await (await resolve(api.conversationId, ctx)).flushRunRecords?.(); return undefined; },
        afterResponse: async (message, api, ctx) => {
          if (message.stopReason !== "error") return;
          // Submission IDs differ for spawn and steer, but Durable settles all inputs of one failed generation together.
          const selected = await resolve(api.conversationId, ctx);
          await selected.commit?.(async (tx) => {
            const parent = (await tx.conversation(api.conversationId))?.owner?.conversationId;
            if (parent === undefined) return;
            const live = (await tx.doc(LiveDoc, api.conversationId)).run;
            if (live?.taskId !== api.taskId) return;
            const inputs = live.inputs;
            const doc = await tx.doc(Children, parent);
            let run = `generation:${String(api.taskId)}`;
            for (const [key, claim] of Object.entries(doc.retryOwners ?? {})) {
              if (claim.conversationId !== api.conversationId) continue;
              const retry = await tx.submissionByRequest(api.conversationId, claim.requestId);
              if (retry !== undefined && inputs.includes(retry.id)) { run = key; break; }
            }
            doc.failureRuns = { ...doc.failureRuns, ...Object.fromEntries(inputs.map((id) => [String(id), run])) };
          }, ctx);
        },
      }),
      hook(CompactionTask, { beforeCompact: async (_request, api, ctx) => { await (await resolve(api.conversationId, ctx)).flushRunRecords?.(); return undefined; } }),
    ],
    tools: [askHumanTool, ...codingTools, watchdogDiffTool, ...extraTools, ...sharedTools],
    wraps: [...(readTool === undefined ? [] : [readsImages(readTool)]),
      ...(bashTool === undefined || options.riskLabels === undefined ? [] : [wrapTool(bashTool, tool => ({...tool,
        execute: (args, api, context) => {
          // Owner resolution and the ask are detached too. Preserve the native tool's result,
          // errors, abort signal and replay declaration without inserting an awaited hook.
          void Promise.resolve().then(async () => {
            const labels = (await resolve(api.conversationId, context)).riskLabels;
            if (labels === undefined || enabledRiskLabelSettings(labels.hints) === undefined) return;
            const identity = await readToolRiskIdentity(api, context);
            launchRiskLabel(labels.hints, {tool: "bash", args, cwd: api.env?.cwd ?? "."},
              label => identity === undefined ? undefined : labels.record(api.conversationId, api.callId, label, identity), labels.onError);
          }).catch((error: unknown) => { options.riskLabels?.onError(error); });
          return tool.execute(args, api, context);
        },
      }))])],
    sections: [section("environment", (input) => input.env === undefined ? undefined : `Working directory: ${input.env.cwd}`)],
  });
  const agentList = (options.agents ?? []).map((agent) => `- ${agent.name}: ${agent.description}`).join("\n");
  const childTool = defineTool({
    name: CHILD_TOOL_NAME,
    description: [
      "Run a background child agent in this session. Actions: spawn (name, message, optional agent and isolation), send (name, message), answer (name, questionId, answer, reason), escalate (questionId, kind, guess, why).",
      "Writers (write, edit, or bash) and general helpers default to isolation: worktree. Read-only agents default to shared. Explicit isolation wins; two live shared writers in the same directory are refused.",
      "A child works on its own; its answer is reported back to you as a new message when it arrives. Do not wait or poll.",
      "A child asks you first. Answer from the task, contract, code, docs and chat. Escalate only irreversible actions, actions outside the project in the user's name, contradicting what the user said or approved, or questions you cannot answer anywhere. Taste and scope are decisions, not escalations.",
      "irreversible/external wait for the user. contradicts/stuck give your best guess at once, marked provisional in the decision log. Do not wait or poll. The user can open, steer and stop children. Several spawns in one reply run in parallel.",
      ...(agentList === "" ? [] : [`Agents (pass one as \`agent\`; omit for a general helper):\n${agentList}`]),
    ].join("\n"),
    parameters: Type.Union([
      Type.Object({
        action: Type.Union([Type.Literal("spawn"), Type.Literal("send")]),
        name: Type.String({ description: "Short unique name for this child, such as ui or api." }),
        message: Type.String({ description: "The full task. The child does not see this conversation." }),
        agent: Type.Optional(Type.String({ description: "Agent file name for spawn." })),
        isolation: Type.Optional(Type.Union([Type.Literal("shared"), Type.Literal("worktree")], { description: "Working directory for spawn. Default worktree for writers and general helpers, shared for read-only agents." })),
        allowMissingTools: Type.Optional(Type.Boolean({ description: "Spawn despite unavailable tools named by the agent file. Default false." })),
        model: Type.Optional(Type.String({ description: "Model for spawn as provider/model-id, optionally with :thinking-level. Omit it: the child then runs on its agent file's model. Set it only when the user asks for a model, or after the agent file's model failed. It overrides the agent file." })),
      }),
      Type.Object({ action: Type.Literal("answer"), name: Type.String({ minLength: 1 }), questionId: Type.String({ minLength: 1 }), answer: Type.String({ minLength: 1, maxLength: 65536 }), reason: Type.String({ minLength: 1, maxLength: 65536 }) }, { additionalProperties: false }),
      Type.Object({ action: Type.Literal("escalate"), questionId: Type.String({ minLength: 1 }), kind: Type.Union([Type.Literal("irreversible"), Type.Literal("external"), Type.Literal("contradicts"), Type.Literal("stuck")]), guess: Type.String({ minLength: 1, maxLength: 65536 }), why: Type.String({ minLength: 1, maxLength: 65536 }) }, { additionalProperties: false }),
    ]),
    // Tool calls serialize name allocation. Children themselves remain parallel background conversations.
    executionMode: "sequential",
    // One task-keyed reporter receipt covers spawn/send; isolated worktrees use the same task key.
    replay: "safe",
    execute: async (args, api, context) => {
      if (args.action === "answer" || args.action === "escalate") {
        try {
          const result = await api.commit((tx) => resolveChildQuestion(tx, api.conversationId, args, String(api.taskId)), context);
          return { content: [{ type: "text" as const, text: result }] };
        } catch (error) {
          if (!(error instanceof WorkflowError)) throw error;
          return { content: [{ type: "text" as const, text: error.message }], isError: true };
        }
      }
      const selected = await resolve(api.conversationId, context);
      const extraTools = selected.extraTools ?? [];
      const agentList = (selected.agents ?? []).map((agent) => `- ${agent.name}: ${agent.description}`).join("\n");
      return withChildAdmission(selected.worktrees, async () => {
        const { action, name, message } = args;
        const before = await api.snapshot(Children, api.conversationId, context);
        const existing = before !== undefined && Object.hasOwn(before.agents, name) ? before.agents[name] : undefined;
        if (before?.reporters[String(api.taskId)] !== undefined) {
          return { content: [{ type: "text" as const, text: action === "spawn" ? `Started ${name}.` : `Sent to ${name}.` }],
            ...(existing === undefined ? {} : { details: { name, conversationId: Number(existing.conversationId) } }) };
        }
        if (action === "spawn" && existing !== undefined) return { content: [{ type: "text" as const, text: `${name} already exists; use send.` }] };
        if (action === "send" && existing === undefined) return { content: [{ type: "text" as const, text: `No child named ${name}.` }] };
        // A workflow stop holds work that belongs after it. Ask before preparing a worktree, and again in the commit.
        const held = await api.commit((tx) => workflowChildRefusal(tx, api.conversationId, name), context);
        if (held !== undefined) return { content: [{ type: "text" as const, text: held }], isError: true };
        // A model the workflow declares for this worker is the user's choice: it wins over the agent's argument.
        const declared = action === "spawn" ? await api.commit((tx) => workflowWorkerModel(tx, api.conversationId, name), context) : undefined;
        const { spec, choice } = workflowWorkerModelChoice(declared, action === "spawn" ? args.model : undefined);
        if (choice === null) return { content: [{ type: "text" as const, text: `Write model as provider/model-id, optionally with :thinking-level. Got ${spec ?? ""}${declared === undefined ? "" : " from the workflow file"}.` }], isError: true };
        if (existing?.worktreeId !== undefined) await requireWorktrees(selected.worktrees).assertWritable(existing.worktreeId);
        const profile = action === "spawn" && args.agent !== undefined ? await selected.catalog?.find(args.agent) : undefined;
        if (action === "spawn" && args.agent !== undefined && profile === undefined) {
          return { content: [{ type: "text" as const, text: `No agent named ${args.agent}.${agentList === "" ? "" : ` Choose one of:\n${agentList}`}` }], isError: true };
        }
        // A send re-reads the child's agent file, so a child spawned under an older runtime or file gets the current one.
        const sentProfile = action === "send" && existing?.agent != null ? await selected.catalog?.find(existing.agent) : undefined;
        const refresh = action === "send" && (existing?.agent == null || sentProfile !== undefined);
        const runtime = action === "spawn" || refresh
          ? planChildRuntime(action === "spawn" ? profile : sentProfile, availableNames(selected), selected.sessionSkills ?? []) : undefined;
        if (action === "spawn" && runtime !== undefined && runtime.unavailable.length > 0 && args.allowMissingTools !== true) {
          const refusal = missingToolsRefusal(runtime, await selected.catalog?.list() ?? []);
          if (refusal !== undefined) return { content: [{ type: "text" as const, text: refusal }], isError: true };
        }
        const writer = childIsWriter(runtime?.tools);
        const isolation = args.isolation ?? (writer ? "worktree" : "shared");
        if (action === "spawn" && isolation === "shared" && writer) {
          const refusal = await api.commit((tx) => sharedWriterRefusal(tx, api.conversationId), context);
          if (refusal !== undefined) return { content: [{ type: "text" as const, text: refusal }], isError: true };
        }
        if (action === "spawn" && isolation === "worktree" && selected.worktrees === undefined) {
          return { content: [{ type: "text" as const, text: "Child worktree isolation is not available in this session. Use a Git repository with worktree support, or explicitly choose isolation: shared." }], isError: true };
        }
        const checkout = action === "spawn" && isolation === "worktree"
          ? await requireWorktrees(selected.worktrees).prepare(String(api.taskId)) : undefined;
        const result = await api.commit(async (tx) => {
          const refusal = await workflowChildRefusal(tx, api.conversationId, name);
          if (refusal !== undefined) return refusal;
          const state = await tx.doc(Children, api.conversationId);
          const parentAgent = await tx.doc(AgentDoc, api.conversationId);
          const parentNames = Array.isArray(parentAgent.extensions) ? parentAgent.extensions : parentAgent.extensions?.add ?? [];
          const gateNames = parentNames.filter(name => name.startsWith("forgerie.gated-actions"));
          const background = { ownership: { kind: "conversation" }, background: true } as const;
          if (action === "spawn") {
            if (Object.hasOwn(state.agents, name)) return `${name} already exists; use send.`;
            const anchor = await tx.createTask(Anchor, null, background);
            const child = await tx.createConversation({ ownership: { kind: "task", taskId: anchor } });
            // Re-read in the allocation commit, so a route edit during worktree preparation wins too.
            const current = await workflowWorkerModel(tx, api.conversationId, name);
            const { spec, choice } = workflowWorkerModelChoice(current, args.model, profile);
            if (choice === null) throw new WorkflowError(400, `Invalid workflow model for ${name}: ${spec ?? ""}`);
            const chosenModel = choice.model;
            const chosenThinking = choice.thinkingLevel;
            const plan = runtime ?? planChildRuntime(profile, availableNames(selected), []);
            await configure(tx, child.id, {
              ...(checkout === undefined ? {} : { cwd: checkout.path }),
              extensions: [ChildTools],
              tools: childToolsFor(plan, extraTools, sharedTools),
              ...(chosenModel === undefined ? {} : { model: chosenModel }),
              ...(chosenThinking === undefined ? {} : { thinkingLevel: chosenThinking }),
              instructions: childInstructions(name, profile, plan, selected.projectContext),
            });
            (await tx.doc(AgentDoc, child.id)).extensions = [ChildTools.name, ...gateNames];
            state.agents[name] = { conversationId: child.id, reported: [], agent: profile?.name ?? null, createdAt: Date.now(),
              ...(profile === undefined ? {} : { agentFile: profile.source }),
              ...(checkout === undefined ? {} : { worktreeId: checkout.id }) };
          } else if (!Object.hasOwn(state.agents, name)) return `No child named ${name}.`;
          const agent = state.agents[name];
          if (agent === undefined) return `No child named ${name}.`;
          if (refresh && runtime !== undefined) {
            // Tools, skills, and instructions follow the current runtime and agent file. The reporter applies
            // workflow model changes before delivery, after any running turn has settled.
            await configure(tx, agent.conversationId, { extensions: [ChildTools], tools: childToolsFor(runtime, extraTools, sharedTools),
              instructions: childInstructions(name, sentProfile, runtime, selected.projectContext) });
            (await tx.doc(AgentDoc, agent.conversationId)).extensions = [ChildTools.name, ...gateNames];
            if (sentProfile !== undefined) agent.agentFile = sentProfile.source;
          }
          const reporter = await tx.createTask(Reporter, { name, conversationId: agent.conversationId, message, followUp: false, ...(action === "send" ? { workflowSend: true } : {}), ...(agent.worktreeId === undefined ? {} : { worktreeId: agent.worktreeId }) }, background);
          state.reporters[String(api.taskId)] = reporter;
          await associateWorkflowChild(tx, api.conversationId, agent.conversationId, reporter, name);
          if (action === "send") return refresh ? `Sent to ${name}.` : `Sent to ${name}. Its agent file ${String(agent.agent)} is gone, so it keeps the tools it was started with.`;
          return `Started ${name}${profile === undefined ? "" : ` (${profile.name})`}.${runtime === undefined ? "" : runtimeGaps(runtime)}`;
        }, context);
        const current = (await api.snapshot(Children, api.conversationId, context))?.agents[name];
        return { content: [{ type: "text" as const, text: result }], ...(current === undefined ? {} : { details: { name, conversationId: Number(current.conversationId) } }) };
      });
    },
  });
  const extensions = {
    parent: [defineExtension({ name: "forgerie.child-agents", tasks: [Anchor, Reporter, QuestionDelivery], tools: [childTool] })],
    childOnly: [ChildTools],
    refresh: () => durableChildExtensions(options),
  };
  extensionOptions.set(extensions, options);
  return extensions;
}

/**
 * provider/model-id with an optional :thinking-level, as agent files write it. Null when it cannot be read.
 * A colon that is not a thinking level belongs to the model id (local/qwen:32b). The workflow routes check
 * their own model fields strictly; this reader stays as lenient as every other spawn needs.
 */
export function modelChoice(spec: string): { model: { provider: string; modelId: string }; thinkingLevel?: ThinkingLevel } | null {
  const { model: id, thinkingLevel: level } = parseModelReference(spec);
  const slash = id.indexOf("/");
  if (slash <= 0 || slash === id.length - 1) return null;
  return { model: { provider: id.slice(0, slash), modelId: id.slice(slash + 1) }, ...(level === undefined ? {} : { thinkingLevel: level }) };
}

/**
 * How a child checks its work. Over 10-12 to 10-15, workflow builders ran the full suite 377 times (18 hours), up to
 * 27 times each, mostly to confirm small fixes. The parent now places one full run per stage.
 */
export const CHILD_CHECKS = "Check your work with focused checks: the tests for the files you changed (for example the project's related or changed-tests command), the typecheck and the linter. Do not run the project's full test suite or full verification unless your task tells you to; the parent runs it once on the combined work. If you think the change needs it, say so in your report. Report each check you ran and its result.";

/** A child's instructions: its agent file's prompt, its role, how this runtime differs, and the project's context. */
function childInstructions(name: string, profile: ChildAgentProfile | undefined, plan: ChildRuntimePlan, projectContext: string | undefined): string {
  const project = profile?.inheritProjectContext !== false && projectContext !== undefined && projectContext !== ""
    ? `\n\n<project_context>\n${projectContext}\n</project_context>` : "";
  return `${profile?.prompt ?? "You are a helper agent. Do the task you are given, then reply with a short result."}\n\nYou are the child agent "${name}" of a parent agent. Your final reply goes back to the parent. Use ask_human only when you are blocked; it asks your parent, not the user.\nDo not file issues. Suggest issues in your report; the parent files them.\n${CHILD_CHECKS}${plan.section === "" ? "" : `\n\n${plan.section}`}${project}`;
}

function withChildAdmission<T>(worktrees: DurableChildWorktrees | undefined, operation: () => Promise<T>): Promise<T> {
  return worktrees === undefined ? operation() : worktrees.exclusive(operation);
}

function requireWorktrees(worktrees: DurableChildWorktrees | undefined): DurableChildWorktrees {
  if (worktrees === undefined) throw new Error("Child worktree isolation is not available in this session");
  return worktrees;
}

export function workingChildCount(graph: TaskGraph, parent: ConversationId, family: ReadonlySet<ConversationId>): number {
  return new Set(Object.values(graph.tasks).filter((task) => task.conversationId !== parent && family.has(task.conversationId)).map((task) => task.conversationId)).size;
}

/** Whether any child work is still live: a child's own task, or a reporter that has not delivered yet. */
export function childWorkIsLive(graph: TaskGraph, parent: ConversationId, family: ReadonlySet<ConversationId>): boolean {
  return Object.values(graph.tasks).some((task) => family.has(task.conversationId) && (task.kind === REPORTER_KIND || task.conversationId !== parent));
}

// ─── Host operations: what Forgerie's server and UI call. No model turn in any of them. ───

/** Questions children asked that the user has not answered and that no stop closed. */
export async function openChildQuestions(harness: Harness, parent: ConversationId, context: Context): Promise<number> {
  const items = Object.values((await harness.snapshot(Questions, parent, context))?.items ?? {});
  return items.filter((question) => question.answer === null && question.closed !== true && (question.routing === undefined || question.routing.kind === "user")).length;
}

/** Frozen launch provenance for the disk run-history projection, not a browser summary. */
export async function durableChildRunMetadata(harness: Harness, parent: ConversationId, context: Context) {
  return (await harness.snapshot(Children, parent, context))?.agents ?? {};
}

export async function listChildren(harness: Harness, parent: ConversationId, context: Context, worktrees?: DurableChildWorktrees): Promise<DurableChildSummary[]> {
  return childRows(await harness.snapshot(Children, parent, context), await harness.snapshot(Questions, parent, context), {
    task: id => harness.getTask(id, context),
    busy: async id => (await harness.snapshot(LiveDoc, id, context))?.run !== undefined,
    activity: id => readChildActivity(harness, id, context),
  }, worktrees);
}

interface ChildRowsState { agents: Record<string, Pick<ChildRecord, "conversationId" | "agent" | "createdAt" | "worktreeId">>; reporters: Record<string, TaskId> }
const childRowsSchema = Schema.Unsafe<ChildRowsState>(Schema.Object({
  agents: Schema.Record(Schema.String(), Schema.Object({ conversationId: Schema.Integer({ minimum: 1 }), agent: Schema.Union([Schema.String(), Schema.Null()]), createdAt: Schema.Number(), worktreeId: Schema.Optional(Schema.String()) })),
  reporters: Schema.Record(Schema.String(), Schema.Integer({ minimum: 1 })),
}));
const questionRowsSchema = Schema.Unsafe<{ items: Record<string, ChildQuestion> }>(Schema.Object({ items: Schema.Record(Schema.String(), Schema.Object({
  child: Schema.Integer({ minimum: 1 }), childName: Schema.String(), question: Schema.String(), answer: Schema.Union([Schema.String(), Schema.Null()]), askedAt: Schema.Number(), closed: Schema.Optional(Schema.Boolean()),
  routing: Schema.Optional(Schema.Union([
    Schema.Object({ kind: Schema.Literal("parent") }),
    Schema.Object({ kind: Schema.Literal("user"), escalation: Schema.Union([Schema.Literal("irreversible"), Schema.Literal("external")]), guess: Schema.String(), why: Schema.String() }),
    Schema.Object({ kind: Schema.Literal("answered"), by: Schema.Union([Schema.Literal("parent"), Schema.Literal("user")]), provisional: Schema.Boolean() }),
  ])),
})) }));
const storedLiveSchema = Schema.Object({ run: Schema.Optional(Schema.Object({ taskId: Schema.Integer({ minimum: 1 }) })) });

/** The saved read uses the same row projection as the execution owner's read, with public Storage reads only. */
export async function listStoredChildren(storage: Storage, parent: ConversationId, context: Context, worktrees?: DurableChildWorktrees): Promise<DurableChildSummary[]> {
  const state = await readChildDocument(storage, CHILD_AGENTS_DOC_KIND, parent, context);
  const questions = await readChildDocument(storage, CHILD_QUESTIONS_DOC_KIND, parent, context);
  if (state !== undefined && !Check(childRowsSchema, state)) throw new Error("Invalid saved child agents document");
  if (questions !== undefined && !Check(questionRowsSchema, questions)) throw new Error("Invalid saved child questions document");
  return childRows(state, questions, {
    task: id => storage.task(id, context),
    busy: async id => {
      const live = await readChildDocument(storage, "pi.live", id, context);
      if (live !== undefined && !Check(storedLiveSchema, live)) throw new Error("Invalid saved child live document");
      return live?.run !== undefined;
    },
    activity: id => readStoredChildActivity(storage, id, context),
  }, worktrees);
}

async function childRows(state: ChildRowsState | undefined, questionState: { items: Record<string, ChildQuestion> } | undefined,
  read: { task: (id: TaskId) => ReturnType<Harness["getTask"]>; busy: (id: ConversationId) => Promise<boolean>; activity: (id: ConversationId) => Promise<Pick<DurableChildSummary, "costUsd" | "lastTool">> },
  worktrees?: DurableChildWorktrees): Promise<DurableChildSummary[]> {
  const agents = state?.agents ?? {};
  const retries = new Map<ConversationId, ChildRetry>();
  for (const id of Object.values(state?.reporters ?? {})) {
    const task = await read.task(id);
    const retry = reporterRetry(task);
    const input = task?.input;
    if (retry !== undefined && typeof input === "object" && input !== null && !Array.isArray(input)) {
      const agent = Object.values(agents).find((agent) => agent.conversationId === input["conversationId"]);
      if (agent !== undefined) retries.set(agent.conversationId, retry);
    }
  }
  const questions = Object.entries(questionState?.items ?? {});
  const children = await Promise.all(Object.entries(agents).map(async ([name, agent]) => {
    const retry = retries.get(agent.conversationId);
    return {
      name, conversationId: Number(agent.conversationId), agent: agent.agent, createdAt: agent.createdAt,
      ...await read.activity(agent.conversationId),
      busy: retry !== undefined || await read.busy(agent.conversationId),
      ...(retry === undefined ? {} : { retry }),
      ...(agent.worktreeId === undefined ? {} : { worktree: await requireWorktrees(worktrees).summary(agent.worktreeId) }),
      questions: questions.filter(([, question]) => question.child === agent.conversationId && question.answer === null && question.closed !== true && (question.routing === undefined || question.routing.kind === "user"))
        .map(([questionId, question]) => ({ questionId, question: question.question, askedAt: question.askedAt }))
        .sort((a, b) => a.askedAt - b.askedAt),
    };
  }));
  return children.sort((a, b) => a.createdAt - b.createdAt);
}

async function ownedChild(harness: Harness, parent: ConversationId, conversationId: number, context: Context) {
  const agents = (await harness.snapshot(Children, parent, context))?.agents ?? {};
  const found = Object.entries(agents).find(([, candidate]) => Number(candidate.conversationId) === conversationId);
  if (found === undefined) throw new Error(`Conversation ${String(conversationId)} is not a child of this session`);
  const child = await harness.conversation(found[1].conversationId, context);
  if (child === undefined) throw new Error(`Child conversation ${String(conversationId)} is missing`);
  return { name: found[0], child, worktreeId: found[1].worktreeId };
}

/** The child transcript as model messages, plus its in-flight answer, for a child view. */
export async function childMessages(harness: Harness, parent: ConversationId, conversationId: number, context: Context) {
  const { child } = await ownedChild(harness, parent, conversationId, context);
  const view = await child.context(context);
  const live = await harness.snapshot(LiveDoc, child.id, context);
  return projectChildMessages(harness, child.id, view.entries, live?.run !== undefined, live?.generation?.message);
}

/** Saved transcript reads select the current context head, just as Conversation.context() does. */
export async function storedChildMessages(storage: Storage, parent: ConversationId, conversationId: number, context: Context) {
  const state = await readChildDocument(storage, CHILD_AGENTS_DOC_KIND, parent, context);
  if (state !== undefined && !Check(childRowsSchema, state)) throw new Error("Invalid saved child agents document");
  const agent = Object.values(state?.agents ?? {}).find(candidate => Number(candidate.conversationId) === conversationId);
  if (agent === undefined) throw new Error(`Conversation ${String(conversationId)} is not a child of this session`);
  const child = agent.conversationId;
  if (await storage.conversation(child, context) === undefined) throw new Error("Saved child conversation is missing");
  const tail = (await storage.scanEntries({ conversationId: child }, 1, undefined, context)).items[0]?.id;
  const head = tail === undefined ? undefined : await storage.findLatestHeadMarker(child, tail, context);
  const entries: EntryRecord[] = [];
  let cursor: Cursor | undefined;
  if (tail !== undefined) do {
    const page = await storage.scanEntries({ conversationId: child, maxEntryId: tail, ...(head === undefined ? {} : { minEntryId: head.head }), order: "ascending" }, 256, cursor, context);
    entries.push(...page.items); cursor = page.next;
  } while (cursor !== undefined);
  const live = await readChildDocument(storage, "pi.live", child, context);
  // Offline reads have no in-flight callback or volatile risk sidecar. Durable risk entries remain in the record.
  if (live !== undefined && !Check(storedLiveSchema, live)) throw new Error("Invalid saved child live document");
  return projectChildMessages(storage, child, head === undefined ? entries : [head, ...entries.filter(entry => entry.head === undefined)], live?.run !== undefined);
}

function projectChildMessages(owner: object, child: ConversationId, entries: readonly EntryRecord[], busy: boolean, partial?: AssistantMessage) {
  return {
    messages: withRiskAnnotations(owner, child, entries.flatMap<Message | {role: "custom"; customType: string; content: string; details: RiskLabelEntry}>(entry =>
      entry.kind === RISK_LABEL_ENTRY_KIND && Check(RiskLabelEntrySchema, entry.data)
        ? [{role: "custom", customType: RISK_LABEL_ENTRY_KIND, content: "Risk opinion (not approval)", details: entry.data}]
        : withToolInvocationIds(child, entry.model ?? [], entry.id)).filter(message => message.role !== "system")),
    busy,
    ...(partial === undefined ? {} : { partial }),
  };
}

async function noteInParent(parent: Conversation, text: string, data: Record<string, string | number>, context: Context): Promise<void> {
  await parent.submit({ type: "write", entry: { kind: CHILD_NOTE_KIND, model: [{ role: "user", content: [{ type: "text", text }], timestamp: Date.now() }], data: { ...data, text } } }, context);
}

/** The user typing into an opened child: a steer while it works, a new input when it is idle. */
export async function messageChild(harness: Harness, parent: Conversation, conversationId: number, text: string, context: Context, worktrees?: DurableChildWorktrees, extensions?: DurableChildExtensions): Promise<void> {
  await withChildAdmission(worktrees, async () => {
    const { name, child, worktreeId } = await ownedChild(harness, parent.id, conversationId, context);
    if (worktreeId !== undefined) await requireWorktrees(worktrees).assertWritable(worktreeId);
    const options = extensions === undefined ? undefined : extensionOptions.get(extensions);
    const selected = await options?.resolveOptions?.(parent.id, context) ?? options;
    // A user steer joins the busy turn immediately and keeps that turn's model. An idle send applies the
    // current declaration first; it does not inherit the previous turn's model or thinking level.
    await parent.commit((tx) => applyWorkflowWorkerModel(tx, parent.id, child.id, name, selected?.catalog), context);
    await child.submit({ type: "input", content: text, whenBusy: "steer" }, context);
    await noteInParent(parent, `[the user told child ${name} directly] ${text}`, { child: conversationId, childName: name, action: "message" }, context);
  });
}

export async function stopChild(harness: Harness, parent: Conversation, conversationId: number, context: Context, worktrees?: DurableChildWorktrees): Promise<void> {
  await withChildAdmission(worktrees, async () => {
    const { name, child } = await ownedChild(harness, parent.id, conversationId, context);
    // A backoff owns no live child run. Cancel its reporter first, or Stop would let it wake later.
    const reporters = (await harness.snapshot(Children, parent.id, context))?.reporters ?? {};
    for (const id of Object.values(reporters)) {
      const task = await harness.getTask(id, context);
      if (task?.state.status !== "terminal" && typeof task?.input === "object" && task.input !== null && !Array.isArray(task.input)
        && task.input["conversationId"] === child.id) await harness.abortTask(id, context);
    }
    await child.abort(context);
    await parent.commit(async (tx) => {
      for (const question of Object.values((await tx.doc(Questions, parent.id)).items)) {
        if (question.child === child.id && question.answer === null) question.closed = true;
      }
    }, context);
    await noteInParent(parent, `[the user stopped child ${name}]`, { child: conversationId, childName: name, action: "stop" }, context);
  });
}

type ChildResolution = { action: "answer"; name: string; questionId: string; answer: string; reason: string }
  | { action: "escalate"; questionId: string; kind: "irreversible" | "external" | "contradicts" | "stuck"; guess: string; why: string };

async function resolveChildQuestion(tx: Tx, parent: ConversationId, args: ChildResolution, receipt: string): Promise<string> {
  const items = (await tx.doc(Questions, parent)).items;
  const item = Object.hasOwn(items, args.questionId) ? items[args.questionId] : undefined;
  if (item === undefined) throw new WorkflowError(404, "Child question not found");
  if (item.resolvedBy === receipt) return "Question already resolved by this call.";
  if (item.answer !== null || item.closed === true || item.routing?.kind !== "parent") throw new WorkflowError(409, "Child question is not waiting for the parent");
  if (args.action === "answer" && item.childName !== args.name) throw new WorkflowError(404, "Question does not belong to that child");
  const choice = args.action === "answer" ? args.answer : args.guess;
  const reason = args.action === "answer" ? args.reason : args.why;
  if (choice.trim() === "" || reason.trim() === "") throw new WorkflowError(400, "A nonblank answer or guess and reason are required");
  item.resolvedBy = receipt;
  if (args.action === "escalate" && (args.kind === "irreversible" || args.kind === "external")) {
    item.routing = { kind: "user", escalation: args.kind, guess: choice, why: reason };
    await tx.appendEntry(parent, { kind: CHILD_QUESTION_KIND, data: { questionId: args.questionId, child: item.child, childName: item.childName, question: item.question, guess: choice, why: reason, kind: args.kind } });
    return "Escalated to the user. The child waits; keep working on anything independent.";
  }
  const provisional = args.action === "escalate";
  item.answer = choice;
  item.routing = { kind: "answered", by: "parent", provisional };
  await logDecision(tx, parent, { id: `d:${args.questionId}`, kind: provisional ? "guess" : "child-answer", by: "parent", question: item.question, choice, reason, flagged: provisional }, item.child);
  return provisional ? "Provisional answer sent and flagged in the decision log." : "Answer sent and recorded in the decision log.";
}

export async function answerChildQuestion(parent: Conversation, questionId: string, answer: string, context: Context): Promise<void> {
  if (answer.trim() === "") throw new WorkflowError(400, "A nonblank answer is required");
  await parent.commit(async (tx) => {
    const item = (await tx.doc(Questions, parent.id)).items[questionId];
    if (item?.answer !== null || item.closed === true || (item.routing !== undefined && item.routing.kind !== "user")) throw new Error(`Question ${questionId} is not open for the user`);
    const reason = item.routing?.kind === "user" ? item.routing.why : "The user answered a child question";
    item.answer = answer;
    item.routing = { kind: "answered", by: "user", provisional: false };
    await logDecision(tx, parent.id, { id: `d:${questionId}`, kind: "child-answer", by: "user", question: item.question, choice: answer, reason, flagged: false }, item.child);
    await tx.appendEntry(parent.id, { kind: CHILD_ANSWER_KIND, data: { questionId, answer } });
  }, context);
}

/** Ownership is checked before Git reads; the caller never supplies a checkout path. */
export async function reviewChildWorktree(harness: Harness, parent: ConversationId, conversationId: number, context: Context, worktrees?: DurableChildWorktrees) {
  const owned = await ownedChild(harness, parent, conversationId, context);
  if (owned.worktreeId === undefined) throw new Error("This child has no worktree");
  return requireWorktrees(worktrees).review(owned.worktreeId);
}

/** A removed child stays immutable. A new conversation starts in a fresh checkout of the default branch. */
export async function continueChild(harness: Harness, parent: Conversation, conversationId: number, text: string, requestId: string, context: Context, worktrees?: DurableChildWorktrees) {
  const lifecycle = requireWorktrees(worktrees);
  return lifecycle.exclusive(async () => {
    const previous = (await harness.snapshot(Children, parent.id, context))?.continuations?.[requestId];
    if (previous !== undefined) {
      if (previous.from !== conversationId || previous.text !== text) throw new Error("Continuation request already used for another task");
      return { conversationId: previous.conversationId };
    }
    const owned = await ownedChild(harness, parent.id, conversationId, context);
    if (owned.worktreeId === undefined || (await lifecycle.summary(owned.worktreeId)).state === "active") throw new Error("Continue in the existing child while its worktree is active");
    const settings = await harness.snapshot(AgentDoc, owned.child.id, context);
    const checkout = await lifecycle.prepare(`continue:${String(conversationId)}:${requestId}`, true);
    return parent.commit(async (tx) => {
      const state = await tx.doc(Children, parent.id);
      const source = state.agents[owned.name];
      if (source === undefined) throw new Error("Child record is missing");
      let suffix = 2;
      while (Object.hasOwn(state.agents, `${owned.name}-${String(suffix)}`)) suffix++;
      const name = `${owned.name}-${String(suffix)}`;
      const background = { ownership: { kind: "conversation" }, background: true } as const;
      const anchor = await tx.createTask(Anchor, null, background);
      const child = await tx.createConversation({ ownership: { kind: "task", taskId: anchor } });
      Object.assign(await tx.doc(AgentDoc, child.id), structuredClone(settings ?? {}), { cwd: checkout.path });
      state.agents[name] = { ...source, conversationId: child.id, createdAt: Date.now(), reported: [], worktreeId: checkout.id };
      const reporter = await tx.createTask(childReporter(() => Promise.resolve({ worktrees: lifecycle })), { name, conversationId: child.id, message: text, followUp: false, worktreeId: checkout.id }, background);
      state.reporters[`continue:${requestId}`] = reporter;
      await associateWorkflowChild(tx, parent.id, child.id, reporter, name);
      // Draft assignments clone their input. Replace the map rather than mutating an assigned plain object.
      state.continuations = { ...state.continuations, [requestId]: { from: conversationId, text, conversationId: Number(child.id) } };
      return { conversationId: Number(child.id) };
    }, context);
  });
}

/** Lifecycle actions refuse a working child and use the existing durable Git receipts. */
export function childWorktreeAction(harness: Harness, parent: ConversationId, conversationId: number, context: Context,
  worktrees: DurableChildWorktrees | undefined, action: "discard-preview", confirmationToken?: string): Promise<WorktreeDiscardPreview>;
export function childWorktreeAction(harness: Harness, parent: ConversationId, conversationId: number, context: Context,
  worktrees: DurableChildWorktrees | undefined, action: "land" | "discard", confirmationToken?: string): Promise<WorktreeActionResult>;
export async function childWorktreeAction(harness: Harness, parent: ConversationId, conversationId: number, context: Context,
  worktrees: DurableChildWorktrees | undefined, action: "land" | "discard-preview" | "discard", confirmationToken?: string) {
  const lifecycle = requireWorktrees(worktrees);
  return lifecycle.exclusive(async () => {
    const owned = await ownedChild(harness, parent, conversationId, context);
    if (owned.worktreeId === undefined) throw new Error("This child has no worktree");
    if ((await harness.snapshot(LiveDoc, owned.child.id, context))?.run !== undefined) throw new Error("Stop the child before changing its worktree");
    const receipts = (await harness.snapshot(Children, parent, context))?.reporters ?? {};
    for (const id of Object.values(receipts)) {
      const reporter = await harness.getTask(id, context);
      const input = reporter?.input;
      if (reporter?.state.status !== "terminal" && typeof input === "object" && input !== null && !Array.isArray(input)
        && input["conversationId"] === owned.child.id) throw new Error("Wait for the child's pending submission or report before changing its worktree");
    }
    if (action === "land") return lifecycle.land(owned.worktreeId);
    if (action === "discard-preview") return lifecycle.discardPreview(owned.worktreeId);
    if (confirmationToken === undefined || confirmationToken === "") throw new Error("A confirmationToken from discard-preview is required");
    return lifecycle.discard(owned.worktreeId, confirmationToken);
  });
}

/** One line for the transcript card of a child entry. */
export function childEntryText(kind: string, data: unknown): string {
  const record: Record<string, unknown> = typeof data === "object" && data !== null ? Object.fromEntries(Object.entries(data)) : {};
  const field = (key: string): string => { const value = record[key]; return typeof value === "string" ? value : ""; };
  if (kind === CHILD_QUESTION_KIND) return `${field("childName") || "child"} asks: ${field("question")}`;
  if (kind === CHILD_NOTE_KIND) return field("action") === "stop" ? `You stopped ${field("childName")}.` : `You told ${field("childName")}: ${field("text").replace(/^\[[^\]]*\]\s*/, "")}`;
  return `Answered: ${field("answer")}`;
}

function reporterRetry(task: Awaited<ReturnType<Harness["getTask"]>>): ChildRetry | undefined {
  if (task === undefined || task.state.status === "terminal" || !("checkpoint" in task.state)) return undefined;
  const checkpoint = task.state.checkpoint;
  if (typeof checkpoint !== "object" || checkpoint === null || Array.isArray(checkpoint) || checkpoint["phase"] !== "retry") return undefined;
  const retry = { attempt: checkpoint["attempt"], max: 3, error: checkpoint["error"], until: checkpoint["until"] };
  return Check(ChildRetrySchema, retry) ? retry : undefined;
}

/** The configured loadout is the authority, including for old children and refreshed agent files. */
async function sharedWriterRefusal(tx: Tx, parent: ConversationId): Promise<string | undefined> {
  const state = await tx.doc(Children, parent);
  const cwd = (await tx.doc(AgentDoc, parent)).cwd;
  for (const [name, agent] of Object.entries(state.agents)) {
    if (agent.worktreeId !== undefined) continue;
    const settings = await tx.doc(AgentDoc, agent.conversationId);
    const tools = settings.tools;
    const writer = Array.isArray(tools) ? childIsWriter(tools) : ["write", "edit", "bash"].some((name) => tools?.remove.includes(name) !== true);
    if (!writer || settings.cwd !== cwd) continue;
    let busy = (await tx.doc(LiveDoc, agent.conversationId)).run !== undefined;
    // Admission can precede input placement. A pending delivery or retry also reserves the shared checkout.
    for (const id of Object.values(state.reporters)) {
      const task = await tx.task(id);
      const input = task?.input;
      if (task?.state.status !== "terminal" && typeof input === "object" && input !== null && !Array.isArray(input) && input["conversationId"] === agent.conversationId) busy = true;
    }
    if (busy) return `Cannot spawn a shared writer: child ${name} is still busy in the same working directory. Use isolation: worktree or wait for ${name} to finish.`;
  }
  return undefined;
}
