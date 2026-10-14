// A session's live Durable tasks, as the status chip's panel shows them. The
// server side is src/server/sessions/durableTaskActivity.ts; the route is
// GET /api/sessions/:sessionId/tasks (durableTaskRoutes.ts). The schema below is
// the agreed contract, verbatim: both sides refuse any other field.
import { z } from "zod";

const taskRow = z.strictObject({
  id: z.number().int(),
  kind: z.string(),                       // raw kind, shown only in the opened record
  label: z.string(),                      // plain words from the label table; unknown kind -> "Working"
  subject: z.string().max(120).nullable(),// tool subject: a path, or a redacted short command; else null
  conversationId: z.number().int(),
  owner: z.number().int().nullable(),     // owning task ID if that task is in this response, else null
  agentConversationId: z.number().int().nullable(), // Reporter's target child; not an ownership edge
  group: z.enum(["this-turn", "background"]),
  background: z.boolean(),
  status: z.enum(["pending", "running", "waiting", "completing", "blocked"]),
  waitingOn: z.number().int().nonnegative(), // live tasks it waits for; 0 when not waiting
  blockedReason: z.enum(["missing_task", "task_too_old", "migration_failed"]).nullable(),
  scheduler: z.string(),                  // e.g. "running", "ready", "waiting", "completing", "blocked: task_too_old"
  startedAt: z.number().nullable(),       // epoch ms; null when unknown, never invented
  tool: z.strictObject({ name: z.string(), replay: z.enum(["safe", "unsafe"]) }).nullable(),
  restart: z.enum(["resumes", "stops", "blocked", "unknown"]),
});
const taskAgent = z.strictObject({
  conversationId: z.number().int(),
  name: z.string(),
  taskId: z.number().int().nullable(),    // the live anchor task, or null once it is terminal
});
export const taskActivitySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("unsupported") }),
  z.strictObject({
    kind: z.literal("ready"),
    parentConversationId: z.number().int(),
    backgroundAgents: z.number().int().nonnegative(), // live child agents; same number the session status uses
    agents: z.array(taskAgent),
    tasks: z.array(taskRow),
  }),
]);

export type TaskActivity = z.infer<typeof taskActivitySchema>;
export type ReadyTaskActivity = Extract<TaskActivity, { kind: "ready" }>;
export type TaskRow = z.infer<typeof taskRow>;
export type TaskAgent = z.infer<typeof taskAgent>;
export type TaskStatus = TaskRow["status"];

/** A row of the panel: one task, or one child agent with its anchor task folded into it. */
export type TaskNode =
  | { kind: "task"; task: TaskRow; children: readonly TaskNode[] }
  | { kind: "agent"; agent: TaskAgent; anchor: TaskRow | undefined; children: readonly TaskNode[] };
export interface TaskTree {
  thisTurn: readonly TaskNode[];
  background: readonly TaskNode[];
  /** Every row the panel would show with nothing folded. */
  rows: number;
}

/** An agent row starts folded when the panel holds more rows than this. */
export const FOLD_ABOVE_ROWS = 8;

const byId = (left: TaskRow, right: TaskRow) => left.id - right.id;

/**
 * The owner tree. A task with `owner` hangs under that task. A task with no
 * owner in a child conversation hangs under that child's agent row. A task with
 * no owner in the parent conversation is a top-level row in its group. A
 * Reporter (`agentConversationId`) hangs under its agent's row. An agent's
 * live anchor task is the agent row itself, so tasks it owns hang there too.
 */
