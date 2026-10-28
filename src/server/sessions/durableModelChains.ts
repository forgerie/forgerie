import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { Context } from "@earendil-works/chord";
import { AgentDoc, LiveDoc, GenerationTask, configure, defineDoc, defineExtension, defineTask, type Conversation, type ConversationId, type Harness, type InputSubmissionDraft, type Submission, type TaskId, type Tx } from "@earendil-works/pi-durable";
import { MODEL_CHAIN_SWITCH_KIND } from "../../shared/apiTypes.js";
import { CHILD_MODEL_CONTINUE, childModelDiagnostic } from "../../shared/childModelDiagnostic.js";
import { modelKey, parseModelChoice, resolveModelChain } from "../../shared/modelChains.js";
import { planChildModelFailure, unavailableChildModel, type ChainProgress, type ChildFailureAssessment } from "./childModelFailures.js";
import { recordModelChainFailure, type ModelChainRuntime } from "./modelChainFailures.js";

/* eslint-disable @typescript-eslint/consistent-type-definitions */
type ChainState = { tasks: Record<string, TaskId>; wait?: { from: string; error: string; until: number; to?: string } };
type TurnInput = { reference: string; requestId: string; content: InputSubmissionDraft["content"]; whenBusy: "reject" | "steer" | "followUp" };
type TurnState = { phase: "deliver"; attempt: number; progress?: ChainProgress }
  | { phase: "advance"; attempt: number; progress: ChainProgress; from: string; error: string; failure: ChildFailureAssessment; to?: string; until?: number };
/* eslint-enable @typescript-eslint/consistent-type-definitions */
export const SessionModelChain = defineDoc<{ reference?: string }>({ kind: "forgerie.session-model-chain", version: 1, scope: "conversation", history: "latest", fork: "current", initial: () => ({}) });
export const SessionChainTurns = defineDoc<ChainState>({ kind: "forgerie.session-chain-turns", version: 1, scope: "conversation", history: "latest", fork: "initial", initial: () => ({ tasks: {} }) });

