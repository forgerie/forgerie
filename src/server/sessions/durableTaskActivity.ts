import type { Context } from "@earendil-works/chord";
import { AssistantEntry, type ConversationId, type EntryId, type Harness, type TaskInspection, type TaskGraph, type TaskId, type Tx } from "@earendil-works/pi-durable";
import { taskActivitySchema, type TaskActivity } from "../../shared/durableTaskActivity.js";
import { boundConversationId } from "./durableSessionBindings.js";
import { durableChildRunMetadata } from "./durableChildAgents.js";

type ReadyActivity = Extract<TaskActivity, { kind: "ready" }>;
const labels: Readonly<Record<string, string>> = {
  "pi.generation": "Answering your message",
  "pi.compaction": "Making room in the conversation",
  "pi.tool": "Working",
  "forgerie.child-anchor": "Agent",
  "forgerie.child-reporter": "Report back to this session",
  "forgerie.child-question-delivery": "Passing on an agent's question",
  "forgerie.parent-ask-delivery": "Passing on your answer",
  "forgerie.decision-correction": "Passing on your correction",
  "forgerie.gated-action-delivery": "Reporting an approval result",
  "forgerie.gated-action-run": "Running an approved action",
  "forgerie.workflow-launch": "Starting a workflow",
  "forgerie.workflow-cancel": "Finishing a workflow stop",
  "forgerie.process-event-delivery": "Passing on process updates",
  "forgerie.trigger.manual": "Running a trigger",
  "forgerie.trigger": "Waiting for a scheduled trigger",
};
const verbs: Readonly<Record<string, string>> = { read: "Read", edit: "Edit", write: "Write", bash: "Run", grep: "Search", find: "Search", ls: "List" };

/** Attribution follows creator ownership, never inherited history or a live anchor's existence. */
export async function taskFamily(harness: Harness, parent: ConversationId, candidates: Iterable<ConversationId>, context: Context): Promise<ReadonlySet<ConversationId>> {
  return harness.commit(async tx => {
    const belongs = new Map<ConversationId, boolean>([[parent, true]]);
    async function contains(id: ConversationId, visiting = new Set<ConversationId>()): Promise<boolean> {
      const known = belongs.get(id);
      if (known !== undefined) return known;
      if (visiting.has(id)) return false;
      visiting.add(id);
      const record = await tx.conversation(id);
      const keep = record?.owner !== undefined && await contains(record.owner.conversationId, visiting);
      belongs.set(id, keep);
      return keep;
    }
    const family = new Set<ConversationId>([parent]);
    for (const id of candidates) if (await contains(id)) family.add(id);
    return family;
  }, context);
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : undefined;
}
function subject(name: string, args: unknown): string | null {
  const fields = object(args);
  if (["read", "edit", "write", "ls", "grep", "find"].includes(name)) return typeof fields?.["path"] === "string" ? fields["path"].slice(0, 120) : null;
  if (name !== "bash" || typeof fields?.["command"] !== "string") return null;
  // Redact before truncation, including quoted values and --flag=value forms.
  return (fields["command"].split(/\r?\n/)[0] ?? "")
    .replace(/\b([A-Za-z_][A-Za-z0-9_]*=)(?:"[^"\n]*(?:"|$)|'[^'\n]*(?:'|$)|\\[^\n]|[^\s;&|'"\\])+/g, "$1…")
    .replace(/((?:--token|--password|--secret|--key|-p)(?:=|\s+))(?:"[^"\n]*(?:"|$)|'[^'\n]*(?:'|$)|\\[^\n]|[^\s;&|'"\\])+/g, "$1…")
    .slice(0, 120);
}
async function toolCall(tx: Tx, input: unknown) {
  const fields = object(input);
  if (typeof fields?.["assistant"] !== "number" || !Number.isSafeInteger(fields["assistant"]) || typeof fields["callId"] !== "string") return undefined;
  // Validate the stored numeric ID at this boundary, rather than serialize the saved input.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const id = fields["assistant"] as EntryId;
  const entry = await tx.entry(AssistantEntry, id);
  const message = entry?.model?.[0];
  return message?.role === "assistant" ? message.content.find(part => part.type === "toolCall" && part.id === fields["callId"]) : undefined;
}

