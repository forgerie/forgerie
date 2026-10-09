/**
 * SPIKE (spike/durable-child). Durable-native child agents inside a Forgerie session.
 *
 * A child is an ordinary Durable conversation in the parent session's own storage. A background anchor task of the
 * parent conversation owns it, so the parent's Esc does not reach it, and its work survives a restart with the parent's
 * storage. A child asks the user through a write entry in the parent: the parent model gets no turn.
 *
 * Pattern from pi-durable test/examples/23-subagent-background.ts. Not production code.
 */
import { setTimeout as sleep } from "node:timers/promises";
import type { Context } from "@earendil-works/chord";
import { Type, type AssistantMessage } from "@earendil-works/pi-ai";
import {
  AssistantEntry, LiveDoc, configure, defineDoc, defineExtension, defineTask, defineTool,
  type Conversation, type ConversationId, type EntryId, type Extension, type Harness, type TaskId, type Tx,
} from "@earendil-works/pi-durable";

export const CHILD_QUESTION_KIND = "forgerie.child-question";
export const CHILD_ANSWER_KIND = "forgerie.child-answer";

type ChildRecord = { conversationId: ConversationId; reported: EntryId[] };
type ChildQuestion = { child: ConversationId; childName: string; question: string; answer: string | null; askedAt: number };

const Children = defineDoc<{ agents: Record<string, ChildRecord>; reporters: Record<string, TaskId> }>({
  kind: "forgerie.durable-children", version: 1, scope: "conversation", history: "latest", fork: "initial",
  initial: () => ({ agents: {}, reporters: {} }),
});
const Questions = defineDoc<{ items: Record<string, ChildQuestion> }>({
  kind: "forgerie.child-questions", version: 1, scope: "conversation", history: "latest", fork: "initial",
  initial: () => ({ items: {} }),
});

const textOf = (message: AssistantMessage | undefined): string =>
  (message?.content ?? []).flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");

const Anchor = defineTask<null, { phase: "done" }, null>({
  name: "forgerie.child-anchor", version: 1, initial: () => ({ phase: "done" }),
  phases: { done: (_task, runtime, context) => runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), context) },
  abort: (_task, runtime, context) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});

type ReporterInput = { name: string; conversationId: ConversationId; message: string; followUp: boolean };
type ReporterState = { phase: "deliver" } | { phase: "report"; report?: string };
const Reporter = defineTask<ReporterInput, ReporterState, null>({
  name: "forgerie.child-reporter", version: 1, initial: () => ({ phase: "deliver" }),
  phases: {
    deliver: async (reporter, runtime, context) => {
      const { name, conversationId, message, followUp } = reporter.input;
      const child = await runtime.conversation(conversationId, context);
      if (child === undefined) throw new Error(`Child conversation ${String(conversationId)} is missing`);
      const submission = await child.submit({ type: "input", content: message, whenBusy: followUp ? "followUp" : "steer", requestId: `child:${String(reporter.id)}` }, context);
      const settled = await submission.wait(context);
      await runtime.commit(async (tx) => {
        const next = (report?: string): { status: "running"; checkpoint: ReporterState } => ({ status: "running", checkpoint: report === undefined ? { phase: "report" } : { phase: "report", report } });
        if (settled.status === "unanswered") return next(settled.reason === "aborted" ? undefined : `[subagent ${name} failed: ${settled.reason}]`);
        if (settled.type !== "input") return next();
        const agent = (await tx.doc(Children, runtime.conversationId)).agents[name];
        if (agent === undefined || agent.reported.includes(settled.answer)) return next();
        agent.reported.push(settled.answer);
        const answer = (await tx.entry(AssistantEntry, settled.answer))?.model?.[0] as AssistantMessage | undefined;
        return next(`[subagent ${name} answered, no reply needed] ${textOf(answer)}`);
      }, context);
    },
    report: async (reporter, runtime, context) => {
      const report = reporter.state.checkpoint.phase === "report" ? reporter.state.checkpoint.report : undefined;
      if (report !== undefined) {
        const main = await runtime.conversation(runtime.conversationId, context);
        await main?.submit({ type: "input", content: report, whenBusy: "followUp", requestId: `child-report:${String(reporter.id)}` }, context);
      }
      await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), context);
    },
  },
  abort: (_task, runtime, context) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});