export function buildTaskTree(activity: ReadyTaskActivity): TaskTree {
  const tasks = [...activity.tasks].sort(byId);
  const known = new Map(tasks.map((task) => [task.id, task]));
  const agents = activity.agents.map((agent) => ({ agent, anchor: agent.taskId === null ? undefined : known.get(agent.taskId) }));
  const agentByConversation = new Map(agents.map((entry) => [entry.agent.conversationId, entry]));
  const agentByAnchor = new Map(agents.flatMap((entry) => entry.anchor ? [[entry.anchor.id, entry] as const] : []));

  type Parent = { kind: "task"; id: number } | { kind: "agent"; conversationId: number } | undefined;
  const parentOf = (task: TaskRow): Parent => {
    if (task.agentConversationId !== null && agentByConversation.has(task.agentConversationId)) return { kind: "agent", conversationId: task.agentConversationId };
    if (task.owner !== null && known.has(task.owner)) {
      const anchored = agentByAnchor.get(task.owner);
      return anchored ? { kind: "agent", conversationId: anchored.agent.conversationId } : { kind: "task", id: task.owner };
    }
    if (task.conversationId !== activity.parentConversationId && agentByConversation.has(task.conversationId)) return { kind: "agent", conversationId: task.conversationId };
    return undefined;
  };

  const underTask = new Map<number, TaskRow[]>();
  const underAgent = new Map<number, TaskRow[]>();
  const loose: TaskRow[] = [];
  for (const task of tasks) {
    if (agentByAnchor.has(task.id)) continue;
    const parent = parentOf(task);
    if (parent === undefined) loose.push(task);
    else if (parent.kind === "task") underTask.set(parent.id, [...underTask.get(parent.id) ?? [], task]);
    else underAgent.set(parent.conversationId, [...underAgent.get(parent.conversationId) ?? [], task]);
  }

  const placed = new Set<number>();
  const taskNode = (task: TaskRow): TaskNode => {
    placed.add(task.id);
    return { kind: "task", task, children: (underTask.get(task.id) ?? []).filter((child) => !placed.has(child.id)).map(taskNode) };
  };
  const agentNodes = agents.map(({ agent, anchor }): TaskNode => {
    if (anchor) placed.add(anchor.id);
    // The agent's own work first; its Reporter waits for that work to end, so it comes last.
    const own = underAgent.get(agent.conversationId) ?? [];
    const ordered = [...own.filter((task) => task.agentConversationId === null), ...own.filter((task) => task.agentConversationId !== null)];
    return { kind: "agent", agent, anchor, children: ordered.map(taskNode) };
  }).filter((node) => node.kind === "agent" && (node.anchor !== undefined || node.children.length > 0));
  const thisTurn = loose.filter((task) => task.group === "this-turn").map(taskNode);
  const background = [...agentNodes, ...loose.filter((task) => task.group === "background").map(taskNode)];
  // An owner cycle never reaches a root. Show its tasks at the top of their group rather than lose them.
  for (const task of tasks) {
    if (placed.has(task.id)) continue;
    (task.group === "this-turn" ? thisTurn : background).push(taskNode(task));
  }
  return { thisTurn, background, rows: countRows([...thisTurn, ...background]) };
}

/** Rows in these nodes and everything under them. */
export function countRows(nodes: readonly TaskNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countRows(node.children), 0);
}

const plural = (count: number, one: string, many: string) => `${String(count)} ${count === 1 ? one : many}`;
export const tasksLabel = (count: number) => plural(count, "task", "tasks");
export const agentsLabel = (count: number) => plural(count, "agent", "agents");
export const backgroundAgentsLabel = (count: number) => plural(count, "background agent", "background agents");

/** The readout beside a group's title: what it holds, in words. */
export function groupCount(nodes: readonly TaskNode[]): string {
  const agents = nodes.filter((node) => node.kind === "agent").length;
  const tasks = countRows(nodes) - countRows(nodes.filter((node) => node.kind === "agent"));
  return [agents > 0 ? agentsLabel(agents) : "", tasks > 0 ? tasksLabel(tasks) : ""].filter(Boolean).join(", ");
}

const BLOCKED: Record<NonNullable<TaskRow["blockedReason"]>, string> = {
  task_too_old: "Cannot run: saved by a newer version",
  missing_task: "Cannot run: its code is not loaded",
  migration_failed: "Cannot run: its saved state could not be updated",
};

/** The row's detail line: what the task does now, in plain words. */
export function taskDetail(node: TaskNode): string {
  const task = node.kind === "task" ? node.task : node.anchor;
  if (task?.status === "blocked") return task.blockedReason ? BLOCKED[task.blockedReason] : "Cannot run";
  if (node.kind === "agent") return task ? "Working. Its answer comes back here." : "Its last tasks are finishing.";
  if (task === undefined) return "Working";
  switch (task.status) {
    case "pending": return "Waiting to start";
    case "running": return "Running";
    case "completing": return "Finishing";
    case "waiting": {
      if (task.agentConversationId !== null) return "Waits for the agent to finish";
      if (task.waitingOn === 0) return "Waiting";
      const tools = node.children.length === task.waitingOn && node.children.every((child) => child.kind === "task" && child.task.tool !== null);
      return `Waiting for ${tools ? plural(task.waitingOn, "tool call", "tool calls") : tasksLabel(task.waitingOn)}`;
    }
  }
}

