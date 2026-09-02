/**
 * Mounts the real SessionInboxPanel in a browser so the inbox floor can be
 * measured.
 *
 * The floor is a space contract between two boxes: a plugin shelf opens at the
 * height its content asks for, and the session board gives up the difference
 * until it reaches its own floor. happy-dom builds both boxes and sizes
 * neither, so the DOM suite can only assert that the rule is written down.
 *
 * The shelf here is a plain element with a stated content height rather than a
 * real plugin: the contract is about height, and a fixture that carried a
 * plugin's markup would measure the plugin instead.
 */
import { html } from "lit";
import type { GlobalSessionsState } from "../../src/client/src/appState";
import type { Project, SessionInfo, SessionStatus, Workspace } from "../../src/client/src/api";
import { SessionInboxPanel } from "../../src/client/src/components/SessionInboxPanel";

/** Content heights, in px, for the shelf each state opens. */
const STATES: Record<string, number> = {
  /** Shorter than the space the board can give up: the shelf opens whole. */
  fits: 180,
  /** Taller than the panel at every posture: the board stops at its floor. */
  overflows: 900,
};

const SHELF_ROW_PX = 30;

/**
 * The rows deliberately disagree with each other on every axis the row's
 * trailing columns are sized from: project name length, whether live work is
 * running, whether the row is pinned, and how long the timestamp reads. A
 * board of identical rows lines up by accident, so it could not tell a shared
 * column model from twelve private ones.
 */
interface RowSpec {
  readonly id: string;
  readonly title: string;
  readonly minutesAgo: number;
  readonly workspace: string;
  readonly pinned?: boolean;
  readonly agents?: number;
  readonly processes?: number;
  /** A question turns the row blocked, which is what gives the board its two-line rows. */
  readonly asking?: string;
  /** A running command turns the row working, with a detail under the title. */
  readonly runningCommand?: boolean;
}

/**
 * Ages are hours, not weeks: the bands past yesterday open collapsed, and a
 * collapsed band renders no rows for the columns to be measured against.
 */
const ROWS: readonly RowSpec[] = [
  { id: "row-a", title: "Property status rollup for the payouts table", minutesAgo: 12, workspace: "/repo", pinned: true, agents: 1 },
  { id: "row-b", title: "sway", minutesAgo: 295, workspace: "/repo", pinned: true },
  { id: "row-c", title: "work agents", minutesAgo: 33, workspace: "/tiny", pinned: true, processes: 2 },
  { id: "row-d", title: "Payouts table redesign", minutesAgo: 46, workspace: "/portal-source", agents: 1, processes: 1 },
  { id: "row-e", title: "org dashboard research", minutesAgo: 61, workspace: "/repo/wt" },
  { id: "row-f", title: "ai rethink", minutesAgo: 240, workspace: "/portal-source" },
  { id: "row-g", title: "handoff-maxout.md", minutesAgo: 3, workspace: "/tiny", agents: 3 },
  { id: "row-h", title: "video playback wake lock", minutesAgo: 1, workspace: "/repo" },
  { id: "row-i", title: "stop sessiond from bumping every resumed session", minutesAgo: 800, workspace: "/repo/wt", processes: 1, asking: "Which of the two candidate fixes should I take?" },
  { id: "row-j", title: "quiet queue", minutesAgo: 900, workspace: "/tiny", asking: "Overwrite the existing report?" },
  { id: "row-k", title: "panel peek", minutesAgo: 420, workspace: "/portal-source", pinned: true, agents: 2 },
  { id: "row-l", title: "composer dictation", minutesAgo: 30, workspace: "/repo", runningCommand: true, processes: 1 },
];

function session(spec: RowSpec): SessionInfo {
  const modified = new Date(Date.now() - spec.minutesAgo * 60_000).toISOString();
  return {
    id: spec.id,
    cwd: spec.workspace,
    path: `/tmp/${spec.id}.jsonl`,
    created: modified,
    modified,
    messageCount: 4,
    firstMessage: spec.title,
    name: spec.title,
    ...(spec.pinned === true ? { pinned: true } : {}),
  };
}