async function parentOf(api: { conversationId: ConversationId; commit<T>(change: (tx: Tx) => T | Promise<T>, context: Context): Promise<T> }, context: Context): Promise<ConversationId> {
  const parent = await api.commit(async (tx) => (await tx.conversation(api.conversationId))?.owner?.conversationId, context);
  if (parent === undefined) throw new Error("This conversation has no parent to ask");
  return parent;
}

/** A child's only way to reach the human. Named apart from Forgerie's ask_user so the parent's tool is not replaced. */
const askHumanTool = defineTool({
  name: "ask_human",
  description: "Ask the human user a question and wait for the answer. Use only when you are blocked.",
  parameters: Type.Object({ question: Type.String() }),
  // A rerun finds the same question by the call's task id, so it never asks twice.
  replay: "safe",
  execute: async (args, api, context) => {
    const parentId = await parentOf(api, context);
    const questionId = `q:${String(api.taskId)}`;
    // One commit records the question and appends its transcript entry, so a rerun after a crash finds both or neither.
    // ConversationHandle.submit only types inputs, so the entry is appended directly; it has no model part.
    await api.commit(async (tx) => {
      const doc = await tx.doc(Questions, parentId);
      if (doc.items[questionId] !== undefined) return;
      const agents = (await tx.doc(Children, parentId)).agents;
      const childName = Object.entries(agents).find(([, agent]) => agent.conversationId === api.conversationId)?.[0] ?? "subagent";
      doc.items[questionId] = { child: api.conversationId, childName, question: args.question, answer: null, askedAt: Date.now() };
      await tx.appendEntry(parentId, { kind: CHILD_QUESTION_KIND, data: { questionId, child: api.conversationId, childName, question: args.question } });
    }, context);
    for (;;) {
      const answer = (await api.snapshot(Questions, parentId, context))?.items[questionId]?.answer;
      if (typeof answer === "string") return { content: [{ type: "text" as const, text: `The user answered: ${answer}` }] };
      await sleep(150);
    }
  },
});

export interface DurableChildAgentsOptions {
  /** Tools every child gets in addition to ask_human. The spike passes a test tool; real children need a loadout. */
  childTools?: readonly ReturnType<typeof defineTool>[];
}

export interface DurableChildExtensions {
  /** Installed and selected for the parent. */
  parent: readonly Extension[];
  /** Installed for task definitions and children; removed from the parent's selection. */
  childOnly: readonly Extension[];
}

export function durableChildExtensions(options: DurableChildAgentsOptions = {}): DurableChildExtensions {
  const ChildTools = defineExtension({ name: "forgerie.child-tools", tools: [askHumanTool, ...(options.childTools ?? [])] });
  const subagentTool = defineTool({
    name: "subagent",
    description: "Start or message a background subagent. Actions: spawn (name, message) and send (name, message). Its answer is reported back to you when it arrives. The user can open, steer, and stop it.",
    parameters: Type.Object({ action: Type.Union([Type.Literal("spawn"), Type.Literal("send")]), name: Type.String(), message: Type.String() }),
    replay: "unsafe",
    execute: async (args, api, context) => {
      const { action, name, message } = args;
      const result = await api.commit(async (tx) => {
        const state = await tx.doc(Children, api.conversationId);
        const background = { ownership: { kind: "conversation" }, background: true } as const;
        if (action === "spawn") {
          if (Object.hasOwn(state.agents, name)) return `${name} already exists; use send.`;
          const anchor = await tx.createTask(Anchor, null, background);
          const child = await tx.createConversation({ ownership: { kind: "task", taskId: anchor } });
          await configure(tx, child.id, { extensions: [ChildTools], instructions: `You are the subagent "${name}". Work on the requests you receive.` });
          state.agents[name] = { conversationId: child.id, reported: [] };
        } else if (!Object.hasOwn(state.agents, name)) return `No subagent named ${name}.`;
        const agent = state.agents[name];
        if (agent === undefined) return `No subagent named ${name}.`;
        state.reporters[String(api.taskId)] = await tx.createTask(Reporter, { name, conversationId: agent.conversationId, message, followUp: false }, background);
        return action === "send" ? `Sent to ${name}.` : `Started ${name}.`;
      }, context);
      const current = (await api.snapshot(Children, api.conversationId, context))?.agents[name];
      return { content: [{ type: "text" as const, text: result }], ...(current === undefined ? {} : { details: { name, conversationId: current.conversationId } }) };
    },
  });
  return {
    parent: [defineExtension({ name: "forgerie.subagents", tasks: [Anchor, Reporter], tools: [subagentTool] })],
    childOnly: [ChildTools],
  };
}

