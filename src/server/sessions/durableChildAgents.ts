import { AUTONOMY_GUIDANCE } from "./autonomyGuidance.js";
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
import type { ThinkingLevel } from "../../shared/thinkingLevels.js";
import { CHILD_MODEL_CONTINUE, childModelDiagnostic, childModelDiagnosticContext, childModelDiagnosticReport, hasUnsafeChildModelDiagnostic } from "../../shared/childModelDiagnostic.js";
import { childFallbackDiagnostic, ChildFallbackSchema, type ChildFallback } from "../../shared/childFallback.js";
import { childModelReference, modelKey, parseModelChoice, resolveModelChain, selectChainModel, type ModelChains } from "../../shared/modelChains.js";
import { assessChildModelFailure, type ChildFailureAssessment, childModelCooldown, planChildModelFailure, unavailableChildModel, type ChainProgress } from "./childModelFailures.js";
import type { ModelCooldownRegistry } from "./modelCooldownRegistry.js";
import { ChildRetrySchema, type ChildRetry } from "../../shared/childRetry.js";
import type { DurableSdkTools, DurableSdkToolsOptions } from "./durableSdkTools.js";
import type { ChildAgentCatalog, ChildAgentProfile } from "./durableChildProfiles.js";
import type { DurableChildSummary } from "../../shared/childAgents.js";
import type { WorktreeActionResult, WorktreeDiscardPreview } from "../../shared/sessionWorktree.js";
import type { DurableChildWorktrees } from "./durableChildWorktrees.js";
import { planChildRuntime, runtimeGaps, childIsWriter, missingToolsRefusal, type ChildRuntimePlan, type ChildSkill } from "./durableChildRuntime.js";
import { readsImages, watchdogDiffTool } from "./durableChildTools.js";
import { childRequestId } from "./childRequestIds.js";
import { associateWorkflowChild, settleWorkflowChild, deliveredWorkflowChild, undeliveredWorkflowChild, workflowChildRefusal, workflowWorkerModel, REVIEWER_AGENT } from "./durableWorkflowRuns.js";
import { deliverInputUntilPlaced, type InputPlacementState } from "./durableInputPlacement.js";
import { childParentInputExtension, childParentSubmission, submitChildParentInput } from "./durableChildParentInput.js";
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
type ChildRecord = { conversationId: ConversationId; reported: EntryId[]; agent: string | null; createdAt: number; worktreeId?: string; agentFile?: { path: string; sha256: string }; modelReference?: string; fallbacks?: ChildFallback[] };
type QuestionRouting = { kind: "parent" } | { kind: "user"; escalation: "irreversible" | "external"; guess: string; why: string }
  | { kind: "answered"; by: "parent" | "user"; provisional: boolean };
// No routing field means a user-facing question created before parent-first routing.
type ChildQuestion = { child: ConversationId; childName: string; question: string; answer: string | null; askedAt: number; closed?: boolean; routing?: QuestionRouting; resolvedBy?: string };
type ReporterInput = { name: string; conversationId: ConversationId; message: string; followUp: boolean; worktreeId?: string; workflowSend?: boolean; initialRetry?: { error: string; until: number } };
type ReporterPolicy = { firstDelivery?: boolean; progress?: ChainProgress; failure?: ChildFailureAssessment };
type ReporterState = ReporterPolicy & ({ phase: "deliver"; attempt?: number; error?: string } | { phase: "retry"; attempt: number; error: string; until: number; run?: string; retryAttempt?: number }
  | { phase: "switch"; attempt: number; error: string; to: string; run: string; until?: number; retryAttempt?: number }
  | { phase: "observe"; run: string; owner: TaskId } | { phase: "report"; report?: string; diagnosticsSafe?: boolean; suppressed?: "duplicate" | "aborted" });
type ChildRetryOwner = { owner: TaskId; conversationId: ConversationId; requestId: string };
/* eslint-enable @typescript-eslint/consistent-type-definitions */