function hasStatus(spec: RowSpec): boolean {
  return spec.agents !== undefined
    || spec.processes !== undefined
    || spec.asking !== undefined
    || spec.runningCommand === true;
}

function status(spec: RowSpec): SessionStatus {
  return {
    sessionId: spec.id,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: spec.runningCommand === true,
    ...(spec.asking === undefined
      ? {}
      : {
          pendingAsk: {
            askId: `${spec.id}-ask`,
            askedAt: new Date().toISOString(),
            questions: [{ id: "q1", question: spec.asking, options: [] }],
          },
        }),
    ...(spec.agents === undefined ? {} : { workingAgents: spec.agents }),
    ...(spec.processes === undefined ? {} : { runningProcesses: spec.processes }),
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  };
}

function globalSessions(): GlobalSessionsState {
  const statuses: Record<string, SessionStatus> = {};
  for (const spec of ROWS) {
    if (!hasStatus(spec)) continue;
    statuses[spec.id] = status(spec);
  }
  return {
    machineId: "local",
    status: "fresh",
    sessions: ROWS.map(session),
    statuses,
    activities: {},
  };
}

/** Three projects whose names differ in length, so the location column has a widest member. */
function projects(): Project[] {
  return [
    { id: "proj-1", name: "amaze-next", path: "/repo", createdAt: "2026-08-27T00:00:00.000Z" },
    { id: "proj-2", name: "pi", path: "/tiny", createdAt: "2026-08-27T00:00:00.000Z" },
    { id: "proj-3", name: "portal-source", path: "/portal-source", createdAt: "2026-08-27T00:00:00.000Z" },
  ];
}

function workspacesByProjectId(): Record<string, Workspace[]> {
  const main = (id: string, projectId: string, path: string): Workspace => ({
    id,
    projectId,
    path,
    label: "main",
    isMain: true,
    isGitRepo: true,
    isGitWorktree: false,
    effectiveConfig: {},
  });
  return {
    "proj-1": [
      main("ws-1", "proj-1", "/repo"),
      { ...main("ws-1b", "proj-1", "/repo/wt"), label: "feat/long-branch-name", isMain: false, isGitWorktree: true },
    ],
    "proj-2": [main("ws-2", "proj-2", "/tiny")],
    "proj-3": [main("ws-3", "proj-3", "/portal-source")],
  };
}

/**
 * A shelf shaped like the ones the inbox hosts: a column that carries its own
 * scroller, so being compressed costs reachability of the content and nothing
 * else.
 */
function shelf(contentPx: number) {
  const rows = Math.max(1, Math.round(contentPx / SHELF_ROW_PX));
  return html`
    <div
      data-fixture-shelf
      style="display: flex; flex-direction: column; min-height: 0; border-top: 1px solid #345;"
    >
      <div
        data-fixture-shelf-scroll
        style="flex: 0 1 auto; min-height: 0; overflow-y: auto;"
      >
        ${Array.from({ length: rows }, (_unused, index) => html`
          <div style="height: ${String(SHELF_ROW_PX)}px;">shelf row ${String(index)}</div>
        `)}
      </div>
    </div>
  `;
}

async function mount(state: string): Promise<void> {
  const contentPx = STATES[state];
  if (contentPx === undefined) throw new Error(`Unknown inbox state ${JSON.stringify(state)}`);
  document.body.replaceChildren();
  const panel = new SessionInboxPanel();
  panel.globalSessions = globalSessions();
  panel.projects = projects();
  panel.workspacesByProjectId = workspacesByProjectId();
  panel.inboxShelves = [shelf(contentPx)];
  document.body.append(panel);
  await panel.updateComplete;
  await new Promise((resolve) => { requestAnimationFrame(() => { requestAnimationFrame(resolve); }); });
}

declare global {
  interface Window {
    mountInbox: (state: string) => Promise<void>;
    inboxStates: readonly string[];
    inboxShelfContentPx: Record<string, number>;
  }
}

window.mountInbox = mount;
// The runner reads the case list and the heights from the model rather than
// keeping its own copy, so a new state cannot be added without being measured.
window.inboxStates = Object.keys(STATES);
window.inboxShelfContentPx = STATES;
