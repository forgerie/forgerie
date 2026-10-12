/**
 * Durable-native child agents inside a Forgerie session.
 *
 * A child is an ordinary Durable conversation in the parent session's own storage. A background anchor task of the
 * parent conversation owns it, so the parent's Esc does not reach it, and its work survives a restart with the parent's
 * storage. A child asks the user through an entry in the parent transcript: the parent model gets no turn.
 *
 * Pattern from pi-durable test/examples/23-subagent-background.ts. Findings: prototypes/durable-child-spike/README.md.
 */
import { setTimeout as sleep } from "node:timers/promises";
import type { Context } from "@earendil-works/chord";
import { Type, type AssistantMessage } from "@earendil-works/pi-ai";
import {
  AgentDoc, AssistantEntry, CompactionTask, GenerationTask, LiveDoc, configure, defineDoc, defineExtension, defineTask, defineTool, hook, section,
  type Conversation, type ConversationId, type EntryId, type Extension, type Harness, type TaskGraph, type TaskId,
  type ToolRegistration, type Tx,
} from "@earendil-works/pi-durable";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import type { DurableSdkTools } from "./durableSdkTools.js";
import type { ChildAgentCatalog, ChildAgentProfile } from "./durableChildProfiles.js";
import type { ChildWorktreeSummary, WorktreeActionResult, WorktreeDiscardPreview } from "../../shared/sessionWorktree.js";
import type { DurableChildWorktrees } from "./durableChildWorktrees.js";
import { planChildRuntime, runtimeGaps, type ChildRuntimePlan, type ChildSkill } from "./durableChildRuntime.js";
import { readsImages, watchdogDiffTool } from "./durableChildTools.js";
import { associateWorkflowChild, settleWorkflowChild, deliveredWorkflowChild, undeliveredWorkflowChild, workflowChildRefusal, workflowWorkerModel } from "./durableWorkflowRuns.js";

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
type ChildQuestion = { child: ConversationId; childName: string; question: string; answer: string | null; askedAt: number; closed?: boolean };
type ReporterInput = { name: string; conversationId: ConversationId; message: string; followUp: boolean; worktreeId?: string };
type ReporterState = { phase: "deliver" } | { phase: "report"; report?: string };
/* eslint-enable @typescript-eslint/consistent-type-definitions */

export const CHILD_AGENTS_DOC_KIND = "forgerie.durable-children";
const Children = defineDoc<{ agents: Record<string, ChildRecord>; reporters: Record<string, TaskId>;
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

const REPORTER_KIND = "forgerie.child-reporter";
function childReporter(worktrees: DurableChildWorktrees | undefined, flushRunRecords?: () => Promise<void>) {
  return defineTask<ReporterInput, ReporterState, null>({
  name: REPORTER_KIND, version: 1, initial: () => ({ phase: "deliver" }),
  phases: {
    deliver: async (reporter, runtime, context) => {
      const { name, conversationId, message, followUp } = reporter.input;
      const child = await runtime.conversation(conversationId, context);
      if (child === undefined) throw new Error(`Child conversation ${String(conversationId)} is missing`);
      const submission = await child.submit({ type: "input", content: message, whenBusy: followUp ? "followUp" : "steer", requestId: `child:${String(reporter.id)}` }, context);
      await flushRunRecords?.();
      const settled = await submission.wait(context);
      // Ancillary accounting/reporting must not replace the child's durable submission outcome.
      await runtime.commit(async (tx) => { await settleWorkflowChild(tx, runtime.conversationId, reporter.id, settled); }, context);
      const worktreeReport = settled.status !== "unanswered" && reporter.input.worktreeId !== undefined
        ? await requireWorktrees(worktrees).report(reporter.input.worktreeId) : undefined;
      await runtime.commit(async (tx) => {
        const next = (report?: string): { status: "running"; checkpoint: ReporterState } => ({ status: "running", checkpoint: report === undefined ? { phase: "report" } : { phase: "report", report } });
        if (settled.status === "unanswered") {
          return next(settled.reason === "aborted" ? undefined : `[subagent ${name} failed: ${settled.reason}]`);
        }
        if (settled.type !== "input") return next();
        const agent = (await tx.doc(Children, runtime.conversationId)).agents[name];
        const answer = (await tx.entry(AssistantEntry, settled.answer))?.model?.[0];
        if (agent === undefined || agent.reported.includes(settled.answer)) return next();
        agent.reported.push(settled.answer);
        return next(`[subagent ${name} answered, no reply needed] ${textOf(isAssistant(answer) ? answer : undefined)}${worktreeReport === undefined ? "" : `\n\n${worktreeReport}`}`);
      }, context);
    },
    report: async (reporter, runtime, context) => {
      const checkpoint: ReporterState = reporter.state.checkpoint;
      const report = "report" in checkpoint ? checkpoint.report : undefined;
      if (report !== undefined) {
        const main = await runtime.conversation(runtime.conversationId, context);
        if (main === undefined) throw new Error("Child report parent is missing");
        await main.submit({ type: "input", content: report, whenBusy: "followUp", requestId: `child-report:${String(reporter.id)}` }, context);
      }
      await runtime.commit(async (tx) => {
        if (report === undefined) await undeliveredWorkflowChild(tx, runtime.conversationId, reporter.id, "Completion report suppressed; no parent message was submitted.");
        else await deliveredWorkflowChild(tx, runtime.conversationId, reporter.id);
        return { status: "terminal", outcome: { status: "completed", result: null } };
      }, context);
    },
  },
  abort: (_task, runtime, context) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
  });
}

interface CommitApi { conversationId: ConversationId; commit<T>(change: (tx: Tx) => T | Promise<T>, context: Context): Promise<T> }

async function parentOf(api: CommitApi, context: Context): Promise<ConversationId> {
  const parent = await api.commit(async (tx) => (await tx.conversation(api.conversationId))?.owner?.conversationId, context);
  if (parent === undefined) throw new Error("This conversation has no parent to ask");
  return parent;
}

/** A child's only way to reach the human. Named apart from Forgerie's ask_user so the parent's tool is not replaced. */
const askHumanTool = defineTool({
  name: "ask_human",
  description: "Ask the human user one question and wait for the answer. Use it only when you are blocked and cannot decide yourself.",
  parameters: Type.Object({ question: Type.String() }),
  // A rerun finds the same question by the call's task id, so it never asks twice.
  replay: "safe",
  execute: async (args, api, context) => {
    const parentId = await parentOf(api, context);
    const questionId = `q:${String(api.taskId)}`;
    // One commit records the question and appends its transcript entry, so a rerun after a crash finds both or neither.
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
      await sleep(250, undefined, { signal: context.abortSignal });
    }
  },
});