/** Read-only public projection. Inspection uses this harness's registry, including live SDK overrides. */
export async function readTaskActivity(harness: Harness, parent: ConversationId, context: Context): Promise<ReadyActivity> {
  const inspection = await harness.inspect(context);
  const parentMetadata = await durableChildRunMetadata(harness, parent, context);
  const reporterTargets = inspection.tasks.flatMap(task => {
    const target = task.record.kind === "forgerie.child-reporter" ? object(task.record.input)?.["conversationId"] : undefined;
    return typeof target === "number" && Number.isSafeInteger(target) && target >= 0 ? [boundConversationId(target)] : [];
  });
  const family = await taskFamily(harness, parent, [...inspection.tasks.map(task => task.record.conversationId), ...reporterTargets,
    ...Object.values(parentMetadata).map(child => child.conversationId)], context);
  const live = inspection.tasks.filter(task => family.has(task.record.conversationId));
  const ids = new Set<TaskId>(live.map(task => task.record.id));
  const childIds = new Set(live.filter(task => task.record.conversationId !== parent).map(task => task.record.conversationId));
  const metadata = new Map<ConversationId, string>();
  for (const id of family) {
    for (const [name, child] of Object.entries(await durableChildRunMetadata(harness, id, context))) {
      if (family.has(child.conversationId)) metadata.set(child.conversationId, name);
    }
  }
  const agents: ReadyActivity["agents"] = [];
  const agentIds = new Set([...childIds, ...live.flatMap(task => {
    const target = task.record.kind === "forgerie.child-reporter" ? object(task.record.input)?.["conversationId"] : undefined;
    return reporterTargets.filter(id => id === target && id !== parent && family.has(id));
  })]);
  for (const id of metadata.keys()) {
    const record = await harness.commit(tx => tx.conversation(id), context);
    if (live.some(task => task.record.kind === "forgerie.child-anchor" && task.record.id === record?.owner?.taskId)) agentIds.add(id);
  }
  for (const id of [...agentIds].sort((a, b) => a - b)) {
    const record = await harness.commit(tx => tx.conversation(id), context);
    const anchor = live.find(task => task.record.kind === "forgerie.child-anchor" && task.record.id === record?.owner?.taskId);
    agents.push({ conversationId: id, name: metadata.get(id) ?? `Agent ${String(id)}`, taskId: anchor?.record.id ?? null });
  }
  const policies = new Map<ConversationId, ReadonlyMap<string, "safe" | "unsafe">>();
  const tasks: ReadyActivity["tasks"] = [];
  for (const task of live) {
    const record = task.record;
    let tool: ReadyActivity["tasks"][number]["tool"] = null;
    let toolSubject: string | null = null;
    let label = record.kind === "pi.generation" && record.conversationId !== parent ? "Answering" : (Object.hasOwn(labels, record.kind) ? labels[record.kind] : undefined) ?? "Working";
    if (record.kind === "pi.tool") {
      const call = await harness.commit(tx => toolCall(tx, record.input), context);
      if (call?.type === "toolCall") {
        let policy = policies.get(record.conversationId);
        if (policy === undefined) {
          const conversation = await harness.conversation(record.conversationId, context);
          policy = new Map((await conversation?.agent(context))?.tools.map(tool => [tool.name, tool.replay ?? "unsafe"]) ?? []);
          policies.set(record.conversationId, policy);
        }
        const checkpoint = "checkpoint" in record.state ? object(record.state.checkpoint) : undefined;
        const savedSafe = checkpoint?.["phase"] === "call" || checkpoint?.["phase"] === "execute" && checkpoint["replay"] === "safe";
        tool = { name: call.name, replay: policy.get(call.name) === "safe" && savedSafe ? "safe" : "unsafe" };
        toolSubject = subject(call.name, call.arguments);
        label = (Object.hasOwn(verbs, call.name) ? verbs[call.name] : undefined) ?? `Use \`${call.name}\``;
      }
    }
    const reporterTarget = record.kind === "forgerie.child-reporter" ? object(record.input)?.["conversationId"] : undefined;
    const agentConversationId = typeof reporterTarget === "number" ? agents.find(agent => agent.conversationId === reporterTarget)?.conversationId ?? null : null;
    tasks.push({
      id: record.id, kind: record.kind, label, subject: toolSubject, conversationId: record.conversationId,
      owner: record.owner !== undefined && ids.has(record.owner) ? record.owner : null,
      agentConversationId, group: record.conversationId === parent && !record.background ? "this-turn" : "background", background: record.background,
      status: task.state.kind === "ready" ? "pending" : task.state.kind,
      waitingOn: task.state.kind === "waiting" ? task.state.on.length : 0,
      blockedReason: task.state.kind === "blocked" ? task.state.reason : null,
      scheduler: schedulerText(task), startedAt: record.startedAt ?? null, tool,
      restart: task.state.kind === "blocked" ? "blocked"
        : record.kind === "forgerie.gated-action-run" || record.kind === "pi.tool" && tool?.replay !== "safe" ? "stops"
          : Object.hasOwn(labels, record.kind) ? "resumes" : "unknown",
    });
  }
  return taskActivitySchema.options[1].parse({ kind: "ready", parentConversationId: parent, backgroundAgents: childIds.size, agents, tasks });
}
function schedulerText(task: TaskInspection): string {
  return task.state.kind === "blocked" ? `blocked: ${task.state.reason}` : task.state.kind;
}

