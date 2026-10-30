import { automatedInputRequestId, automatedInputSubmission } from "./durableAutomatedInputState.js";
import { mergeAutomatedContent } from "./durableInputContent.js";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { Context, JsonRepresentation } from "@earendil-works/chord";
import { AgentDoc, InboxDoc, LiveDoc, GenerationTask, CompactionTask, hook, configure, defineDoc, defineExtension, defineTask, type Conversation, type ConversationId, type Harness, type InputSubmissionDraft, type Submission, type Session, type TaskId, type Tx } from "@earendil-works/pi-durable";
import { MODEL_CHAIN_SWITCH_KIND } from "../../shared/apiTypes.js";
import { CHILD_MODEL_CONTINUE, childModelDiagnostic, childModelDiagnosticContext, hasUnsafeChildModelDiagnostic } from "../../shared/childModelDiagnostic.js";
import { modelKey, parseModelChoice, resolveModelChain } from "../../shared/modelChains.js";
import { CHILD_RETRY_DELAYS, planChildModelFailure, type ChainProgress, type ChildFailureAssessment } from "./childModelFailures.js";
import { claimModelRecovery, missingModelRun, recordFailedModelRun, type ModelRecoveryLedger } from "./modelChainRecovery.js";
import { recordModelChainFailure, selectAvailableChainEntry, type ModelChainRuntime } from "./modelChainFailures.js";

/* eslint-disable @typescript-eslint/consistent-type-definitions */
type ChainState = ModelRecoveryLedger & { tasks: Record<string, TaskId>; pending?: Record<string, { task: TaskId; content: JsonRepresentation<InputSubmissionDraft["content"]>; sealed?: true; whenBusy: "reject" | "steer" | "followUp" }>; recovery?: TaskId; wait?: { owner?: TaskId; from: string; error: string; until: number; to?: string } };
type TurnInput = { reference: string; requestId: string; content: InputSubmissionDraft["content"]; whenBusy: "reject" | "steer" | "followUp" };
type TurnState = { phase: "start" } | { phase: "observe"; owner: TaskId }
  | { phase: "deliver"; attempt: number; progress?: ChainProgress; run?: string }
  | { phase: "advance"; attempt: number; progress: ChainProgress; from: string; error: string; failure?: ChildFailureAssessment; to?: string; until?: number; run?: string };
/* eslint-enable @typescript-eslint/consistent-type-definitions */
export const SessionModelChain = defineDoc<{ reference?: string }>({ kind: "forgerie.session-model-chain", version: 1, scope: "conversation", history: "latest", fork: "current", initial: () => ({}) });
export const SessionChainTurns = defineDoc<ChainState>({ kind: "forgerie.session-chain-turns", version: 1, scope: "conversation", history: "latest", fork: "initial", initial: () => ({ tasks: {} }) });