export const CHILD_AGENTS_DOC_KIND = "forgerie.durable-children";
const Children = defineDoc<{ agents: Record<string, ChildRecord>; reporters: Record<string, TaskId>;
  failureRuns?: Record<string, string>; failureModels?: Record<string, string>; retryOwners?: Record<string, ChildRetryOwner>;
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

function chainModels(reference: string | undefined, chains: ModelChains, parent: { model?: { provider: string; modelId: string }; thinkingLevel?: ThinkingLevel }, thinking?: ThinkingLevel): string[] {
  const spec = reference ?? (parent.model === undefined ? undefined : `${parent.model.provider}/${parent.model.modelId}`);
  return spec === undefined ? [] : resolveModelChain(spec, chains, thinking ?? parent.thinkingLevel);
}
function fallbackNote(fallbacks: readonly ChildFallback[]): string {
  return fallbacks.length === 0 ? "" : ` (ran on ${fallbacks.at(-1)?.to ?? ""} after ${fallbacks.map((item) => `${item.from}: ${childModelDiagnostic(item.reason)}`).join("; ")})`;
}
/** Apply a declared model only between turns. The caller may wait, or keep a user steer in the current turn. */
async function applyWorkflowWorkerModel(tx: Tx, parentId: ConversationId, childId: ConversationId, name: string, selected: DurableChildExtensionOptions = {}): Promise<TaskId | undefined> {
  const declared = await workflowWorkerModel(tx, parentId, name);
  if (declared === undefined) return undefined;
  const children = await tx.doc(Children, parentId);
  const record = children.agents[name];
  const profile = record?.agent == null ? undefined : await selected.catalog?.find(record.agent);
  const reference = childModelReference(declared, undefined, profile);
  const parent = await tx.doc(AgentDoc, parentId);
  const chains = selected.modelChains?.() ?? {};
  const models = chainModels(reference, chains, parent, profile?.thinkingLevel);
  const cooldowns = await selected.modelCooldowns?.snapshot() ?? {};
  const chosen = models.length === 0 ? undefined : selectChainModel(models, cooldowns, selected.now?.() ?? Date.now());
  const choice = chosen === undefined ? null : parseModelChoice(chosen.model);
  const model = choice?.model ?? parent.model;
  const thinkingLevel = choice?.thinkingLevel ?? parent.thinkingLevel ?? "off";
  const configured = await tx.doc(AgentDoc, childId);
  const unchanged = configured.model?.provider === model?.provider && configured.model?.modelId === model?.modelId && (configured.thinkingLevel ?? "off") === thinkingLevel;
  const busy = (await tx.doc(LiveDoc, childId)).run?.taskId;
  if (busy !== undefined) return unchanged ? undefined : busy;
  // A chain's reporter still owns the run during backoff. Do not let a send reset its model or history.
  if (models.length > 1) for (const id of Object.values(children.reporters)) {
    const task = await tx.task(id);
    if (task === undefined || task.state.status === "terminal" || !("checkpoint" in task.state)) continue;
    const input = task.input;
    const checkpoint = task.state.checkpoint;
    if (typeof input !== "object" || input === null || Array.isArray(input) || input["conversationId"] !== childId
      || typeof checkpoint !== "object" || checkpoint === null || Array.isArray(checkpoint)) continue;
    if (checkpoint["phase"] === "retry" || checkpoint["phase"] === "switch" || (checkpoint["phase"] === "deliver" && typeof checkpoint["attempt"] === "number" && checkpoint["attempt"] > 0)) return unchanged ? undefined : id;
  }
  if (!unchanged) await configure(tx, childId, { model: model ?? null, thinkingLevel });
  if (record !== undefined) {
    if (reference === undefined) delete record.modelReference; else record.modelReference = reference;
    record.fallbacks = chosen === undefined || models[0] === chosen.model ? [] : [{ from: modelKey(models[0] ?? chosen.model), to: modelKey(chosen.model), reason: childModelDiagnostic(cooldowns[modelKey(models[0] ?? chosen.model)]?.reason ?? "model cooling") }];
  }
  return undefined;
}

const REPORTER_KIND = "forgerie.child-reporter";
function childReporter(resolve: (conversationId: ConversationId, context: Context) => Promise<DurableChildExtensionOptions>) {
  return defineTask<ReporterInput, ReporterState, null>({
  name: REPORTER_KIND, version: 1, initial: (input) => input.initialRetry === undefined ? { phase: "deliver" } : { phase: "retry", attempt: 1, retryAttempt: 1, ...input.initialRetry, error: childModelDiagnostic(input.initialRetry.error), firstDelivery: true, progress: { failed: [], waited: [], budget: 1, exhausted: true } },
  phases: {
    deliver: async (reporter, runtime, context) => {
      const { name, conversationId, message, followUp } = reporter.input;
      const child = await runtime.conversation(conversationId, context);
      if (child === undefined) throw new Error(`Child conversation ${String(conversationId)} is missing`);
      const attempt = reporter.state.checkpoint.attempt ?? 0;
      const content = attempt === 0 || reporter.state.checkpoint.firstDelivery === true ? message : CHILD_MODEL_CONTINUE;
      if (reporter.input.workflowSend === true && attempt === 0) {
        const selected = await resolve(runtime.conversationId, context);
        // A model switch must not affect later tool rounds of an already running turn. Wait for that turn,
        // then resolve the current declaration again: the user can edit it while delivery is waiting.
        for (;;) {
          let busy: TaskId | undefined;
          await runtime.commit(async (tx) => {
            if (await tx.submissionByRequest(conversationId, `child:${String(reporter.id)}`) !== undefined) return;
            busy = await applyWorkflowWorkerModel(tx, runtime.conversationId, conversationId, name, selected);
          }, context);
          if (busy === undefined) break;
          await runtime.waitForTask(busy, context);
        }
      }
      const attempted = await runtime.snapshot(AgentDoc, conversationId, context);
      const attemptedModel = attempted?.model === undefined ? undefined : `${attempted.model.provider}/${attempted.model.modelId}`;
      const submission = await child.submit({ type: "input", content, whenBusy: attempt > 0 || followUp ? "followUp" : "steer",
        requestId: childRequestId(reporter.id, attempt) }, context);
      const selected = await resolve(runtime.conversationId, context);
      await selected.flushRunRecords?.();
      const settled = await submission.wait(context);
      let detail = settled.status === "unanswered" && settled.detail !== undefined ? (typeof settled.detail === "string" ? settled.detail : JSON.stringify(settled.detail)) : undefined;
      let missingRun: string | undefined;
      if (settled.status === "unanswered" && settled.reason === "no_model") {
        // Unlike provider errors, Durable puts this diagnostic on the generation receipt, not the submission.
        await runtime.commit(async (tx) => {
          const task = (await tx.scanTasks({ conversationId, kind: GenerationTask.definition.name, status: "terminal", order: "descending" }, 1)).items[0];
          if (task?.state.status === "terminal" && task.state.outcome.status === "failed" && attemptedModel !== undefined && unavailableChildModel(task.state.outcome.error.message) === attemptedModel) {
            detail = task.state.outcome.error.message; missingRun = `generation:${String(task.id)}`;
          }
        }, context);
      }
      const failure = detail === undefined ? undefined : assessChildModelFailure(detail);
      const diagnostic = detail === undefined ? undefined : childModelDiagnostic(detail, failure?.credentials);
      if (settled.status === "unanswered" && (settled.reason === "model_error" || settled.reason === "no_model")) {
        const settings = await runtime.snapshot(AgentDoc, conversationId, context);
        const current = (settled.reason === "no_model" && detail !== undefined ? unavailableChildModel(detail) : undefined)
          ?? (await runtime.snapshot(Children, runtime.conversationId, context))?.failureModels?.[String(settled.id)]
          ?? (settings?.model === undefined ? undefined : `${settings.model.provider}/${settings.model.modelId}${settings.thinkingLevel === undefined ? "" : `:${settings.thinkingLevel}`}`);
        const until = detail === undefined ? undefined : childModelCooldown(detail, runtime.now());
        let marked = false;
        if (current !== undefined && until !== undefined && selected.modelCooldowns !== undefined) {
          try { await selected.modelCooldowns.mark(modelKey(current), until, diagnostic ?? "model_error"); marked = true; }
          catch (error) { runtime.report(error); } // A cooldown disk failure must not hide the child's provider outcome.
        }
        const cooldowns = await selected.modelCooldowns?.snapshot() ?? {};
        // Successful writes (including a refused shorter deadline) make the persisted snapshot authoritative.
        // Without a write, retain any longer known deadline while adding the local failure.
        if (!marked && current !== undefined && until !== undefined) {
          const previous = cooldowns[modelKey(current)];
          cooldowns[modelKey(current)] = { until: Math.max(previous?.until ?? 0, until), reason: previous !== undefined && previous.until > until ? childModelDiagnostic(previous.reason) : diagnostic ?? "model_error" };
        }
        const chains = selected.modelChains?.() ?? {};
        const progress = { delegated: false };
        await runtime.commit(async (tx) => {
          const doc = await tx.doc(Children, runtime.conversationId);
          const run = doc.failureRuns?.[String(settled.id)] ?? missingRun ?? `input:${String(settled.id)}`;
          const claim = doc.retryOwners?.[run];
          if (claim !== undefined && claim.owner !== reporter.id) {
            progress.delegated = true;
            return { status: "running", checkpoint: { phase: "observe", run, owner: claim.owner } };
          }
          if (claim === undefined) doc.retryOwners = { ...doc.retryOwners, [run]: { owner: reporter.id, conversationId, requestId: childRequestId(reporter.id, attempt) } };
          const agent = doc.agents[name];
          let models: string[];
          try { models = current === undefined ? [] : chainModels(agent?.modelReference, chains, parseModelChoice(current) ?? settings ?? {}); }
          catch (error) { runtime.report(error); models = current === undefined ? [] : [current]; } // A deleted chain keeps the admitted model.
          const checkpoint = reporter.state.checkpoint;
          const plan = current === undefined || detail === undefined || models.length === 0 ? { kind: "report" as const }
            : planChildModelFailure({ models, current, error: detail, now: runtime.now(), cooldowns,
              progress: checkpoint.progress ?? { failed: [], waited: [], budget: attempt }, ...(failure === undefined ? {} : { assessment: failure }) });
          if (plan.kind !== "report") {
            progress.delegated = true;
            const common = { attempt: attempt + 1, error: diagnostic ?? "model_error", run, progress: plan.progress, ...(failure === undefined ? {} : { failure }) };
            return { status: "running", checkpoint: plan.kind === "retry"
              ? { ...common, phase: "retry", retryAttempt: plan.retryAttempt, until: runtime.now() + plan.delay }
              : { ...common, phase: "switch", to: plan.to, ...(plan.delay === undefined ? {} : { until: runtime.now() + plan.delay }), ...(plan.retryAttempt === undefined ? {} : { retryAttempt: plan.retryAttempt }) } };
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
        const next = (report?: string, suppressed: "duplicate" | "aborted" = "aborted"): { status: "running"; checkpoint: ReporterState } => ({ status: "running", checkpoint: report === undefined ? { phase: "report", suppressed } : { phase: "report", report, diagnosticsSafe: true } });
        if (settled.status === "unanswered") {
          if (settled.reason === "aborted") return next();
          // A failed input is not a dead child: a later steer or retry can still be running. Say so, or the parent
          // starts a replacement that edits the same files.
          const stillRunning = (await tx.doc(LiveDoc, conversationId)).run !== undefined;
          const fallbacks = (await tx.doc(Children, runtime.conversationId)).agents[name]?.fallbacks ?? [];
          return next(`[subagent ${name} failed: ${childModelDiagnostic(settled.reason)}${diagnostic === undefined ? "" : `: ${diagnostic}`}${stillRunning ? `. ${childStillRunningNote(name)}` : ""}]${fallbackNote(fallbacks)}`);
        }
        if (settled.type !== "input") return next();
        const agent = (await tx.doc(Children, runtime.conversationId)).agents[name];
        const answer = (await tx.entry(AssistantEntry, settled.answer))?.model?.[0];
        if (agent === undefined || agent.reported.includes(settled.answer)) return next(undefined, agent?.reported.includes(settled.answer) === true ? "duplicate" : "aborted");
        agent.reported.push(settled.answer);
        return next(`[subagent ${name} answered${fallbackNote(agent.fallbacks ?? [])}, no reply needed] ${textOf(isAssistant(answer) ? answer : undefined)}${worktreeReport === undefined ? "" : `\n\n${worktreeReport}`}`);
      }, context);
    },
    switch: async (reporter, runtime, context) => {
      const { attempt, to, run, until, retryAttempt, progress } = reporter.state.checkpoint;
      const failure = reporter.state.checkpoint.failure ?? assessChildModelFailure(reporter.state.checkpoint.error);
      const error = childModelDiagnostic(reporter.state.checkpoint.error);
      const { conversationId, name } = reporter.input;
      for (;;) {
        const selected = await resolve(runtime.conversationId, context);
        const chains = selected.modelChains?.() ?? {};
        const cooldowns = await selected.modelCooldowns?.snapshot() ?? {};
        let busy: TaskId | undefined;
        await runtime.commit(async (tx) => {
          busy = (await tx.doc(LiveDoc, conversationId)).run?.taskId;
          if (busy !== undefined) return undefined;
          const settings = await tx.doc(AgentDoc, conversationId);
          const from = settings.model === undefined ? "unknown" : `${settings.model.provider}/${settings.model.modelId}`;
          const doc = await tx.doc(Children, runtime.conversationId);
          const record = doc.agents[name];
          // Re-read after waiting for a live steer, or after restart. Another session may have cooled the target.
          // An exhausted budget deliberately probes its pinned cooling model instead.
          let target = to;
          let nextProgress = progress;
          let deadline = until;
          let nextAttempt = retryAttempt;
          if (progress?.exhausted !== true && settings.model !== undefined) {
            let models: string[];
            try { models = chainModels(record?.modelReference, chains, settings); }
            catch (cause) { runtime.report(cause); models = [from]; }
            const plan = planChildModelFailure({ models, current: from, error, assessment: failure, now: runtime.now(), cooldowns, ...(progress === undefined ? {} : { progress }) });
            if (plan.kind === "report") {
              const claim = doc.retryOwners?.[run];
              const settled = claim === undefined ? undefined : await tx.submissionByRequest(conversationId, claim.requestId);
              if (settled !== undefined) await settleWorkflowChild(tx, runtime.conversationId, reporter.id, settled);
              return { status: "running", checkpoint: { phase: "report", diagnosticsSafe: true, report: `[subagent ${name} failed: model_error: ${error}]${fallbackNote(record?.fallbacks ?? [])}` } };
            }
            if (plan.kind === "retry") return { status: "running", checkpoint: { phase: "retry", attempt, error, run, failure,
              progress: plan.progress, until: runtime.now() + plan.delay, retryAttempt: plan.retryAttempt } };
            target = plan.to; nextProgress = plan.progress; nextAttempt = plan.retryAttempt;
            deadline = plan.delay === undefined ? undefined : runtime.now() + plan.delay;
          }
          const choice = parseModelChoice(target);
          if (choice === null) throw new Error(`Invalid fallback model: ${target}`);
          await configure(tx, conversationId, { model: choice.model, thinkingLevel: choice.thinkingLevel ?? "off" });
          const fallback = { from, to: modelKey(target), reason: error };
          if (from !== fallback.to) {
            if (record !== undefined) record.fallbacks = [...record.fallbacks ?? [], fallback];
            await tx.appendEntry(conversationId, { kind: "forgerie.child-fallback", data: fallback });
          }
          const claim = doc.retryOwners?.[run];
          if (claim !== undefined) claim.requestId = childRequestId(reporter.id, attempt);
          const common = { attempt, error, failure, ...(nextProgress === undefined ? {} : { progress: nextProgress }) };
          return { status: "running", checkpoint: deadline === undefined ? { ...common, phase: "deliver" }
            : { ...common, phase: "retry", until: deadline, run, ...(nextAttempt === undefined ? {} : { retryAttempt: nextAttempt }) } };
        }, context);
        if (busy === undefined) return;
        await runtime.waitForTask(busy, context);
      }
    },
    retry: async (reporter, runtime, context) => {
      const { attempt, until, run, progress, firstDelivery, failure } = reporter.state.checkpoint;
      const error = childModelDiagnostic(reporter.state.checkpoint.error);
      await runtime.sleep(until, context);
      await runtime.commit(async (tx) => {
        const claim = run === undefined ? undefined : (await tx.doc(Children, runtime.conversationId)).retryOwners?.[run];
        // Publish the next receipt before admission. A steer joining that retry inherits this owner and budget.
        if (claim !== undefined) claim.requestId = childRequestId(reporter.id, attempt);
        return { status: "running", checkpoint: { phase: "deliver", attempt, error, ...(failure === undefined ? {} : { failure }), ...(firstDelivery === undefined ? {} : { firstDelivery }), ...(progress === undefined ? {} : { progress }) } };
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
          const accepted = await childParentSubmission(tx, runtime.conversationId, `child-report:${String(owner)}`);
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
      const report = checkpoint.report === undefined ? undefined : checkpoint.diagnosticsSafe === true ? checkpoint.report : childModelDiagnosticReport(checkpoint.report);
      if (report !== undefined) {
        await submitChildParentInput(runtime, `child-report:${String(reporter.id)}`, report, context);
      }
      await runtime.commit(async (tx) => {
        if (report === undefined) await undeliveredWorkflowChild(tx, runtime.conversationId, reporter.id, checkpoint.suppressed ?? "aborted");
        else await deliveredWorkflowChild(tx, runtime.conversationId, reporter.id);
        return { status: "terminal", outcome: { status: "completed", result: null } };
      }, context);
    },
  },
  abort: (task, runtime, context) => runtime.commit(async (tx) => {
    const accepted = await childParentSubmission(tx, runtime.conversationId, `child-report:${String(task.id)}`);
    // Preserve an answer already committed before Stop. Backoff cancellation itself settles as stopped.
    if (task.state.checkpoint.phase === "deliver") {
      const attempt = task.state.checkpoint.attempt ?? 0;
      const submission = await tx.submissionByRequest(task.input.conversationId, childRequestId(task.id, attempt));
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
// requestId is absent on the original question delivery, so outboxes saved before reminders replay unchanged.
const QuestionDelivery = defineTask<{ questionId: string; text: string; requestId?: string }, InputPlacementState, null>({
  name: "forgerie.child-question-delivery", version: 1, initial: () => ({ phase: "deliver" }),
  phases: { deliver: async (task, runtime, context) => {
    const question = (await runtime.snapshot(Questions, runtime.conversationId, context))?.items[task.input.questionId];
    if (question?.closed === true || question?.answer !== null) {
      await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), context);
      return;
    }
    await deliverInputUntilPlaced(runtime, task.state.checkpoint, { requestId: task.input.requestId ?? `child-question:${task.input.questionId}`, content: task.input.text,
      previousRecipient: runtime.conversationId, selectRecipient: () => Promise.resolve(runtime.conversationId),
      submit: (requestId) => submitChildParentInput(runtime, requestId, task.input.text, context) }, context);
  } },
  abort: (_task, runtime, context) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});

/** How long a question may wait for the parent before Forgerie reminds it once. Holds in the audit ran 65 to 121 min. */
export const QUESTION_REMINDER_MS = 10 * 60_000;

/**
 * One reminder to the parent, only while the question still waits for the parent's answer or escalation. A question
 * escalated to the user gets none: the parent cannot act on it. The Harness clock sets the time, so it survives restart.
 */
type ReminderState = { phase: "start" } | { phase: "wait"; until: number };
const QuestionReminder = defineTask<{ questionId: string }, ReminderState, null>({
  name: "forgerie.child-question-reminder", version: 1, initial: () => ({ phase: "start" }),
  phases: {
    start: (_task, runtime, context) => runtime.commit(() => ({ status: "running", checkpoint: { phase: "wait", until: runtime.now() + QUESTION_REMINDER_MS } }), context),
    wait: async (task, runtime, context) => {
      await runtime.sleep(task.state.checkpoint.until, context);
      await runtime.commit(async (tx) => {
        const { questionId } = task.input;
        const question = (await tx.doc(Questions, runtime.conversationId)).items[questionId];
        if (question?.answer === null && question.closed !== true && question.routing?.kind === "parent") {
          await tx.createTask(QuestionDelivery, { questionId, requestId: `child-question-reminder:${questionId}`,
            text: `[child ${question.childName} still waits on ${questionId}, asked over ${String(QUESTION_REMINDER_MS / 60_000)} min ago] ${question.question}\nThe child does nothing until you call child_agent with action answer (name ${question.childName}, questionId ${questionId}) or escalate. A send does not answer it.` },
            { conversationId: runtime.conversationId, ownership: { kind: "conversation" }, background: true });
        }
        return { status: "terminal", outcome: { status: "completed", result: null } };
      }, context);
    },
  },
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
      await tx.createTask(QuestionReminder, { questionId }, { conversationId: parentId, ownership: { kind: "conversation" }, background: true });
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
  /** Daemon-owned config reader and shared persistent cooldown registry. */
  modelChains?: () => ModelChains;
  /** Uses the Harness clock when a host supplies a custom clock. */
  now?: () => number;
  modelCooldowns?: Pick<ModelCooldownRegistry, "snapshot" | "mark">;
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
        beforeRequest: async (request, api, ctx) => {
          await (await resolve(api.conversationId, ctx)).flushRunRecords?.();
          const messages = childModelDiagnosticContext(request.messages);
          return messages.some((message, index) => message !== request.messages[index]) ? { messages } : undefined;
        },
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
            const settings = await tx.doc(AgentDoc, api.conversationId);
            const model = settings.model ?? { provider: message.provider, modelId: message.model };
            const spec = `${model.provider}/${model.modelId}${settings.thinkingLevel === undefined ? "" : `:${settings.thinkingLevel}`}`;
            doc.failureModels = { ...doc.failureModels, ...Object.fromEntries(inputs.map((id) => [String(id), spec])) };
          }, ctx);
        },
      }),
      hook(CompactionTask, { beforeCompact: async (request, api, ctx) => {
        const selected = await resolve(api.conversationId, ctx); await selected.flushRunRecords?.();
        const decision = { decline: false };
        await selected.commit?.(async (tx) => {
          const parent = (await tx.conversation(api.conversationId))?.owner?.conversationId;
          const provider = (await tx.doc(AgentDoc, api.conversationId)).model?.provider;
          if (parent === undefined || provider === undefined) return;
          const record = Object.values((await tx.doc(Children, parent)).agents).find((child) => child.conversationId === api.conversationId);
          decision.decline = hasUnsafeChildModelDiagnostic({ messages: request.messages, entries: request.entries, provider, fallbacks: record?.fallbacks ?? [] });
        }, ctx);
        // Single-model/legacy runs must still compact. Chains did not exist before this deploy and new retry
        // prompts are generic, so no legacy cross-provider compaction needs a restart pre-send hook or migration.
        return decision.decline ? { decline: true } : undefined;
      } }),
    ],
    tools: [askHumanTool, ...codingTools, watchdogDiffTool, ...extraTools, ...sharedTools],
    wraps: [
      // One sequential mutation makes the entire tool round respect declaration order.
      ...codingTools.filter(tool => tool.name === "write" || tool.name === "edit").map(tool => wrapTool(tool, inner => ({ ...inner, executionMode: "sequential" }))),
      ...(readTool === undefined ? [] : [readsImages(readTool)]),
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
      "A child works on its own. Pending child reports and questions arrive together in one message. Read every child section. Do not wait or poll.",
      AUTONOMY_GUIDANCE,
      "A child asks you first. Answer from the task, contract, code, docs and chat under the same rule. Use irreversible/external only for categories (a)/(b); those escalations wait for the user. For category (c), a physical or observation request, or explicit user consultation, use ask_user, then answer the child from the user's reply. Otherwise answer the child yourself. contradicts/stuck give your best guess at once, marked provisional in the decision log; do not use them for category (c). Do not wait or poll. The user can open, steer and stop children. Several spawns in one reply run in parallel.",
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
        model: Type.Optional(Type.String({ description: "Model for spawn as a configured model chain name or provider/model-id, optionally with :thinking-level. Omit it: the child then runs on its agent file's model. Set it only when the user asks for a model, or after the agent file's model failed. It overrides the agent file." })),
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
        // A workflow stop holds work that belongs after it, and a review round limit holds another review.
        // Ask before preparing a worktree, and again in the commit.
        const thisAgent = action === "spawn" ? args.agent : existing?.agent ?? undefined;
        const reviewers = async (tx: Tx) => {
          const agents = (await tx.doc(Children, api.conversationId)).agents;
          return (child: string) => (child === name ? thisAgent : Object.hasOwn(agents, child) ? agents[child]?.agent : undefined) === REVIEWER_AGENT;
        };
        const held = await api.commit(async (tx) => workflowChildRefusal(tx, api.conversationId, name, await reviewers(tx)), context);
        if (held !== undefined) return { content: [{ type: "text" as const, text: held }], isError: true };
        // A model the workflow declares for this worker is the user's choice: it wins over the agent's argument.
        const declared = action === "spawn" ? await api.commit((tx) => workflowWorkerModel(tx, api.conversationId, name), context) : undefined;
        if (existing?.worktreeId !== undefined) await requireWorktrees(selected.worktrees).assertWritable(existing.worktreeId);
        const profile = action === "spawn" && args.agent !== undefined ? await selected.catalog?.find(args.agent) : undefined;
        if (action === "spawn" && args.agent !== undefined && profile === undefined) {
          return { content: [{ type: "text" as const, text: `No agent named ${args.agent}.${agentList === "" ? "" : ` Choose one of:\n${agentList}`}` }], isError: true };
        }
        const chains = selected.modelChains?.() ?? {};
        if (action === "spawn") {
          const reference = childModelReference(declared, args.model, profile);
          try { if (reference !== undefined) resolveModelChain(reference, chains); }
          catch (error) { return { content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }], isError: true }; }
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
          // Worktree preparation can outlive a config edit or another session's provider failure.
          const chains = selected.modelChains?.() ?? {};
          const cooldowns = await selected.modelCooldowns?.snapshot() ?? {};
          const refusal = await workflowChildRefusal(tx, api.conversationId, name, await reviewers(tx));
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
            const reference = childModelReference(current, args.model, profile);
            const models = chainModels(reference, chains, parentAgent, profile?.thinkingLevel);
            const chosen = models.length === 0 ? undefined : selectChainModel(models, cooldowns, selected.now?.() ?? Date.now());
            const choice = chosen === undefined ? null : parseModelChoice(chosen.model);
            const chosenModel = choice?.model;
            const chosenThinking = choice?.thinkingLevel;
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
              ...(reference === undefined ? {} : { modelReference: reference }),
              ...(chosen === undefined || models[0] === chosen.model ? {} : { fallbacks: [{ from: modelKey(models[0] ?? chosen.model), to: modelKey(chosen.model), reason: childModelDiagnostic(cooldowns[modelKey(models[0] ?? chosen.model)]?.reason ?? "model cooling") }] }),
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
          const configured = await tx.doc(AgentDoc, agent.conversationId);
          const configuredModels = action === "spawn" ? chainModels(agent.modelReference, chains, configured) : [];
          const exhausted = action === "spawn" && configuredModels.length > 1 && selectChainModel(configuredModels, cooldowns, selected.now?.() ?? Date.now()).exhausted;
          const earliest = exhausted ? selectChainModel(configuredModels, cooldowns, selected.now?.() ?? Date.now()).model : undefined;
          const initialRetry = earliest === undefined ? undefined : { error: childModelDiagnostic(cooldowns[modelKey(earliest)]?.reason ?? "All models are cooling"), until: (selected.now?.() ?? Date.now()) + 30_000 };
          const reporter = await tx.createTask(Reporter, { name, conversationId: agent.conversationId, message, followUp: false, ...(initialRetry === undefined ? {} : { initialRetry }), ...(action === "send" ? { workflowSend: true } : {}), ...(agent.worktreeId === undefined ? {} : { worktreeId: agent.worktreeId }) }, background);
          state.reporters[String(api.taskId)] = reporter;
          await associateWorkflowChild(tx, api.conversationId, agent.conversationId, reporter, name);
          if (action === "send") {
            const waiting = openQuestionNote(parentQuestions((await tx.doc(Questions, api.conversationId)).items, name), name);
            return `${refresh ? `Sent to ${name}.` : `Sent to ${name}. Its agent file ${String(agent.agent)} is gone, so it keeps the tools it was started with.`}${waiting}`;
          }
          return `Started ${name}${profile === undefined ? "" : ` (${profile.name})`}.${runtime === undefined ? "" : runtimeGaps(runtime)}`;
        }, context);
        const current = (await api.snapshot(Children, api.conversationId, context))?.agents[name];
        return { content: [{ type: "text" as const, text: result }], ...(current === undefined ? {} : { details: { name, conversationId: Number(current.conversationId) } }) };
      });
    },
  });
  const extensions = {
    parent: [childParentInputExtension, defineExtension({ name: "forgerie.child-agents", tasks: [Anchor, Reporter, QuestionDelivery, QuestionReminder], tools: [childTool] })],
    childOnly: [ChildTools],
    refresh: () => durableChildExtensions(options),
  };
  extensionOptions.set(extensions, options);
  return extensions;
}