/** A checkpoint owns each admission and switch. A restart reuses its receipt, never the original user message. */
function chainTurn(resolve: (id: ConversationId) => ModelChainRuntime) {
  return defineTask<TurnInput, TurnState, null>({ name: "forgerie.session-chain-turn", version: 1, initial: () => ({ phase: "deliver", attempt: 0 }), phases: {
    deliver: async (task, runtime, ctx) => {
      const state = task.state.checkpoint;
      const conversation = await runtime.conversation(runtime.conversationId, ctx);
      if (conversation === undefined) throw new Error("Missing chain session");
      const submission = await conversation.submit({ type: "input", content: state.attempt === 0 ? task.input.content : CHILD_MODEL_CONTINUE,
        whenBusy: state.attempt === 0 ? task.input.whenBusy : "followUp", requestId: state.attempt === 0 ? task.input.requestId : `chain:${String(task.id)}:${String(state.attempt)}` }, ctx);
      const settled = await submission.wait(ctx);
      const settings = await runtime.snapshot(AgentDoc, runtime.conversationId, ctx);
      const current = settings?.model === undefined ? undefined : `${settings.model.provider}/${settings.model.modelId}`;
      let error = settled.status === "unanswered" && settled.detail !== undefined ? typeof settled.detail === "string" ? settled.detail : JSON.stringify(settled.detail) : undefined;
      if (settled.status === "unanswered" && settled.reason === "no_model") {
        await runtime.commit(async tx => {
          const generation = (await tx.scanTasks({ conversationId: runtime.conversationId, kind: GenerationTask.definition.name, status: "terminal", order: "descending" }, 1)).items[0];
          if (generation?.state.status === "terminal" && generation.state.outcome.status === "failed" && unavailableChildModel(generation.state.outcome.error.message) === current) error = generation.state.outcome.error.message;
        }, ctx);
      }
      if (settled.status === "unanswered" && (settled.reason === "model_error" || settled.reason === "no_model") && current !== undefined && error !== undefined) {
        const options = resolve(runtime.conversationId);
        const { assessment, diagnostic, cooldowns } = await recordModelChainFailure(options, current, error, runtime.now(), cause => { runtime.report(cause); });
        let models: string[] = [];
        try { models = resolveModelChain(task.input.reference, options.modelChains?.() ?? {}, settings?.thinkingLevel); }
        catch (cause) { runtime.report(cause); }
        const plan = models.length === 0 ? { kind: "report" as const } : planChildModelFailure({ models, current, error, now: runtime.now(), cooldowns, assessment, attempt: state.attempt, ...(state.progress === undefined ? {} : { progress: state.progress }) });
        if (plan.kind !== "report") {
          await runtime.commit(async tx => {
            // A manual plain-model selection ends the chain, including a pending wait.
            const doc = await tx.doc(SessionChainTurns, runtime.conversationId);
            if ((await tx.doc(SessionModelChain, runtime.conversationId)).reference !== task.input.reference) return { status: "terminal", outcome: { status: "completed", result: null } };
            const until = plan.delay === undefined ? undefined : runtime.now() + plan.delay;
            if (until !== undefined) doc.wait = { from: current, error: diagnostic, until, ...(plan.kind === "switch" ? { to: modelKey(plan.to) } : {}) };
            return { status: "running", checkpoint: { phase: "advance", attempt: state.attempt + 1, progress: plan.progress, from: current, error: diagnostic, failure: assessment,
              ...(plan.kind === "switch" ? { to: plan.to } : {}), ...(until === undefined ? {} : { until }) } };
          }, ctx);
          return;
        }
      }
      await runtime.commit(async tx => { delete (await tx.doc(SessionChainTurns, runtime.conversationId)).wait; return { status: "terminal", outcome: { status: "completed", result: null } }; }, ctx);
    },
    advance: async (task, runtime, ctx) => {
      const state = task.state.checkpoint;
      if (state.until !== undefined) await runtime.sleep(state.until, ctx);
      for (;;) {
        const selected = resolve(runtime.conversationId);
        const cooldowns = await selected.modelCooldowns?.snapshot() ?? {};
        let busy: TaskId | undefined;
        await runtime.commit(async tx => {
          busy = (await tx.doc(LiveDoc, runtime.conversationId)).run?.taskId;
          if (busy !== undefined) return undefined;
          const doc = await tx.doc(SessionChainTurns, runtime.conversationId);
          delete doc.wait;
          if ((await tx.doc(SessionModelChain, runtime.conversationId)).reference !== task.input.reference) return { status: "terminal", outcome: { status: "completed", result: null } };
          let target = state.to;
          let progress = state.progress;
          // Another session can cool a target while this task waits or the daemon restarts.
          // Exhaustion probes remain pinned to their admitted model and finite budget.
          if (target !== undefined && progress.exhausted !== true) {
            let models: string[] = [];
            try { models = resolveModelChain(task.input.reference, selected.modelChains?.() ?? {}); }
            catch (cause) { runtime.report(cause); }
            const plan = models.length === 0 ? { kind: "report" as const } : planChildModelFailure({ models, current: state.from, error: state.error, assessment: state.failure,
              now: runtime.now(), cooldowns, progress, attempt: state.attempt - 1 });
            if (plan.kind === "report") return { status: "terminal", outcome: { status: "completed", result: null } };
            progress = plan.progress;
            if (plan.delay !== undefined) {
              const until = runtime.now() + plan.delay;
              doc.wait = { from: state.from, error: state.error, until, ...(plan.kind === "switch" ? { to: modelKey(plan.to) } : {}) };
              return { status: "running", checkpoint: { phase: "advance", attempt: state.attempt, from: state.from, error: state.error, failure: state.failure,
                progress, until, ...(plan.kind === "switch" ? { to: plan.to } : {}) } };
            }
            if (plan.kind === "switch") target = plan.to;
          }
          if (target !== undefined) {
            const choice = parseModelChoice(target);
            if (choice === null) throw new Error("Invalid chain entry");
            await configure(tx, runtime.conversationId, { model: choice.model, ...(choice.thinkingLevel === undefined ? {} : { thinkingLevel: choice.thinkingLevel }) });
            if (modelKey(target) !== state.from) await tx.appendEntry(runtime.conversationId, { kind: MODEL_CHAIN_SWITCH_KIND, data: { from: state.from, to: modelKey(target), error: childModelDiagnostic(state.error) } });
          }
          return { status: "running", checkpoint: { phase: "deliver", attempt: state.attempt, progress } };
        }, ctx);
        if (busy === undefined) return;
        await runtime.waitForTask(busy, ctx);
      }
    },
  }, abort: async (_task, runtime, ctx) => runtime.commit(async tx => {
    delete (await tx.doc(SessionChainTurns, runtime.conversationId)).wait;
    return { status: "terminal", outcome: { status: "aborted" } };
  }, ctx) });
}