/** A checkpoint owns each admission and switch. A restart reuses its receipt, never the original user message. */
function chainTurn(resolve: (id: ConversationId) => ModelChainRuntime) {
  return defineTask<TurnInput, TurnState, null>({ name: "forgerie.session-chain-turn", version: 1, initial: () => ({ phase: "start" }), phases: {
    start: async (task, runtime, ctx) => {
      const options = resolve(runtime.conversationId);
      const settings = await runtime.snapshot(AgentDoc, runtime.conversationId, ctx);
      let models: string[];
      try { models = resolveModelChain(task.input.reference, options.modelChains?.() ?? {}, settings?.thinkingLevel); }
      catch (error) {
        await runtime.commit(async tx => {
          const doc = await tx.doc(SessionChainTurns, runtime.conversationId);
          delete doc.pending?.[task.input.requestId]; clearRecovery(doc, task.id);
          return { status: "terminal", outcome: { status: "failed", error: { message: childModelDiagnostic(String(error)) } } };
        }, ctx);
        return;
      }
      const cooldowns = await options.modelCooldowns?.snapshot() ?? {};
      const selected = selectAvailableChainEntry(models, cooldowns, runtime.now(), runtime.models);
      await runtime.commit(async tx => {
        const doc = await tx.doc(SessionChainTurns, runtime.conversationId);
        if (doc.recovery !== undefined && doc.recovery !== task.id) return { status: "waiting", checkpoint: task.state.checkpoint, on: [doc.recovery], policy: "allSettled" };
        if (models.length > 1 && selected.exhausted) {
          const error = childModelDiagnostic(cooldowns[modelKey(selected.model)]?.reason ?? "All models are cooling");
          const until = runtime.now() + CHILD_RETRY_DELAYS[0];
          doc.recovery = task.id;
          doc.wait = { owner: task.id, from: modelKey(selected.model), to: modelKey(selected.model), error, until };
          return { status: "running", checkpoint: { phase: "advance", attempt: 0, progress: { failed: [], waited: [], budget: 1, exhausted: true }, from: modelKey(selected.model), to: selected.model, error, until } };
        }
        return { status: "running", checkpoint: { phase: "deliver", attempt: 0 } };
      }, ctx);
    },
    deliver: async (task, runtime, ctx) => {
      const state = task.state.checkpoint;
      const conversation = await runtime.conversation(runtime.conversationId, ctx);
      if (conversation === undefined) throw new Error("Missing chain session");
      const admission = { held: false, content: task.input.content };
      await runtime.commit(async tx => {
        const doc = await tx.doc(SessionChainTurns, runtime.conversationId);
        const owner = doc.recovery;
        if (owner === undefined || owner === task.id) {
          const pending = doc.pending !== undefined && Object.hasOwn(doc.pending, task.input.requestId) ? doc.pending[task.input.requestId] : undefined;
          if (state.attempt === 0 && pending !== undefined) {
            // Text/image parts have scalar fields. Detach their overlays before submitting outside this commit.
            admission.content = typeof pending.content === "string" ? pending.content : pending.content.map(part => ({ ...part }));
            pending.sealed = true;
          }
          return undefined;
        }
        admission.held = true;
        return { status: "waiting", checkpoint: state, on: [owner], policy: "allSettled" };
      }, ctx);
      if (admission.held) return;
      const requestId = state.attempt === 0 ? task.input.requestId : `chain:${String(task.id)}:${String(state.attempt)}`;
      if (state.run !== undefined) {
        const run = state.run;
        await runtime.commit(async tx => {
          const claim = (await tx.doc(SessionChainTurns, runtime.conversationId)).retryOwners?.[run];
          if (claim?.owner === task.id) claim.requestId = requestId;
        }, ctx);
      }
      let submission: Submission;
      try { submission = await conversation.submit({ type: "input", content: state.attempt === 0 ? admission.content : CHILD_MODEL_CONTINUE,
        whenBusy: state.attempt === 0 ? task.input.whenBusy : "followUp", requestId }, ctx); }
      catch (error) {
        if (runtime.signal.aborted) throw error;
        await runtime.commit(async tx => {
          const doc = await tx.doc(SessionChainTurns, runtime.conversationId);
          delete doc.pending?.[task.input.requestId]; clearRecovery(doc, task.id);
          return { status: "terminal", outcome: { status: "failed", error: { message: childModelDiagnostic(String(error)) } } };
        }, ctx);
        return;
      }
      if (state.attempt === 0) await runtime.commit(async tx => { delete (await tx.doc(SessionChainTurns, runtime.conversationId)).pending?.[task.input.requestId]; }, ctx);
      const settled = await submission.wait(ctx);
      const settings = await runtime.snapshot(AgentDoc, runtime.conversationId, ctx);
      const ledger = await runtime.snapshot(SessionChainTurns, runtime.conversationId, ctx);
      let current = ledger?.failureModels?.[String(settled.id)] ?? (settings?.model === undefined ? undefined : `${settings.model.provider}/${settings.model.modelId}`);
      let missingRun: string | undefined;
      let error = settled.status === "unanswered" && settled.detail !== undefined ? typeof settled.detail === "string" ? settled.detail : JSON.stringify(settled.detail) : undefined;
      if (settled.status === "unanswered" && settled.reason === "no_model") {
        await runtime.commit(async tx => {
          const failure = await missingModelRun(tx, runtime.conversationId, settled);
          if (failure === undefined) return;
          error = failure.error; current = failure.model; missingRun = `generation:${String(failure.generation)}`;
          await recordFailedModelRun(tx, await tx.doc(SessionChainTurns, runtime.conversationId), { conversationId: runtime.conversationId, generation: failure.generation, inputs: [settled.id], model: failure.model });
        }, ctx);
      }
      if (settled.status === "unanswered" && (settled.reason === "model_error" || settled.reason === "no_model") && current !== undefined && error !== undefined) {
        const from = current;
        const recovery = { delegated: false };
        let run = state.run ?? ledger?.failureRuns?.[String(settled.id)] ?? missingRun ?? `input:${String(settled.id)}`;
        await runtime.commit(async tx => {
          const doc = await tx.doc(SessionChainTurns, runtime.conversationId);
          run = doc.failureRuns?.[String(settled.id)] ?? run;
          const claim = claimModelRecovery(doc, run, { owner: task.id, conversationId: runtime.conversationId, requestId });
          if (claim.owner !== task.id) {
            recovery.delegated = true;
            return { status: "running", checkpoint: { phase: "observe", owner: claim.owner } };
          }
          doc.recovery = task.id;
          return undefined;
        }, ctx);
        if (recovery.delegated) return;
        const options = resolve(runtime.conversationId);
        const { assessment, diagnostic, cooldowns } = await recordModelChainFailure(options, from, error, runtime.now(), cause => { runtime.report(cause); });
        let models: string[] = [];
        try { models = resolveModelChain(task.input.reference, options.modelChains?.() ?? {}, settings?.thinkingLevel); }
        catch (cause) { runtime.report(cause); }
        const plan = models.length === 0 ? { kind: "report" as const } : planChildModelFailure({ models, current: from, error, now: runtime.now(), cooldowns, assessment, attempt: state.attempt, ...(state.progress === undefined ? {} : { progress: state.progress }) });
        if (plan.kind !== "report") {
          await runtime.commit(async tx => {
            // A manual plain-model selection ends the chain, including a pending wait.
            const doc = await tx.doc(SessionChainTurns, runtime.conversationId);
            if ((await tx.doc(SessionModelChain, runtime.conversationId)).reference !== task.input.reference) { clearRecovery(doc, task.id); return { status: "terminal", outcome: { status: "completed", result: null } }; }
            const until = plan.delay === undefined ? undefined : runtime.now() + plan.delay;
            if (until !== undefined) doc.wait = { owner: task.id, from, error: diagnostic, until, ...(plan.kind === "switch" ? { to: modelKey(plan.to) } : {}) };
            return { status: "running", checkpoint: { phase: "advance", attempt: state.attempt + 1, progress: plan.progress, run, from, error: diagnostic, failure: assessment,
              ...(plan.kind === "switch" ? { to: plan.to } : {}), ...(until === undefined ? {} : { until }) } };
          }, ctx);
          return;
        }
      }
      await runtime.commit(async tx => { clearRecovery(await tx.doc(SessionChainTurns, runtime.conversationId), task.id); return { status: "terminal", outcome: { status: "completed", result: null } }; }, ctx);
    },
    observe: async (task, runtime, ctx) => {
      const owner = await runtime.waitForTask(task.state.checkpoint.owner, ctx);
      const outcome = owner.state.outcome;
      await runtime.commit(() => ({ status: "terminal", outcome: outcome.status === "completed" ? { status: "completed", result: null }
        : outcome.status === "failed" || outcome.status === "faulted" ? { status: outcome.status, error: outcome.error }
        : outcome.status === "orphaned" ? { status: "orphaned", reason: outcome.reason }
        : { status: "aborted", ...(outcome.reason === undefined ? {} : { reason: outcome.reason }) } }), ctx);
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
          clearWait(doc, task.id);
          if ((await tx.doc(SessionModelChain, runtime.conversationId)).reference !== task.input.reference) { clearRecovery(doc, task.id); return { status: "terminal", outcome: { status: "completed", result: null } }; }
          let target = state.to;
          let progress = state.progress;
          // Another session can cool a target while this task waits or the daemon restarts.
          // Exhaustion probes remain pinned to their admitted model and finite budget.
          if (target !== undefined && progress.exhausted !== true) {
            let models: string[] = [];
            try { models = resolveModelChain(task.input.reference, selected.modelChains?.() ?? {}); }
            catch (cause) { runtime.report(cause); }
            const plan = models.length === 0 ? { kind: "report" as const } : planChildModelFailure({ models, current: state.from, error: state.error, ...(state.failure === undefined ? {} : { assessment: state.failure }),
              now: runtime.now(), cooldowns, progress, attempt: state.attempt - 1 });
            if (plan.kind === "report") { clearRecovery(doc, task.id); return { status: "terminal", outcome: { status: "completed", result: null } }; }
            progress = plan.progress;
            if (plan.delay !== undefined) {
              const until = runtime.now() + plan.delay;
              doc.wait = { owner: task.id, from: state.from, error: state.error, until, ...(plan.kind === "switch" ? { to: modelKey(plan.to) } : {}) };
              return { status: "running", checkpoint: { phase: "advance", attempt: state.attempt, from: state.from, error: state.error, ...(state.failure === undefined ? {} : { failure: state.failure }),
                progress, until, ...(state.run === undefined ? {} : { run: state.run }), ...(plan.kind === "switch" ? { to: plan.to } : {}) } };
            }
            if (plan.kind === "switch") target = plan.to;
          }
          if (target !== undefined) {
            const choice = parseModelChoice(target);
            if (choice === null) throw new Error("Invalid chain entry");
            await configure(tx, runtime.conversationId, { model: choice.model, ...(choice.thinkingLevel === undefined ? {} : { thinkingLevel: choice.thinkingLevel }) });
            if (modelKey(target) !== state.from) await tx.appendEntry(runtime.conversationId, { kind: MODEL_CHAIN_SWITCH_KIND, data: { from: state.from, to: modelKey(target), error: childModelDiagnostic(state.error) } });
          }
          return { status: "running", checkpoint: { phase: "deliver", attempt: state.attempt, progress, ...(state.run === undefined ? {} : { run: state.run }) } };
        }, ctx);
        if (busy === undefined) return;
        await runtime.waitForTask(busy, ctx);
      }
    },
  }, abort: async (task, runtime, ctx) => runtime.commit(async tx => {
    const doc = await tx.doc(SessionChainTurns, runtime.conversationId);
    await withdrawPending(tx, runtime.conversationId, doc, task.input.requestId);
    clearRecovery(doc, task.id);
    return { status: "terminal", outcome: { status: "aborted" } };
  }, ctx) });
}