const codingTools: readonly ToolRegistration[] = CodingTools.tools ?? [];
const readTool = codingTools.find((tool) => tool.name === "read");

/** The tools a child gets: every child tool, or the ones its agent file names as `planChildRuntime` translates them. */
function childToolsFor(plan: ChildRuntimePlan, extra: readonly ToolRegistration[], shared: readonly ToolRegistration[]): ToolRegistration[] {
  const native = [askHumanTool, ...codingTools, watchdogDiffTool, ...extra];
  return plan.tools === undefined ? native : [...native, ...shared].filter((tool) => plan.tools?.includes(tool.name) === true);
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
  childToolsDeny?: readonly string[];
  worktrees?: DurableChildWorktrees;
  flushRunRecords?: () => Promise<void>;
}

export function durableChildExtensions(options: DurableChildExtensionOptions = {}): DurableChildExtensions {
  const extraTools = options.extraTools ?? [];
  const sessionTools = options.sessionTools;
  const sharedTools = sessionTools === undefined ? [] : sessionTools().childTools(sessionTools, options.childToolsDeny ?? []);
  const availableNames = () => {
    const current = sessionTools === undefined ? [] : sessionTools().childTools(sessionTools, options.childToolsDeny ?? []);
    return [...extraTools.map((tool) => tool.name), ...current.filter((tool) => sharedTools.some((installed) => installed.name === tool.name)).map((tool) => tool.name)];
  };
  const Reporter = childReporter(options.worktrees, options.flushRunRecords);
  const ChildTools = defineExtension({
    name: "forgerie.child-tools",
    // Save the accounting boundary before any generation or compaction can spend money.
    ...(options.flushRunRecords === undefined ? {} : { hooks: [
      hook(GenerationTask, { beforeRequest: async () => { await options.flushRunRecords?.(); return undefined; } }),
      hook(CompactionTask, { beforeCompact: async () => { await options.flushRunRecords?.(); return undefined; } }),
    ] }),
    tools: [askHumanTool, ...codingTools, watchdogDiffTool, ...extraTools, ...sharedTools],
    ...(readTool === undefined ? {} : { wraps: [readsImages(readTool)] }),
    sections: [section("environment", (input) => input.env === undefined ? undefined : `Working directory: ${input.env.cwd}`)],
  });
  const agentList = (options.agents ?? []).map((agent) => `- ${agent.name}: ${agent.description}`).join("\n");
  const childTool = defineTool({
    name: CHILD_TOOL_NAME,
    description: [
      "Run a background child agent in this session. Actions: spawn (name, message, optional agent and isolation) and send (name, message).",
      "Use isolation: worktree for a child that edits code independently. Shared, the default, uses the parent's working directory.",
      "A child works on its own; its answer is reported back to you as a new message when it arrives. Do not wait or poll.",
      "The user can open a child, steer it, stop it, and answer its questions. Several spawns in one reply run in parallel.",
      ...(agentList === "" ? [] : [`Agents (pass one as \`agent\`; omit for a general helper):\n${agentList}`]),
    ].join("\n"),
    parameters: Type.Object({
      action: Type.Union([Type.Literal("spawn"), Type.Literal("send")]),
      name: Type.String({ description: "Short unique name for this child, such as ui or api." }),
      message: Type.String({ description: "The full task. The child does not see this conversation." }),
      agent: Type.Optional(Type.String({ description: "Agent file name for spawn." })),
      isolation: Type.Optional(Type.Union([Type.Literal("shared"), Type.Literal("worktree")], { description: "Working directory for spawn. Default shared." })),
      model: Type.Optional(Type.String({ description: "Model for spawn as provider/model-id, optionally with :thinking-level. Overrides the agent file." })),
    }),
    // Tool calls serialize name allocation. Children themselves remain parallel background conversations.
    executionMode: "sequential",
    // The task ID identifies both the worktree receipt and reporter. Replay never starts a second run.
    replay: "safe",
    execute: (args, api, context) => withChildAdmission(options.worktrees, async () => {
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
      const spec = declared ?? (action === "spawn" ? args.model : undefined);
      const model = spec === undefined ? undefined : modelChoice(spec);
      if (model === null) return { content: [{ type: "text" as const, text: `Write model as provider/model-id, optionally with :thinking-level. Got ${spec ?? ""}${declared === undefined ? "" : " from the workflow file"}.` }], isError: true };
      if (existing?.worktreeId !== undefined) await requireWorktrees(options.worktrees).assertWritable(existing.worktreeId);
      const profile = action === "spawn" && args.agent !== undefined ? await options.catalog?.find(args.agent) : undefined;
      if (action === "spawn" && args.agent !== undefined && profile === undefined) {
        return { content: [{ type: "text" as const, text: `No agent named ${args.agent}.${agentList === "" ? "" : ` Choose one of:\n${agentList}`}` }], isError: true };
      }
      // A send re-reads the child's agent file, so a child spawned under an older runtime or file gets the current one.
      const sentProfile = action === "send" && existing?.agent != null ? await options.catalog?.find(existing.agent) : undefined;
      const refresh = action === "send" && (existing?.agent == null || sentProfile !== undefined);
      const runtime = action === "spawn" || refresh
        ? planChildRuntime(action === "spawn" ? profile : sentProfile, availableNames(), options.sessionSkills ?? []) : undefined;
      const checkout = action === "spawn" && args.isolation === "worktree"
        ? await requireWorktrees(options.worktrees).prepare(String(api.taskId)) : undefined;
      const result = await api.commit(async (tx) => {
        const refusal = await workflowChildRefusal(tx, api.conversationId, name);
        if (refusal !== undefined) return refusal;
        const state = await tx.doc(Children, api.conversationId);
        const background = { ownership: { kind: "conversation" }, background: true } as const;
        if (action === "spawn") {
          if (Object.hasOwn(state.agents, name)) return `${name} already exists; use send.`;
          const anchor = await tx.createTask(Anchor, null, background);
          const child = await tx.createConversation({ ownership: { kind: "task", taskId: anchor } });
          const chosenModel = model?.model ?? profile?.model;
          const chosenThinking = model?.thinkingLevel ?? profile?.thinkingLevel;
          const plan = runtime ?? planChildRuntime(profile, availableNames(), []);
          await configure(tx, child.id, {
            ...(checkout === undefined ? {} : { cwd: checkout.path }),
            extensions: [ChildTools],
            tools: childToolsFor(plan, extraTools, sharedTools),
            ...(chosenModel === undefined ? {} : { model: chosenModel }),
            ...(chosenThinking === undefined ? {} : { thinkingLevel: chosenThinking }),
            instructions: childInstructions(name, profile, plan, options.projectContext),
          });
          state.agents[name] = { conversationId: child.id, reported: [], agent: profile?.name ?? null, createdAt: Date.now(),
            ...(profile === undefined ? {} : { agentFile: profile.source }),
            ...(checkout === undefined ? {} : { worktreeId: checkout.id }) };
        } else if (!Object.hasOwn(state.agents, name)) return `No child named ${name}.`;
        const agent = state.agents[name];
        if (agent === undefined) return `No child named ${name}.`;
        if (refresh && runtime !== undefined) {
          // Tools, skills, and instructions follow the current runtime and agent file. The model stays as spawned:
          // a workflow or the agent may have chosen it for this child.
          await configure(tx, agent.conversationId, { extensions: [ChildTools], tools: childToolsFor(runtime, extraTools, sharedTools),
            instructions: childInstructions(name, sentProfile, runtime, options.projectContext) });
          if (sentProfile !== undefined) agent.agentFile = sentProfile.source;
        }
        const reporter = await tx.createTask(Reporter, { name, conversationId: agent.conversationId, message, followUp: false, ...(agent.worktreeId === undefined ? {} : { worktreeId: agent.worktreeId }) }, background);
        state.reporters[String(api.taskId)] = reporter;
        await associateWorkflowChild(tx, api.conversationId, agent.conversationId, reporter, name);
        if (action === "send") return refresh ? `Sent to ${name}.` : `Sent to ${name}. Its agent file ${String(agent.agent)} is gone, so it keeps the tools it was started with.`;
        return `Started ${name}${profile === undefined ? "" : ` (${profile.name})`}.${runtime === undefined ? "" : runtimeGaps(runtime)}`;
      }, context);
      const current = (await api.snapshot(Children, api.conversationId, context))?.agents[name];
      return { content: [{ type: "text" as const, text: result }], ...(current === undefined ? {} : { details: { name, conversationId: Number(current.conversationId) } }) };
    }),
  });
  return {
    parent: [defineExtension({ name: "forgerie.child-agents", tasks: [Anchor, Reporter], tools: [childTool] })],
    childOnly: [ChildTools],
    refresh: () => durableChildExtensions(options),
  };
}