export const SESSION_MODEL_CHAIN_EXTENSION = "forgerie.session-model-chains";

export function modelChainExtension(resolve: (id: ConversationId) => ModelChainRuntime) {
  return defineExtension({ name: SESSION_MODEL_CHAIN_EXTENSION, tasks: [chainTurn(resolve)] });
}

const ChainTurn = chainTurn(() => ({}));

async function prepareTurn(tx: Tx, conversationId: ConversationId, reference: string, input: Omit<TurnInput, "reference">): Promise<{ id: TaskId; ownsInput: boolean }> {
  const doc = await tx.doc(SessionChainTurns, conversationId);
  const existing = Object.hasOwn(doc.tasks, input.requestId) ? doc.tasks[input.requestId] : undefined;
  if (existing !== undefined) return { id: existing, ownsInput: true };
  if (input.whenBusy === "steer") for (const id of Object.values(doc.tasks)) {
    const task = await tx.task(id);
    if (task !== undefined && task.state.status !== "terminal") return { id, ownsInput: false };
  }
  // The registry supplies the family-routed implementation; this token owns only the durable task identity.
  const id = await tx.createTask(ChainTurn, { ...input, reference }, { conversationId, ownership: { kind: "conversation" }, background: true });
  doc.tasks = { ...doc.tasks, [input.requestId]: id };
  return { id, ownsInput: true };
}

export function prepareChainTurn(conversation: Conversation, reference: string, input: Omit<TurnInput, "reference">): Promise<{ id: TaskId; ownsInput: boolean }> {
  return conversation.commit(tx => prepareTurn(tx, conversation.id, reference, input), context);
}

interface ChainAdmission {
  snapshot: Harness["snapshot"];
  commit(change: (tx: Tx) => Promise<undefined>, context: Context): Promise<unknown>;
}
/** Durable outboxes also start main turns. Attach fallback before admitting their stable request ID. */
export async function prepareModelChainInput(api: ChainAdmission, conversationId: ConversationId, input: Omit<TurnInput, "reference">, ctx: Context): Promise<void> {
  if ((await api.snapshot(SessionModelChain, conversationId, ctx))?.reference === undefined) return;
  await api.commit(async tx => {
    const reference = (await tx.doc(SessionModelChain, conversationId)).reference;
    if (reference !== undefined) await prepareTurn(tx, conversationId, reference, input);
    return undefined;
  }, ctx);
}

/** Wait for the task-owned admission, not a second submit that could race a busy rejection. */
export async function chainTurnSubmission(harness: Harness, conversation: Conversation, requestId: string, turn: TaskId): Promise<Submission> {
  let wake: (() => void) | undefined;
  const off = harness.subscribeCommits(() => { wake?.(); });
  const terminal = harness.waitForTask(turn, context);
  try {
    for (;;) {
      const changed = new Promise<void>(resolve => { wake = resolve; });
      const record = await conversation.commit(tx => tx.submissionByRequest(conversation.id, requestId), context);
      if (record !== undefined) {
        const submission = await harness.submission(record.id, context);
        if (submission === undefined) throw new Error("Missing model-chain submission");
        return submission;
      }
      const progress = await Promise.race([changed.then(() => undefined), terminal]);
      if (progress !== undefined) {
        // Check the receipt once more: admission and terminal completion can share an observer turn.
        const receipt = await conversation.commit(tx => tx.submissionByRequest(conversation.id, requestId), context);
        if (receipt !== undefined) continue;
        throw new Error(progress.state.outcome.status === "failed" ? progress.state.outcome.error.message : "Model-chain input was cancelled before admission");
      }
    }
  } finally { off(); void terminal.catch(() => undefined); }
}

export async function cancelChainTurns(harness: Harness, id: ConversationId, ctx: Context): Promise<void> {
  const doc = await harness.snapshot(SessionChainTurns, id, ctx);
  for (const task of Object.values(doc?.tasks ?? {})) await harness.abortTask(task, ctx);
  await harness.commit(async tx => { delete (await tx.doc(SessionChainTurns, id)).wait; }, ctx);
}