export const SESSION_MODEL_CHAIN_EXTENSION = "forgerie.session-model-chains";

export function modelChainExtension(resolve: (id: ConversationId) => ModelChainRuntime & Pick<Session, "commit">) {
  return defineExtension({ name: SESSION_MODEL_CHAIN_EXTENSION, tasks: [chainTurn(resolve)], hooks: [hook(GenerationTask, {
    beforeRequest: async (request, api, ctx) => (await api.snapshot(SessionModelChain, api.conversationId, ctx))?.reference === undefined ? undefined : { messages: childModelDiagnosticContext(request.messages) },
    afterResponse: async (message, api, ctx) => {
      if (message.stopReason !== "error") return;
      await resolve(api.conversationId).commit(async tx => {
        if ((await tx.doc(SessionModelChain, api.conversationId)).reference === undefined) return;
        const live = (await tx.doc(LiveDoc, api.conversationId)).run;
        if (live?.taskId !== api.taskId) return;
        await recordFailedModelRun(tx, await tx.doc(SessionChainTurns, api.conversationId), { conversationId: api.conversationId, generation: api.taskId, inputs: live.inputs, model: `${message.provider}/${message.model}` });
      }, ctx);
    },
  }), hook(CompactionTask, { beforeCompact: async (request, api, ctx) => {
    if ((await api.snapshot(SessionModelChain, api.conversationId, ctx))?.reference === undefined) return undefined;
    const decision = { decline: false };
    await resolve(api.conversationId).commit(async tx => {
      const provider = (await tx.doc(AgentDoc, api.conversationId)).model?.provider;
      if (provider === undefined) return;
      const fallbacks: { from: string; to: string }[] = [];
      let cursor;
      do {
        const page = await tx.scanEntries({ conversationId: api.conversationId }, 100, cursor);
        for (const entry of page.items) {
          if (entry.kind !== MODEL_CHAIN_SWITCH_KIND) continue;
          const data = entry.data;
          if (data !== null && typeof data === "object" && !Array.isArray(data) && typeof data["from"] === "string" && typeof data["to"] === "string") fallbacks.push({ from: data["from"], to: data["to"] });
        }
        cursor = page.next;
      } while (cursor !== undefined);
      decision.decline = hasUnsafeChildModelDiagnostic({ ...request, provider, fallbacks });
    }, ctx);
    return decision.decline ? { decline: true } : undefined;
  } })] });
}

