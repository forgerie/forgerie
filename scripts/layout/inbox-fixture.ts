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
import type { Project, SessionInfo, Workspace } from "../../src/client/src/api";
import { SessionInboxPanel } from "../../src/client/src/components/SessionInboxPanel";

/** Content heights, in px, for the shelf each state opens. */
const STATES: Record<string, number> = {
  /** Shorter than the space the board can give up: the shelf opens whole. */
  fits: 180,
  /** Taller than the panel at every posture: the board stops at its floor. */
  overflows: 900,
};

const SHELF_ROW_PX = 30;

function session(id: string, minutesAgo: number): SessionInfo {
  const modified = new Date(Date.UTC(2026, 7, 27, 12, 0) - minutesAgo * 60_000).toISOString();
  return {
    id,
    cwd: "/repo",
    path: `/tmp/${id}.jsonl`,
    created: modified,
    modified,
    messageCount: 4,
    firstMessage: `Session ${id}`,
  };
}

function globalSessions(): GlobalSessionsState {
  return {
    machineId: "local",
    status: "fresh",
    sessions: Array.from({ length: 12 }, (_unused, index) => session(`fixture-${String(index)}`, index + 1)),
    statuses: {},
    activities: {},
  };
}

function project(): Project {
  return { id: "proj-1", name: "Repo", path: "/repo", createdAt: "2026-08-27T00:00:00.000Z" };
}

function workspace(): Workspace {
  return {
    id: "ws-1",
    projectId: "proj-1",
    path: "/repo",
    label: "main",
    isMain: true,
    isGitRepo: true,
    isGitWorktree: false,
    effectiveConfig: {},
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
  panel.projects = [project()];
  panel.workspacesByProjectId = { "proj-1": [workspace()] };
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