// ─── Host operations: what Forgerie's server and UI call. No model turn in any of them. ───

export interface DurableChildSummary { name: string; conversationId: number; busy: boolean; pendingQuestions: number }

export async function listChildren(harness: Harness, parent: ConversationId, context: Context): Promise<DurableChildSummary[]> {
  const agents = (await harness.snapshot(Children, parent, context))?.agents ?? {};
  const questions = Object.values((await harness.snapshot(Questions, parent, context))?.items ?? {});
  return Promise.all(Object.entries(agents).map(async ([name, agent]) => ({
    name, conversationId: Number(agent.conversationId),
    busy: (await harness.snapshot(LiveDoc, agent.conversationId, context))?.run !== undefined,
    pendingQuestions: questions.filter((question) => question.child === agent.conversationId && question.answer === null).length,
  })));
}

async function ownedChild(harness: Harness, parent: ConversationId, conversationId: number, context: Context) {
  const agents = (await harness.snapshot(Children, parent, context))?.agents ?? {};
  const agent = Object.values(agents).find((candidate) => Number(candidate.conversationId) === conversationId);
  if (agent === undefined) throw new Error(`Conversation ${String(conversationId)} is not a child of this session`);
  const child = await harness.conversation(agent.conversationId, context);
  if (child === undefined) throw new Error(`Child conversation ${String(conversationId)} is missing`);
  return child;
}

/** The child transcript as model messages, for a child view. */
export async function childMessages(harness: Harness, parent: ConversationId, conversationId: number, context: Context) {
  const child = await ownedChild(harness, parent, conversationId, context);
  const view = await child.context(context);
  return view.entries.flatMap((entry) => entry.model ?? []).filter((message) => message.role !== "system");
}

/** The user typing into an opened child: a steer while it works, a follow-up input when it is idle. */
export async function messageChild(harness: Harness, parent: ConversationId, conversationId: number, text: string, context: Context): Promise<void> {
  const child = await ownedChild(harness, parent, conversationId, context);
  await child.submit({ type: "input", content: text, whenBusy: "steer" }, context);
}

export async function stopChild(harness: Harness, parent: ConversationId, conversationId: number, context: Context): Promise<void> {
  await (await ownedChild(harness, parent, conversationId, context)).abort(context);
}

export async function answerChildQuestion(harness: Harness, parent: Conversation, questionId: string, answer: string, context: Context): Promise<void> {
  const accepted = await parent.commit(async (tx) => {
    const item = (await tx.doc(Questions, parent.id)).items[questionId];
    if (item === undefined || item.answer !== null) return false;
    item.answer = answer;
    return true;
  }, context);
  if (!accepted) throw new Error(`Question ${questionId} is not open`);
  await parent.submit({ type: "write", requestId: `answer:${questionId}`, entry: { kind: CHILD_ANSWER_KIND, data: { questionId, answer } } }, context);
}

/** One line for the transcript card of a child question or the user's answer. */
export function childEntryText(kind: string, data: unknown): string {
  const record = typeof data === "object" && data !== null ? data as Record<string, unknown> : {};
  const field = (key: string) => (typeof record[key] === "string" ? record[key] : "");
  return kind === CHILD_QUESTION_KIND ? `${field("childName") || "subagent"} asks: ${field("question")}` : `Answered: ${field("answer")}`;
}