/** Model spec parser shared by agent files, spawns and workflow overrides; non-thinking colons stay in the ID. */
export const modelChoice = parseModelChoice;

/**
 * How a child checks its work. Over 10-12 to 10-15, workflow builders ran the full suite 377 times (18 hours), up to
 * 27 times each, mostly to confirm small fixes. The parent now places one full run per stage.
 */
export const CHILD_CHECKS = "Check your work with focused checks: the tests for the files you changed (for example the project's related or changed-tests command), the typecheck and the linter. Do not run the project's full test suite or full verification unless your task tells you to; the parent runs it once on the combined work. If you think the change needs it, say so in your report. Report each check you ran and its result.";

/** A child's instructions: its agent file's prompt, its role, how this runtime differs, and the project's context. */
function childInstructions(name: string, profile: ChildAgentProfile | undefined, plan: ChildRuntimePlan, projectContext: string | undefined): string {
  const project = profile?.inheritProjectContext !== false && projectContext !== undefined && projectContext !== ""
    ? `\n\n<project_context>\n${projectContext}\n</project_context>` : "";
  return `${profile?.prompt ?? "You are a helper agent. Do the task you are given, then reply with a short result."}\n\nYou are the child agent "${name}" of a parent agent. Your final reply goes back to the parent. Use ask_human only when you are blocked; it asks your parent, not the user.\n${AUTONOMY_GUIDANCE}\nDo not file issues. Suggest issues in your report; the parent files them.\n${CHILD_CHECKS}${plan.section === "" ? "" : `\n\n${plan.section}`}${project}`;
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

interface ChildRowsState { agents: Record<string, Pick<ChildRecord, "conversationId" | "agent" | "createdAt" | "worktreeId" | "fallbacks">>; reporters: Record<string, TaskId> }
const childRowsSchema = Schema.Unsafe<ChildRowsState>(Schema.Object({
  agents: Schema.Record(Schema.String(), Schema.Object({ conversationId: Schema.Integer({ minimum: 1 }), agent: Schema.Union([Schema.String(), Schema.Null()]), createdAt: Schema.Number(), worktreeId: Schema.Optional(Schema.String()), fallbacks: Schema.Optional(Schema.Array(ChildFallbackSchema)) })),
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
    const latestFallback = agent.fallbacks?.at(-1);
    const fallback = latestFallback === undefined ? undefined : childFallbackDiagnostic(latestFallback);
    return {
      name, conversationId: Number(agent.conversationId), agent: agent.agent, createdAt: agent.createdAt,
      ...await read.activity(agent.conversationId),
      busy: retry !== undefined || await read.busy(agent.conversationId),
      ...(retry === undefined ? {} : { retry }),
      ...(fallback === undefined ? {} : { fallback }),
      ...(agent.worktreeId === undefined ? {} : { worktree: await requireWorktrees(worktrees).summary(agent.worktreeId) }),
      questions: questions.filter(([, question]) => question.child === agent.conversationId && question.answer === null && question.closed !== true && (question.routing === undefined || question.routing.kind === "user"))
        .map(([questionId, question]) => ({ questionId, question: question.question, askedAt: question.askedAt }))
        .sort((a, b) => a.askedAt - b.askedAt),
      ...waitingForParent(questions, agent.conversationId),
    };
  }));
  return children.sort((a, b) => a.createdAt - b.createdAt);
}