type Thinking = NonNullable<ChildAgentProfile["thinkingLevel"]>;
const THINKING: readonly string[] = ["off", "minimal", "low", "medium", "high", "xhigh"] satisfies Thinking[];
const isThinking = (value: string): value is Thinking => THINKING.includes(value);
/** provider/model-id with an optional :thinking-level, as agent files write it. Null when it cannot be read. */
export function modelChoice(spec: string): { model: { provider: string; modelId: string }; thinkingLevel?: Thinking } | null {
  const colon = spec.lastIndexOf(":");
  const suffix = colon > 0 ? spec.slice(colon + 1) : "";
  const level = isThinking(suffix) ? suffix : undefined;
  const id = level === undefined ? spec : spec.slice(0, colon);
  const slash = id.indexOf("/");
  if (slash <= 0 || slash === id.length - 1) return null;
  return { model: { provider: id.slice(0, slash), modelId: id.slice(slash + 1) }, ...(level === undefined ? {} : { thinkingLevel: level }) };
}

/** A child's instructions: its agent file's prompt, its role, how this runtime differs, and the project's context. */
function childInstructions(name: string, profile: ChildAgentProfile | undefined, plan: ChildRuntimePlan, projectContext: string | undefined): string {
  const project = profile?.inheritProjectContext !== false && projectContext !== undefined && projectContext !== ""
    ? `\n\n<project_context>\n${projectContext}\n</project_context>` : "";
  return `${profile?.prompt ?? "You are a helper agent. Do the task you are given, then reply with a short result."}\n\nYou are the child agent "${name}" of a parent agent. Your final reply goes back to the parent. Use ask_human only when you are blocked.${plan.section === "" ? "" : `\n\n${plan.section}`}${project}`;
}

