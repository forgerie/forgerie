// Live task reads for the status panel's previews and tests. Each one parses
// against the contract's schema, so a fixture can never drift from the wire.
import { taskActivitySchema, type ReadyTaskActivity, type TaskRow } from "../taskActivityModel";
import type { TaskActivityState } from "../taskActivityStore";

/** The previews' clock. */
export const NOW = Date.UTC(2026, 9, 14, 14, 4, 24);
/** Start times in records, the same in every time zone. */
export const utcClock = (at: number) => new Date(at).toISOString().slice(11, 19);

const PARENT = 1;
const UI = 5;
const REVIEW = 7;
const ago = (seconds: number) => NOW - seconds * 1000;

function task(row: Partial<TaskRow> & Pick<TaskRow, "id" | "kind" | "label" | "status">): TaskRow {
  return {
    subject: null, conversationId: PARENT, owner: null, agentConversationId: null, group: "this-turn", background: false,
    waitingOn: 0, blockedReason: null, scheduler: row.status === "pending" ? "ready" : row.status, startedAt: null, tool: null, restart: "resumes",
    ...row,
  };
}
const ready = (activity: Omit<ReadyTaskActivity, "kind" | "parentConversationId">): ReadyTaskActivity =>
  taskActivitySchema.parse({ kind: "ready", parentConversationId: PARENT, ...activity }) as ReadyTaskActivity;

const THIS_TURN: TaskRow[] = [
  task({ id: 1840, kind: "pi.generation", label: "Answering your message", status: "waiting", waitingOn: 2, startedAt: ago(72) }),
  task({ id: 1842, kind: "pi.tool", label: "Run", subject: "npm test -- durableTriggers", owner: 1840, status: "running", startedAt: ago(41),
    tool: { name: "bash", replay: "unsafe" }, restart: "stops" }),
  task({ id: 1843, kind: "pi.tool", label: "Read", subject: "src/server/triggers/durableTriggers.ts", owner: 1840, status: "running", startedAt: ago(1),
    tool: { name: "read", replay: "safe" } }),
];
const background = (row: Partial<TaskRow> & Pick<TaskRow, "id" | "kind" | "label" | "status">) => task({ group: "background", background: true, ...row });
const UI_AGENT: TaskRow[] = [
  background({ id: 1790, kind: "forgerie.child-anchor", label: "Agent", status: "completing", startedAt: ago(220) }),
  background({ id: 1791, kind: "forgerie.child-reporter", label: "Report back to this session", agentConversationId: UI, status: "waiting", waitingOn: 1, startedAt: ago(220) }),
  background({ id: 1801, kind: "pi.generation", label: "Answering", conversationId: UI, status: "waiting", waitingOn: 1, startedAt: ago(218) }),
  background({ id: 1805, kind: "pi.tool", label: "Edit", subject: "ui/src/triggers/TriggerList.tsx", conversationId: UI, owner: 1801, status: "running",
    startedAt: ago(1), tool: { name: "edit", replay: "unsafe" }, restart: "stops" }),
];
const REVIEW_AGENT: TaskRow[] = [
  background({ id: 1830, kind: "forgerie.child-anchor", label: "Agent", status: "completing", startedAt: ago(52) }),
  background({ id: 1831, kind: "forgerie.child-reporter", label: "Report back to this session", agentConversationId: REVIEW, status: "waiting", waitingOn: 1, startedAt: ago(52) }),
  background({ id: 1832, kind: "pi.generation", label: "Answering", conversationId: REVIEW, status: "running", startedAt: ago(50) }),
];

/** Pi answers the reader and one agent works beside it: seven rows, nothing folded. */
export const WORKING = ready({ backgroundAgents: 1, agents: [{ conversationId: UI, name: "ui", taskId: 1790 }], tasks: [...THIS_TURN, ...UI_AGENT] });
/** Two agents as well: ten rows, so each agent starts folded. */
export const BUSY = ready({ backgroundAgents: 2, agents: [{ conversationId: UI, name: "ui", taskId: 1790 }, { conversationId: REVIEW, name: "review", taskId: 1830 }],
  tasks: [...THIS_TURN, ...UI_AGENT, ...REVIEW_AGENT] });
/** Pi finished its turn; two agents still work. */
export const IDLE_BACKGROUND = ready({ backgroundAgents: 2, agents: BUSY.agents, tasks: [...UI_AGENT, ...REVIEW_AGENT] });
/** A delivery saved by a newer Forgerie, after a rollback: it cannot run. */
export const BLOCKED = ready({ backgroundAgents: 0, agents: [], tasks: [
  background({ id: 2207, kind: "forgerie.gated-action-delivery", label: "Reporting an approval result", status: "blocked", blockedReason: "task_too_old",
    scheduler: "blocked: task_too_old", startedAt: ago(2 * 3600 + 14 * 60), restart: "blocked" }),
] });
/** Pi works, but no task is live yet. */
export const EMPTY = ready({ backgroundAgents: 0, agents: [], tasks: [] });

const read = (activity: TaskActivityState["activity"]): TaskActivityState => ({ activity, reading: false, error: undefined, stale: false });
export const VIEWS = {
  working: read(WORKING),
  busy: read(BUSY),
  idleBackground: read(IDLE_BACKGROUND),
  blocked: read(BLOCKED),
  empty: read(EMPTY),
  unsupported: read({ kind: "unsupported" }),
  loading: { activity: undefined, reading: true, error: undefined, stale: false },
  error: { activity: undefined, reading: false, error: "Session 01a1224a was not found.", stale: false },
  staleError: { activity: WORKING, reading: false, error: "HTTP 500", stale: true },
  staleReconnect: { activity: WORKING, reading: true, error: undefined, stale: true },
} satisfies Record<string, TaskActivityState>;