/** The mark an agent row draws when its anchor task is gone: the busiest state under it. */
export function nodeStatus(node: TaskNode): TaskStatus {
  if (node.kind === "task") return node.task.status;
  if (node.anchor) return node.anchor.status;
  const order: readonly TaskStatus[] = ["blocked", "running", "completing", "waiting", "pending"];
  const below = new Set(node.children.map(nodeStatus));
  return order.find((status) => below.has(status)) ?? "completing";
}

/** Every task row in the tree, anchors included, once each. */
function allTasks(tree: TaskTree): TaskRow[] {
  const walk = (nodes: readonly TaskNode[]): TaskRow[] => nodes.flatMap((node) => [
    ...(node.kind === "task" ? [node.task] : node.anchor ? [node.anchor] : []), ...walk(node.children)]);
  return walk([...tree.thisTurn, ...tree.background]);
}

/**
 * The one restart note under the lists. It promises that everything resumes
 * only when every row resumes; otherwise it names how many rows stop, cannot
 * run, or may not resume, and how many resume.
 */
export function restartNote(tree: TaskTree): { tone: "plain" | "warn"; text: string } | undefined {
  const tasks = allTasks(tree);
  if (tasks.length === 0) return undefined;
  const count = (restart: TaskRow["restart"]) => tasks.filter((task) => task.restart === restart).length;
  const stops = count("stops");
  const blocked = count("blocked");
  const unknown = count("unknown");
  const resumes = count("resumes");
  if (resumes === tasks.length) return { tone: "plain", text: "If Forgerie restarts now, everything here resumes on its own." };
  const verb = (n: number, one: string, many: string) => n === 1 ? one : many;
  const parts = [
    stops > 0 ? `${tasksLabel(stops)} ${verb(stops, "stops and is", "stop and are")} not run again` : "",
    blocked > 0 ? `${tasksLabel(blocked)} cannot run, now or after a restart` : "",
    unknown > 0 ? `${tasksLabel(unknown)} may not resume` : "",
  ].filter(Boolean);
  const lead = `If Forgerie restarts now, ${parts[0]!}.`;
  const rest = parts.slice(1).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}.`);
  const others = resumes === 0 ? [] : [resumes === 1 ? "The other task resumes on its own." : `The other ${tasksLabel(resumes)} resume on their own.`];
  return { tone: stops > 0 || blocked > 0 ? "warn" : "plain", text: [lead, ...rest, ...others].join(" ") };
}

/** Elapsed time from `startedAt`, such as "41 s", "1 m 12 s" or "2 h 14 m". Blank when the start is unknown. */
export function elapsed(startedAt: number | null, now: number): string {
  if (startedAt === null) return "";
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  if (seconds < 60) return `${String(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)} m ${String(seconds % 60)} s`;
  return `${String(Math.floor(minutes / 60))} h ${String(minutes % 60)} m`;
}

/** The public record behind a row: the same lines the panel shows and Copy record copies. */
export function taskRecord(node: TaskNode, clock: (at: number) => string): { term: string; value: string }[] {
  const task = node.kind === "task" ? node.task : node.anchor;
  const agent = node.kind === "agent"
    ? [{ term: "Agent", value: node.agent.name }, { term: "Conversation", value: String(node.agent.conversationId) }] : [];
  if (task === undefined) return [...agent, { term: "Task", value: "Finished; its last tasks are still live" }];
  return [
    ...agent,
    { term: "Kind", value: task.kind },
    { term: "Task", value: `${String(task.id)}, ${task.owner === null ? "owned by the conversation" : `owned by task ${String(task.owner)}`}` },
    { term: "Started", value: task.startedAt === null ? "Not known" : clock(task.startedAt) },
    { term: "Scheduler", value: task.scheduler },
    ...(task.tool ? [{ term: "Tool", value: `${task.tool.name}, replay ${task.tool.replay}` }] : []),
  ];
}

export const recordText = (lines: readonly { term: string; value: string }[]) => lines.map(({ term, value }) => `${term}: ${value}`).join("\n");

/** The key a row keeps its open and folded state under, stable across reads. */
export const nodeKey = (node: TaskNode) => node.kind === "task" ? `task:${String(node.task.id)}` : `agent:${String(node.agent.conversationId)}`;