const ChainTurn = chainTurn(() => ({}));

async function prepareTurn(tx: Tx, conversationId: ConversationId, reference: string, input: Omit<TurnInput, "reference">): Promise<{ id: TaskId; ownsInput: boolean }> {
  input = { ...input, requestId: await automatedInputRequestId(tx, conversationId, input.requestId) };
  const doc = await tx.doc(SessionChainTurns, conversationId);
  const existing = Object.hasOwn(doc.tasks, input.requestId) ? doc.tasks[input.requestId] : undefined;
  if (existing !== undefined) return { id: existing, ownsInput: true };
  if (input.whenBusy === "reject" && doc.recovery !== undefined) throw new Error("Stop the pending model-chain recovery before sending another message");
  if (input.whenBusy === "steer" && doc.recovery === undefined && doc.wait === undefined) for (const id of Object.values(doc.tasks)) {
    const task = await tx.task(id);
    if (task !== undefined && task.state.status !== "terminal") return { id, ownsInput: false };
  }
  // The registry supplies the family-routed implementation; this token owns only the durable task identity.
  const id = await tx.createTask(ChainTurn, { ...input, reference }, { conversationId, ownership: { kind: "conversation" }, background: true });
  doc.tasks = { ...doc.tasks, [input.requestId]: id };
  doc.pending = { ...doc.pending, [input.requestId]: { task: id, content: input.content, whenBusy: input.whenBusy } };
  return { id, ownsInput: true };
}

