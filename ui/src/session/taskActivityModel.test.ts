import { describe, expect, test } from "vitest";
import {
  buildTaskTree, elapsed, groupCount, recordText, restartNote, taskActivitySchema, taskDetail, taskRecord, nodeStatus,
  type ReadyTaskActivity, type TaskNode, type TaskRow,
} from "./taskActivityModel";
import { BLOCKED, BUSY, IDLE_BACKGROUND, WORKING, utcClock } from "./fixtures/taskActivity";

const row = (fields: Partial<TaskRow> & Pick<TaskRow, "id">): TaskRow => ({
  kind: "pi.tool", label: "Read", subject: null, conversationId: 1, owner: null, agentConversationId: null, group: "this-turn", background: false,
  status: "running", waitingOn: 0, blockedReason: null, scheduler: "running", startedAt: null, tool: null, restart: "resumes", ...fields,
});
const ready = (tasks: TaskRow[], agents: ReadyTaskActivity["agents"] = []): ReadyTaskActivity =>
  ({ kind: "ready", parentConversationId: 1, backgroundAgents: agents.length, agents, tasks });
/** A tree as nested ids: a task is its id, an agent is "agent <name>". */
const shape = (nodes: readonly TaskNode[]): unknown[] => nodes.map((node) => {
  const id = node.kind === "task" ? node.task.id : `agent ${node.agent.name}`;
  return node.children.length ? [id, shape(node.children)] : id;
});

describe("the task activity schema", () => {
  test("refuses an unknown field, so private task data cannot ride along", () => {
    expect(taskActivitySchema.safeParse({ ...WORKING, tasks: [{ ...WORKING.tasks[0], input: { command: "rm -rf /" } }] }).success).toBe(false);
    expect(taskActivitySchema.safeParse({ kind: "unsupported", reason: "x" }).success).toBe(false);
    expect(taskActivitySchema.parse({ kind: "unsupported" })).toEqual({ kind: "unsupported" });
  });
});

describe("the owner tree", () => {
  test("hangs tool calls under their turn, and each agent's work and Reporter under its row", () => {
    const tree = buildTaskTree(WORKING);
    expect(shape(tree.thisTurn)).toEqual([[1840, [1842, 1843]]]);
    expect(shape(tree.background)).toEqual([["agent ui", [[1801, [1805]], 1791]]]);
    expect(tree.rows).toBe(7);
  });

  test("folds an agent's live anchor task into its row", () => {
    const [agent] = buildTaskTree(WORKING).background;
    expect(agent).toMatchObject({ kind: "agent", anchor: { id: 1790 } });
  });

  test("keeps an agent whose anchor finished while its tasks still run", () => {
    const tree = buildTaskTree(ready([row({ id: 9, conversationId: 5, group: "background", background: true })], [{ conversationId: 5, name: "ui", taskId: null }]));
    expect(shape(tree.background)).toEqual([["agent ui", [9]]]);
    expect(tree.background[0]).toMatchObject({ anchor: undefined });
    expect(nodeStatus(tree.background[0]!)).toBe("running");
    expect(taskDetail(tree.background[0]!)).toBe("Its last tasks are finishing.");
  });

  test("drops an agent with no live anchor and no live tasks", () => {
    expect(buildTaskTree(ready([], [{ conversationId: 5, name: "ui", taskId: null }])).background).toEqual([]);
  });

  test("puts parent tasks with no owner at the top of their group, in creation order", () => {
    const tree = buildTaskTree(ready([
      row({ id: 3, group: "background", background: true, kind: "forgerie.process-event-delivery" }),
      row({ id: 2 }),
      row({ id: 1, group: "background", background: true }),
    ]));
    expect(shape(tree.thisTurn)).toEqual([2]);
    expect(shape(tree.background)).toEqual([1, 3]);
  });

  test("a task owned by a task outside the response stands on its own", () => {
    expect(shape(buildTaskTree(ready([row({ id: 4, owner: 99 })])).thisTurn)).toEqual([4]);
  });

  test("a child task with no owner and no known agent stays in its group", () => {
    expect(shape(buildTaskTree(ready([row({ id: 4, conversationId: 8, group: "background", background: true })])).background)).toEqual([4]);
  });

  test("an owner cycle never loses its tasks", () => {
    const tree = buildTaskTree(ready([row({ id: 1, owner: 2 }), row({ id: 2, owner: 1 })]));
    expect(tree.rows).toBe(2);
  });

  test("counts what each group holds", () => {
    const tree = buildTaskTree(BUSY);
    expect(groupCount(tree.thisTurn)).toBe("3 tasks");
    expect(groupCount(tree.background)).toBe("2 agents");
    expect(groupCount([...tree.background, ...buildTaskTree(ready([row({ id: 50, group: "background", background: true })])).background])).toBe("2 agents, 1 task");
    expect(groupCount([])).toBe("");
    expect(tree.rows).toBe(10);
  });
});