function withChildAdmission<T>(worktrees: DurableChildWorktrees | undefined, operation: () => Promise<T>): Promise<T> {
  return worktrees === undefined ? operation() : worktrees.exclusive(operation);
}

function requireWorktrees(worktrees: DurableChildWorktrees | undefined): DurableChildWorktrees {
  if (worktrees === undefined) throw new Error("Child worktree isolation is not available in this session");
  return worktrees;
}

export function workingChildCount(graph: TaskGraph, parent: ConversationId): number {
  return new Set(Object.values(graph.tasks).filter((task) => task.conversationId !== parent).map((task) => task.conversationId)).size;
}

/** Whether any child work is still live: a child's own task, or a reporter that has not delivered yet. */
export function childWorkIsLive(graph: TaskGraph, parent: ConversationId): boolean {
  return Object.values(graph.tasks).some((task) => task.kind === REPORTER_KIND || task.conversationId !== parent);
}

// ─── Host operations: what Forgerie's server and UI call. No model turn in any of them. ───

export interface DurableChildSummary {
  name: string;
  conversationId: number;
  agent: string | null;
  busy: boolean;
  createdAt: number;
  worktree?: ChildWorktreeSummary;
  /** Open questions, oldest first. */
  questions: { questionId: string; question: string; askedAt: number }[];
}