export function prepareChainTurn(conversation: Conversation, reference: string, input: Omit<TurnInput, "reference">): Promise<{ id: TaskId; ownsInput: boolean }> {
  return conversation.commit(tx => prepareTurn(tx, conversation.id, reference, input), context);
}

interface ChainAdmission {
  snapshot: Harness["snapshot"];
  watchDoc: Harness["watchDoc"];
  waitForTask: Harness["waitForTask"];
  commit(change: (tx: Tx) => Promise<undefined>, context: Context): Promise<unknown>;
}
/** Stage the intent without blocking an outbox's serial admission line behind a provider wait. */
export async function stageModelChainInput(api: ChainAdmission, conversationId: ConversationId, input: Omit<TurnInput, "reference">, ctx: Context): Promise<{ id: TaskId; ownsInput: boolean } | undefined> {
  if ((await api.snapshot(SessionModelChain, conversationId, ctx))?.reference === undefined) return undefined;
  const admitted: { turn?: { id: TaskId; ownsInput: boolean } } = {};
  await api.commit(async tx => {
    const reference = (await tx.doc(SessionModelChain, conversationId)).reference;
    if (reference !== undefined) admitted.turn = await prepareTurn(tx, conversationId, reference, input);
    return undefined;
  }, ctx);
  return admitted.turn;
}