/** One trailing refresh, one read in flight, and no stale publication after a newer graph or disposal. */
export async function watchTaskActivity(harness: Harness, parent: ConversationId, changed: (graph: TaskGraph, family: ReadonlySet<ConversationId>) => void, report: (error: unknown) => void, context: Context): Promise<{ stop(): Promise<void> }> {
  const watch = await harness.watchTaskGraph(context);
  const state: { stopped: boolean; dirty: boolean; timer: ReturnType<typeof setTimeout> | undefined; pending: Promise<void> | undefined } = { stopped: false, dirty: false, timer: undefined, pending: undefined };
  let previous = watch.value;
  const candidates = new Set<ConversationId>([parent]);
  const refresh = async () => {
    if (state.stopped || state.pending !== undefined || state.timer !== undefined || !state.dirty) return;
    state.dirty = false;
    const graph = watch.value;
    state.pending = (async () => {
      const family = await taskFamily(harness, parent, [...Object.values(graph.tasks).map(task => task.conversationId), ...candidates], context);
      if (state.stopped || state.dirty) return;
      const relevant = [...candidates].some(id => family.has(id));
      candidates.clear();
      if (relevant) changed(graph, family);
    })().catch(report);
    await state.pending;
    state.pending = undefined;
    await refresh();
  };
  const schedule = () => {
    state.dirty = true;
    clearTimeout(state.timer);
    state.timer = setTimeout(() => { state.timer = undefined; void refresh(); }, 100);
  };
  watch.start(graph => {
    // Keep changes that start and finish inside one debounce window, even if the final graph is empty.
    for (const id of new Set([...Object.keys(previous.tasks), ...Object.keys(graph.tasks)])) {
      const before = previous.tasks[id];
      const after = graph.tasks[id];
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      if (before !== undefined) candidates.add(before.conversationId);
      if (after !== undefined) candidates.add(after.conversationId);
    }
    previous = graph;
    schedule();
    return Promise.resolve();
  });
  state.dirty = true;
  await refresh();
  return { stop: async () => { state.stopped = true; clearTimeout(state.timer); await watch.stop(); await state.pending; } };
}