/** Questions children asked that the user has not answered and that no stop closed. */
export async function openChildQuestions(harness: Harness, parent: ConversationId, context: Context): Promise<number> {
  const items = Object.values((await harness.snapshot(Questions, parent, context))?.items ?? {});
  return items.filter((question) => question.answer === null && question.closed !== true).length;
}

/** Frozen launch provenance for the disk run-history projection, not a browser summary. */
export async function durableChildRunMetadata(harness: Harness, parent: ConversationId, context: Context) {
  return (await harness.snapshot(Children, parent, context))?.agents ?? {};
}

export async function listChildren(harness: Harness, parent: ConversationId, context: Context, worktrees?: DurableChildWorktrees): Promise<DurableChildSummary[]> {
  const agents = (await harness.snapshot(Children, parent, context))?.agents ?? {};
  const questions = Object.entries((await harness.snapshot(Questions, parent, context))?.items ?? {});
  const children = await Promise.all(Object.entries(agents).map(async ([name, agent]) => ({
    name, conversationId: Number(agent.conversationId), agent: agent.agent, createdAt: agent.createdAt,
    busy: (await harness.snapshot(LiveDoc, agent.conversationId, context))?.run !== undefined,
    ...(agent.worktreeId === undefined ? {} : { worktree: await requireWorktrees(worktrees).summary(agent.worktreeId) }),
    questions: questions.filter(([, question]) => question.child === agent.conversationId && question.answer === null && question.closed !== true)
      .map(([questionId, question]) => ({ questionId, question: question.question, askedAt: question.askedAt }))
      .sort((a, b) => a.askedAt - b.askedAt),
  })));
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
  const partial = live?.generation?.message;
  return {
    messages: view.entries.flatMap((entry) => entry.model ?? []).filter((message) => message.role !== "system"),
    busy: live?.run !== undefined,
    ...(partial === undefined ? {} : { partial }),
  };
}

async function noteInParent(parent: Conversation, text: string, data: Record<string, string | number>, context: Context): Promise<void> {
  await parent.submit({ type: "write", entry: { kind: CHILD_NOTE_KIND, model: [{ role: "user", content: [{ type: "text", text }], timestamp: Date.now() }], data: { ...data, text } } }, context);
}

/** The user typing into an opened child: a steer while it works, a new input when it is idle. */
export async function messageChild(harness: Harness, parent: Conversation, conversationId: number, text: string, context: Context, worktrees?: DurableChildWorktrees): Promise<void> {
  await withChildAdmission(worktrees, async () => {
    const { name, child, worktreeId } = await ownedChild(harness, parent.id, conversationId, context);
    if (worktreeId !== undefined) await requireWorktrees(worktrees).assertWritable(worktreeId);
    await child.submit({ type: "input", content: text, whenBusy: "steer" }, context);
    await noteInParent(parent, `[the user told child ${name} directly] ${text}`, { child: conversationId, childName: name, action: "message" }, context);
  });
}

export async function stopChild(harness: Harness, parent: Conversation, conversationId: number, context: Context, worktrees?: DurableChildWorktrees): Promise<void> {
  await withChildAdmission(worktrees, async () => {
    const { name, child } = await ownedChild(harness, parent.id, conversationId, context);
    await child.abort(context);
    await parent.commit(async (tx) => {
      for (const question of Object.values((await tx.doc(Questions, parent.id)).items)) {
        if (question.child === child.id && question.answer === null) question.closed = true;
      }
    }, context);
    await noteInParent(parent, `[the user stopped child ${name}]`, { child: conversationId, childName: name, action: "stop" }, context);
  });
}

export async function answerChildQuestion(parent: Conversation, questionId: string, answer: string, context: Context): Promise<void> {
  const accepted = await parent.commit(async (tx) => {
    const item = (await tx.doc(Questions, parent.id)).items[questionId];
    if (item?.answer !== null || item.closed === true) return false;
    item.answer = answer;
    return true;
  }, context);
  if (!accepted) throw new Error(`Question ${questionId} is not open`);
  await parent.submit({ type: "write", requestId: `answer:${questionId}`, entry: { kind: CHILD_ANSWER_KIND, data: { questionId, answer } } }, context);
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
      const reporter = await tx.createTask(childReporter(lifecycle), { name, conversationId: child.id, message: text, followUp: false, worktreeId: checkout.id }, background);
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