/** Human chain intents stay separate; automated inputs join their representative intent across them. */
export async function batchModelChainInput(tx: Tx, id: ConversationId, requestId: string, content: InputSubmissionDraft["content"], whenBusy: "steer" | "followUp" = "followUp"): Promise<"appended" | "hold" | "native" | "sealed"> {
  const doc = await tx.doc(SessionChainTurns, id);
  if (await tx.submissionByRequest(id, requestId) !== undefined) return "native";
  const pending = doc.pending?.[requestId];
  if (pending?.sealed === true) return "sealed";
  if (pending?.whenBusy !== whenBusy) return doc.recovery === undefined ? "native" : "hold";
  pending.content = mergeAutomatedContent(pending.content, content);
  return "appended";
}

/** Durable outboxes also start main turns. Only the task may admit a held input on its stable request ID. */
export async function prepareModelChainInput(api: ChainAdmission, conversationId: ConversationId, input: Omit<TurnInput, "reference">, ctx: Context): Promise<void> {
  await api.commit(async tx => { input = { ...input, requestId: await automatedInputRequestId(tx, conversationId, input.requestId) }; return undefined; }, ctx);
  const turn = await stageModelChainInput(api, conversationId, input, ctx);
  if (turn?.ownsInput !== true) return;
  const watch = await api.watchDoc(SessionChainTurns, conversationId, ctx);
  if (watch === undefined) throw new Error("Missing model-chain admissions");
  let admitted!: () => void;
  const ready = new Promise<void>(resolve => { admitted = resolve; });
  const observe = (value: typeof watch.value) => { if (value?.pending === undefined || !Object.hasOwn(value.pending, input.requestId)) admitted(); };
  watch.start(value => { observe(value); return Promise.resolve(); }); observe(watch.value);
  try {
    await Promise.race([ready, api.waitForTask(turn.id, ctx).then(task => {
      if (task.state.outcome.status === "failed" || task.state.outcome.status === "faulted") throw new Error(task.state.outcome.error.message);
    }), watch.closed.then(() => { throw new Error("Model-chain admission watch closed"); })]);
    const receipt = { exists: false };
    await api.commit(async tx => { receipt.exists = await tx.submissionByRequest(conversationId, input.requestId) !== undefined; return undefined; }, ctx);
    if (!receipt.exists) {
      const task = await api.waitForTask(turn.id, ctx);
      throw new Error(task.state.outcome.status === "failed" || task.state.outcome.status === "faulted" ? task.state.outcome.error.message : "Model-chain input ended before admission");
    }
  } finally { await watch.stop(); }
}

/** Wait for the task-owned admission, not a second submit that could race a busy rejection. */
export async function chainTurnSubmission(harness: Harness, conversation: Conversation, requestId: string, turn: TaskId): Promise<Submission> {
  let wake: (() => void) | undefined;
  const off = harness.subscribeCommits(() => { wake?.(); });
  const terminal = harness.waitForTask(turn, context);
  try {
    for (;;) {
      const changed = new Promise<void>(resolve => { wake = resolve; });
      const record = await conversation.commit(tx => automatedInputSubmission(tx, conversation.id, requestId), context);
      if (record !== undefined) {
        const submission = await harness.submission(record.id, context);
        if (submission === undefined) throw new Error("Missing model-chain submission");
        return submission;
      }
      const progress = await Promise.race([changed.then(() => undefined), terminal]);
      if (progress !== undefined) {
        // Check the receipt once more: admission and terminal completion can share an observer turn.
        const receipt = await conversation.commit(tx => automatedInputSubmission(tx, conversation.id, requestId), context);
        if (receipt !== undefined) continue;
        throw new Error(progress.state.outcome.status === "failed" ? progress.state.outcome.error.message : "Model-chain input was cancelled before admission");
      }
    }
  } finally { off(); void terminal.catch(() => undefined); }
}