/** The oldest question of this child that waits for the parent, so a quiet child reads as waiting, not stuck. */
function waitingForParent(questions: readonly [string, ChildQuestion][], child: ConversationId): Pick<DurableChildSummary, "waitingForParent"> {
  const [found] = parentQuestions(Object.fromEntries(questions.filter(([, question]) => question.child === child)));
  return found === undefined ? {} : { waitingForParent: { questionId: found[0], askedAt: found[1].askedAt } };
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
    await parent.commit((tx) => applyWorkflowWorkerModel(tx, parent.id, child.id, name, selected), context);
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

/** Part of a failure report when the child still runs other work, such as a later message or a retry. */
export function childStillRunningNote(name: string): string {
  return `This request failed, but ${name} is still running other work. Do not start a replacement for the same files; wait for its report, or stop it first`;
}

/**
 * The stored key of a question. Parents often drop the `q:` prefix of the handle in the notification ("313" for
 * "q:313"); accept that only when the prefixed key exists. Ownership and state checks still apply to the result.
 */
export function questionKey(items: Readonly<Record<string, unknown>>, questionId: string): string | undefined {
  const id = questionId.trim();
  if (Object.hasOwn(items, id)) return id;
  const prefixed = `q:${id}`;
  return /^\d+$/u.test(id) && Object.hasOwn(items, prefixed) ? prefixed : undefined;
}

/** Questions from children that wait for the parent's `answer` or `escalate`, oldest first. */
function parentQuestions(items: Readonly<Record<string, ChildQuestion>>, childName?: string): [string, ChildQuestion][] {
  return Object.entries(items).filter(([, question]) => question.answer === null && question.closed !== true && question.routing?.kind === "parent"
    && (childName === undefined || question.childName === childName)).sort(([, a], [, b]) => a.askedAt - b.askedAt);
}

/** A `send` does not answer a waiting `ask_human`. Tell the parent which handle does. */
function openQuestionNote(questions: readonly [string, ChildQuestion][], name: string): string {
  if (questions.length === 0) return "";
  const handles = questions.map(([id]) => id).join(", ");
  return ` ${name} is still waiting on ${questions.length === 1 ? "question" : "questions"} ${handles}. This message does not answer it: call child_agent with action answer (name ${name}, questionId ${questions[0]?.[0] ?? ""}) or escalate.`;
}

type ChildResolution = { action: "answer"; name: string; questionId: string; answer: string; reason: string }
  | { action: "escalate"; questionId: string; kind: "irreversible" | "external" | "contradicts" | "stuck"; guess: string; why: string };

async function resolveChildQuestion(tx: Tx, parent: ConversationId, args: ChildResolution, receipt: string): Promise<string> {
  const items = (await tx.doc(Questions, parent)).items;
  const key = questionKey(items, args.questionId);
  const item = key === undefined ? undefined : items[key];
  if (key === undefined || item === undefined) {
    const open = parentQuestions(items, args.action === "answer" ? args.name : undefined).map(([id]) => id);
    throw new WorkflowError(404, `Child question ${args.questionId} not found. ${open.length === 0 ? "No question waits for you." : `Open questions: ${open.join(", ")}. Pass the whole handle, including q:.`}`);
  }
  args = { ...args, questionId: key };
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
  const retry = { attempt: checkpoint["retryAttempt"] ?? checkpoint["attempt"], max: 3, error: typeof checkpoint["error"] === "string" ? childModelDiagnostic(checkpoint["error"]) : checkpoint["error"], until: checkpoint["until"] };
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
    if (busy) return `Cannot spawn a shared writer: child ${name} is still busy in the same working directory. Use isolation: worktree or wait for ${name} to finish. A worktree does not protect files outside it: do not point two children at the same absolute paths.`;
  }
  return undefined;
}