describe("row words", () => {
  const detail = (task: Partial<TaskRow>, children: TaskNode[] = []) => taskDetail({ kind: "task", task: row({ id: 1, ...task }), children });
  const tool = (id: number): TaskNode => ({ kind: "task", task: row({ id, tool: { name: "read", replay: "safe" } }), children: [] });

  test("say what the task does now", () => {
    expect(detail({ status: "running" })).toBe("Running");
    expect(detail({ status: "pending" })).toBe("Waiting to start");
    expect(detail({ status: "completing" })).toBe("Finishing");
    expect(detail({ status: "waiting" })).toBe("Waiting");
    expect(detail({ status: "waiting", waitingOn: 2 }, [tool(2), tool(3)])).toBe("Waiting for 2 tool calls");
    expect(detail({ status: "waiting", waitingOn: 1 }, [tool(2)])).toBe("Waiting for 1 tool call");
    expect(detail({ status: "waiting", waitingOn: 3 })).toBe("Waiting for 3 tasks");
    expect(detail({ status: "waiting", waitingOn: 1, agentConversationId: 5 })).toBe("Waits for the agent to finish");
  });

  test("say why a blocked task cannot run", () => {
    expect(detail({ status: "blocked", blockedReason: "task_too_old" })).toBe("Cannot run: saved by a newer version");
    expect(detail({ status: "blocked", blockedReason: "missing_task" })).toBe("Cannot run: its code is not loaded");
    expect(detail({ status: "blocked", blockedReason: null })).toBe("Cannot run");
  });

  test("count elapsed time from the start, and leave it blank when the start is unknown", () => {
    const now = 1_000_000_000;
    expect(elapsed(null, now)).toBe("");
    expect(elapsed(now - 41_000, now)).toBe("41 s");
    expect(elapsed(now - 72_000, now)).toBe("1 m 12 s");
    expect(elapsed(now - (2 * 3600 + 14 * 60 + 5) * 1000, now)).toBe("2 h 14 m");
    expect(elapsed(now + 5000, now)).toBe("0 s");
  });
});

describe("the public record", () => {
  test("names kind, task, owner, start, scheduler, and a tool's replay policy", () => {
    const run = buildTaskTree(WORKING).thisTurn[0]!.children[0]!;
    const lines = taskRecord(run, utcClock);
    expect(recordText(lines)).toBe([
      "Kind: pi.tool", "Task: 1842, owned by task 1840", "Started: 14:03:43", "Scheduler: running", "Tool: bash, replay unsafe",
    ].join("\n"));
  });

  test("an agent's record names the agent, and the conversation owns its anchor", () => {
    const agent = buildTaskTree(WORKING).background[0]!;
    expect(recordText(taskRecord(agent, utcClock))).toContain("Agent: ui\nConversation: 5\nKind: forgerie.child-anchor\nTask: 1790, owned by the conversation");
  });

  test("says when the start is not known", () => {
    expect(recordText(taskRecord({ kind: "task", task: row({ id: 3 }), children: [] }, utcClock))).toContain("Started: Not known");
  });
});

describe("the restart note", () => {
  test("promises that everything resumes only when every row resumes", () => {
    expect(restartNote(buildTaskTree(ready([row({ id: 1 }), row({ id: 2 })])))).toEqual({ tone: "plain", text: "If Forgerie restarts now, everything here resumes on its own." });
  });

  test("names the rows that stop, and how many resume", () => {
    expect(restartNote(buildTaskTree(WORKING))).toEqual({ tone: "warn",
      text: "If Forgerie restarts now, 2 tasks stop and are not run again. The other 5 tasks resume on their own." });
  });

  test("names blocked and unknown rows, and never promises they resume", () => {
    expect(restartNote(buildTaskTree(BLOCKED))).toEqual({ tone: "warn", text: "If Forgerie restarts now, 1 task cannot run, now or after a restart." });
    expect(restartNote(buildTaskTree(ready([row({ id: 1, restart: "unknown" }), row({ id: 2 })]))))
      .toEqual({ tone: "plain", text: "If Forgerie restarts now, 1 task may not resume. The other task resumes on its own." });
    expect(restartNote(buildTaskTree(ready([row({ id: 1, restart: "stops" }), row({ id: 2, restart: "blocked" }), row({ id: 3, restart: "unknown" })]))))
      .toEqual({ tone: "warn", text: "If Forgerie restarts now, 1 task stops and is not run again. 1 task cannot run, now or after a restart. 1 task may not resume." });
  });

  test("has nothing to say with no live tasks", () => {
    expect(restartNote(buildTaskTree(ready([])))).toBeUndefined();
  });

  test("counts an agent's anchor task once", () => {
    expect(restartNote(buildTaskTree(IDLE_BACKGROUND))?.text).toBe("If Forgerie restarts now, 1 task stops and is not run again. The other 6 tasks resume on their own.");
  });
});