function clearWait(doc: ChainState, owner: TaskId): void {
  // Older checkpoints have no owner; their recovery task is the only pending wait.
  if (doc.wait?.owner === owner || (doc.wait !== undefined && doc.wait.owner === undefined && (doc.recovery === undefined || doc.recovery === owner))) delete doc.wait;
}
function clearRecovery(doc: ChainState, owner: TaskId): void {
  clearWait(doc, owner);
  if (doc.recovery === owner) delete doc.recovery;
}
async function withdrawPending(tx: Tx, conversationId: ConversationId, doc: ChainState, requestId: string): Promise<boolean> {
  if (doc.pending === undefined || !Object.hasOwn(doc.pending, requestId)) return false;
  // A held input has not reached the native inbox. Give it Stop's ordinary aborted receipt, without
  // calling the cooling model. A receipt which crossed into placement already owns a live turn.
  const receipt = await tx.submissionByRequest(conversationId, requestId);
  if (receipt === undefined) await tx.createSubmission({ conversationId, requestId, type: "input", status: "unanswered", reason: "aborted" });
  else if (receipt.status === "queued") {
    tx.settleSubmission(receipt.id, { status: "unanswered", reason: "aborted" });
    const inbox = await tx.doc(InboxDoc, conversationId);
    inbox.items = inbox.items.filter(item => item.id !== receipt.id);
  }
  Reflect.deleteProperty(doc.pending, requestId);
  return receipt === undefined || receipt.status === "queued";
}
export async function cancelHeldChainInputs(harness: Harness, id: ConversationId, ctx: Context, selected?: readonly TaskId[]): Promise<void> {
  const tasks: TaskId[] = [];
  await harness.commit(async tx => {
    const doc = await tx.doc(SessionChainTurns, id);
    for (const [requestId, pending] of Object.entries(doc.pending ?? {})) {
      if (selected !== undefined && !selected.includes(pending.task)) continue;
      if (await withdrawPending(tx, id, doc, requestId)) tasks.push(pending.task);
    }
  }, ctx);
  for (const task of tasks) await harness.abortTask(task, ctx);
}
export async function cancelChainTurns(harness: Harness, id: ConversationId, ctx: Context): Promise<void> {
  const doc = await harness.snapshot(SessionChainTurns, id, ctx);
  if (doc === undefined) return;
  await cancelHeldChainInputs(harness, id, ctx);
  for (const task of Object.values(doc.tasks)) await harness.abortTask(task, ctx);
  await harness.commit(async tx => { const state = await tx.doc(SessionChainTurns, id); delete state.wait; delete state.recovery; }, ctx);
}

/** Pending task intents have no native inbox receipt yet. Do not count an admission twice during its handoff. */
export async function heldChainInputs(tx: Tx, id: ConversationId): Promise<{ task: TaskId; kind: "steer" | "followUp"; text: string }[]> {
  const doc = await tx.doc(SessionChainTurns, id);
  const result: { task: TaskId; kind: "steer" | "followUp"; text: string }[] = [];
  for (const [requestId, pending] of Object.entries(doc.pending ?? {})) {
    if (await tx.submissionByRequest(id, requestId) !== undefined) continue;
    result.push({ task: pending.task, kind: pending.whenBusy === "steer" ? "steer" : "followUp", text: typeof pending.content === "string" ? pending.content : pending.content.flatMap(part => part.type === "text" ? [part.text] : []).join("\n") });
  }
  return result;
}
