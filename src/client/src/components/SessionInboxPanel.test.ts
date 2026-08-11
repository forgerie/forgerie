// @vitest-environment happy-dom

/**
 * Component tests for SessionInboxPanel.
 *
 * Covers: group rendering, default collapse, localStorage persistence,
 * group-by toggle, row selection/archive callbacks, auto-expand on group move,
 * loading/stale/empty states, deleted-workspace row disabled behaviour,
 * and semantic accessibility attributes.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project, SessionActivity, SessionInfo, SessionStatus, Workspace } from "../api";
import type { GlobalSessionsState } from "../appState";
import * as inboxLocation from "../inboxLocation";
import * as sessionBoard from "../sessionBoard";
import { NEW_SESSION_LABEL } from "./shared";
import { SessionInboxPanel } from "./SessionInboxPanel";
import { SessionWorkingRuntime } from "./SessionWorkingRuntime";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkSession(id: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id,
    cwd: "/repo",
    path: `/tmp/${id}.jsonl`,
    created: "2026-08-07T10:00:00.000Z",
    modified: "2026-08-07T10:00:00.000Z",
    messageCount: 0,
    firstMessage: `Message from ${id}`,
    ...overrides,
  };
}

function mkBlockedStatus(sessionId: string): SessionStatus {
  return {
    sessionId,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingAsk: {
      askId: "ask-1",
      askedAt: "2026-08-07T10:00:00.000Z",
      questions: [{ id: "q1", question: "Proceed?", options: [] }],
    },
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  };
}

function mkWorkingStatus(sessionId: string): SessionStatus {
  return {
    sessionId,
    isStreaming: true,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  };
}

function mkGlobalSessions(
  sessions: SessionInfo[],
  overrides: Partial<GlobalSessionsState> = {},
): GlobalSessionsState {
  return {
    machineId: "local",
    status: "fresh",
    sessions,
    statuses: {},
    activities: {},
    ...overrides,
  };
}

function mkProject(id = "proj-1", name = "Repo"): Project {
  return { id, name, path: "/repo", createdAt: "2026-08-07T00:00:00.000Z" };
}

function mkWorkspace(id = "ws-1", projectId = "proj-1", path = "/repo"): Workspace {
  return {
    id,
    projectId,
    path,
    label: "main",
    isMain: true,
    isGitRepo: true,
    isGitWorktree: false,
    effectiveConfig: {},
  };
}

async function mountPanel(props: Partial<SessionInboxPanel> = {}): Promise<SessionInboxPanel> {
  const panel = new SessionInboxPanel();
  panel.projects = [mkProject()];
  panel.workspacesByProjectId = { "proj-1": [mkWorkspace()] };
  Object.assign(panel, props);
  document.body.append(panel);
  await panel.updateComplete;
  return panel;
}

function shadowRoot(panel: SessionInboxPanel): ShadowRoot {
  const root = panel.shadowRoot;
  if (root === null) throw new Error("No shadow root");
  return root;
}

function workingRuntime(panel: SessionInboxPanel): SessionWorkingRuntime {
  const runtime = shadowRoot(panel).querySelector("session-working-runtime");
  if (!(runtime instanceof SessionWorkingRuntime)) throw new Error("No working runtime");
  return runtime;
}

/** Click a DOM element found by selector, if it exists and is an HTMLElement. */
function clickSelector(root: ShadowRoot | Element, selector: string): void {
  const el = root.querySelector(selector);
  if (el instanceof HTMLElement) el.click();
}

/** Pick a grouping mode the way a reader does: open the title menu, then choose. */
async function chooseGroupBy(panel: SessionInboxPanel, mode: "state" | "project"): Promise<void> {
  clickSelector(shadowRoot(panel), "[data-action='group-by-menu']");
  await panel.updateComplete;
  clickSelector(shadowRoot(panel), `[data-group-by='${mode}']`);
  await panel.updateComplete;
}

/** The grouping the title reports, e.g. 'State'. */
function groupingValue(panel: SessionInboxPanel): string | undefined {
  return shadowRoot(panel).querySelector(".board-grouping-value")?.textContent.trim();
}

/** Reveal the archive, which is opt-in: the toggle also expands the group. */
async function revealArchived(panel: SessionInboxPanel): Promise<void> {
  clickSelector(shadowRoot(panel), "[data-action='toggle-archived']");
  await panel.updateComplete;
}

/** Dispatch a board shortcut the way a real key press reaches the window. */
async function pressKey(panel: SessionInboxPanel, key: string): Promise<void> {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, composed: true }));
  await panel.updateComplete;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Update-cycle derivation ownership
// ---------------------------------------------------------------------------

describe("update-cycle derivation ownership", () => {
  it("derives one board with one location resolver for a selected-session update", async () => {
    const deriveBoard = vi.spyOn(sessionBoard, "deriveSessionInboxBoard");
    const createLocationResolver = vi.spyOn(inboxLocation, "createInboxLocationResolver");
    const session = mkSession("selected");
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([session]),
      selectedSession: session,
    });
    deriveBoard.mockClear();
    createLocationResolver.mockClear();

    panel.globalSessions = mkGlobalSessions([session], {
      activities: {
        selected: {
          sessionId: "selected",
          phase: "active",
          label: "running tool",
          at: "2026-08-08T10:00:00.000Z",
        },
      },
    });
    await panel.updateComplete;

    expect(deriveBoard).toHaveBeenCalledTimes(1);
    expect(createLocationResolver).toHaveBeenCalledTimes(1);
  });

  it("does not compute project grouping in state mode", async () => {
    const groupByProject = vi.spyOn(sessionBoard, "groupSessionsByProject");

    await mountPanel({ globalSessions: mkGlobalSessions([mkSession("open")]) });

    expect(groupByProject).not.toHaveBeenCalled();
  });

  it("clears the prior keyboard order on loading and empty transitions", async () => {
    const sessions = [mkSession("first"), mkSession("second")];
    const selected: string[] = [];
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions(sessions),
      onSelectSession: (session) => { selected.push(session.id); },
    });
    clickSelector(shadowRoot(panel), "[data-group='open'] button");
    await panel.updateComplete;

    panel.globalSessions = mkGlobalSessions(sessions, { status: "loading" });
    await panel.updateComplete;
    await pressKey(panel, "j");

    panel.globalSessions = mkGlobalSessions(sessions);
    await panel.updateComplete;
    panel.globalSessions = mkGlobalSessions([]);
    await panel.updateComplete;
    await pressKey(panel, "j");

    expect(selected).toEqual([]);
  });

  it("preserves project attention and row recency order in project mode", async () => {
    localStorage.setItem("forgerie:inbox:local:groupBy", "project");
    const calm = mkSession("calm", { cwd: "/calm" });
    const urgentOlder = mkSession("urgent-older", {
      cwd: "/urgent",
      modified: "2026-08-06T10:00:00.000Z",
    });
    const urgentNewer = mkSession("urgent-newer", {
      cwd: "/urgent",
      modified: "2026-08-08T10:00:00.000Z",
    });
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([calm, urgentOlder, urgentNewer], {
        statuses: {
          "urgent-older": mkBlockedStatus("urgent-older"),
          "urgent-newer": mkBlockedStatus("urgent-newer"),
        },
      }),
      projects: [
        { ...mkProject("calm-project", "Calm"), path: "/calm" },
        { ...mkProject("urgent-project", "Urgent"), path: "/urgent" },
      ],
      workspacesByProjectId: {
        "calm-project": [mkWorkspace("calm-workspace", "calm-project", "/calm")],
        "urgent-project": [mkWorkspace("urgent-workspace", "urgent-project", "/urgent")],
      },
    });
    const groups = shadowRoot(panel).querySelectorAll("[data-group]");

    expect(Array.from(groups, (group) => group.getAttribute("data-group"))).toEqual([
      "urgent-project",
      "calm-project",
    ]);
    expect(Array.from(groups[0]?.querySelectorAll("[data-session]") ?? [], (row) => row.getAttribute("data-session"))).toEqual([
      "urgent-newer",
      "urgent-older",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Group rendering
// ---------------------------------------------------------------------------

describe("group rendering", () => {
  it("renders only non-empty groups, in BOARD_GROUPS order", async () => {
    // Provide sessions in open and archived; those are the only groups that
    // should render. Empty groups (blocked, errored, working, unread) are omitted.
    const sessions: SessionInfo[] = [
      mkSession("open-one"),
      mkSession("archived-one", { archived: true }),
    ];
    const panel = await mountPanel({ globalSessions: mkGlobalSessions(sessions) });
    await revealArchived(panel);
    const root = shadowRoot(panel);

    const headers = root.querySelectorAll("[data-group]");
    const kinds = Array.from(headers).map((el) => el.getAttribute("data-group"));

    // Only the two populated groups appear.
    expect(kinds).toContain("open");
    expect(kinds).toContain("archived");
    // Empty groups are hidden.
    expect(kinds).not.toContain("blocked");
    expect(kinds).not.toContain("errored");
    expect(kinds).not.toContain("working");
    expect(kinds).not.toContain("unread");

    // open comes before archived.
    expect(kinds.indexOf("open")).toBeLessThan(kinds.indexOf("archived"));
  });

  it("shows the correct count badge for each group", async () => {
    const sessions: SessionInfo[] = [
      mkSession("open-one"),
      mkSession("open-two"),
      mkSession("archived-one", { archived: true }),
    ];
    const panel = await mountPanel({ globalSessions: mkGlobalSessions(sessions) });
    await revealArchived(panel);
    const root = shadowRoot(panel);

    const openGroup = root.querySelector("[data-group='open']");
    const archivedGroup = root.querySelector("[data-group='archived']");
    expect(openGroup?.querySelector("[data-group-count]")?.textContent).toBe("2");
    expect(archivedGroup?.querySelector("[data-group-count]")?.textContent).toBe("1");
  });

  it("shows a row for each session in the correct group", async () => {
    const sessions: SessionInfo[] = [
      mkSession("open-one"),
      mkSession("archived-one", { archived: true }),
    ];
    const panel = await mountPanel({ globalSessions: mkGlobalSessions(sessions) });
    const root = shadowRoot(panel);

    // Expand Open and reveal Archived so rows are visible.
    clickSelector(root, "[data-group='open'] button");
    await panel.updateComplete;
    await revealArchived(panel);

    const openRow = root.querySelector("[data-session='open-one']");
    const archivedRow = root.querySelector("[data-session='archived-one']");
    expect(openRow).not.toBeNull();
    expect(archivedRow).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Default collapse — Open and Archived start collapsed
// ---------------------------------------------------------------------------

describe("default collapse", () => {
  it("Open group is collapsed by default", async () => {
    const sessions = [mkSession("open-one")];
    const panel = await mountPanel({ globalSessions: mkGlobalSessions(sessions) });
    const root = shadowRoot(panel);

    const openGroup = root.querySelector("[data-group='open']");
    expect(openGroup?.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps the archive shelf shut until it is asked to open", async () => {
    const sessions = [mkSession("archived-one", { archived: true })];
    const panel = await mountPanel({ globalSessions: mkGlobalSessions(sessions) });
    const root = shadowRoot(panel);

    // The shelf announces the archive without spending the list on it.
    const shelf = root.querySelector("[data-archive-shelf]");
    expect(shelf?.getAttribute("aria-expanded")).toBe("false");
    expect(shelf?.querySelector("[data-archive-count]")?.textContent).toBe("1");
    expect(root.querySelector("[data-session='archived-one']")).toBeNull();

    await revealArchived(panel);

    expect(root.querySelector("[data-group='archived']")?.getAttribute("aria-expanded")).toBe("true");
    expect(root.querySelector("[data-session='archived-one']")).not.toBeNull();
  });

  it("renders no shelf when the machine has never archived anything", async () => {
    const panel = await mountPanel({ globalSessions: mkGlobalSessions([mkSession("open-one")]) });

    expect(shadowRoot(panel).querySelector("[data-group='archived']")).toBeNull();
  });

  it("blocked group is expanded by default", async () => {
    const sessions = [mkSession("blocked-one")];
    const gs = mkGlobalSessions(sessions, {
      statuses: { "blocked-one": mkBlockedStatus("blocked-one") },
    });
    const panel = await mountPanel({ globalSessions: gs });
    const root = shadowRoot(panel);

    const blockedGroup = root.querySelector("[data-group='blocked']");
    expect(blockedGroup?.getAttribute("aria-expanded")).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// localStorage persistence
// ---------------------------------------------------------------------------

describe("localStorage persistence", () => {
  it("expanding a group persists across component re-creation", async () => {
    const sessions = [mkSession("open-one")];
    const gs = mkGlobalSessions(sessions);

    // Mount, expand Open.
    const panel = await mountPanel({ globalSessions: gs });
    const root = shadowRoot(panel);
    clickSelector(root, "[data-group='open'] button");
    await panel.updateComplete;

    // Confirm expanded.
    expect(shadowRoot(panel).querySelector("[data-group='open']")?.getAttribute("aria-expanded")).toBe("true");

    // Unmount and recreate.
    panel.remove();
    const panel2 = await mountPanel({ globalSessions: gs });
    const openGroup2 = shadowRoot(panel2).querySelector("[data-group='open']");
    expect(openGroup2?.getAttribute("aria-expanded")).toBe("true");
  });

  it("group-by toggle persists across re-creation", async () => {
    const sessions = [mkSession("open-one")];
    const gs = mkGlobalSessions(sessions);

    const panel = await mountPanel({ globalSessions: gs });

    // Switch to project view.
    await chooseGroupBy(panel, "project");

    panel.remove();

    const panel2 = await mountPanel({ globalSessions: gs });
    expect(groupingValue(panel2)).toBe("Project");
  });
});

// ---------------------------------------------------------------------------
// Row selection and archive callbacks
// ---------------------------------------------------------------------------

describe("row callbacks", () => {
  it("clicking a row fires onSelectSession with the session", async () => {
    const sessions = [mkSession("open-one")];
    const gs = mkGlobalSessions(sessions);
    const selected: SessionInfo[] = [];

    const panel = await mountPanel({
      globalSessions: gs,
      onSelectSession: (s) => { selected.push(s); },
    });
    const root = shadowRoot(panel);

    // Expand Open to see the row.
    clickSelector(root, "[data-group='open'] button");
    await panel.updateComplete;

    const row = root.querySelector("[data-session='open-one']");
    expect(row).not.toBeNull();
    if (row instanceof HTMLElement) row.click();
    await panel.updateComplete;

    expect(selected).toHaveLength(1);
    expect(selected[0]?.id).toBe("open-one");
  });

  it("archive button click fires onArchiveSession, not onSelectSession", async () => {
    const sessions = [mkSession("open-one")];
    const gs = mkGlobalSessions(sessions);
    const archived: string[] = [];
    const selected: string[] = [];

    const panel = await mountPanel({
      globalSessions: gs,
      onArchiveSession: (s) => { archived.push(s.id); },
      onSelectSession: (s) => { selected.push(s.id); },
    });
    const root = shadowRoot(panel);

    clickSelector(root, "[data-group='open'] button");
    await panel.updateComplete;

    const archiveBtn = root.querySelector("[data-session='open-one'] [data-action='archive']");
    expect(archiveBtn).not.toBeNull();
    if (archiveBtn instanceof HTMLElement) archiveBtn.click();
    await panel.updateComplete;

    expect(archived).toContain("open-one");
    expect(selected).toHaveLength(0);
  });

  it("restore button click fires onRestoreSession for an archived row", async () => {
    const sessions = [mkSession("archived-one", { archived: true })];
    const gs = mkGlobalSessions(sessions);
    const restored: string[] = [];

    const panel = await mountPanel({
      globalSessions: gs,
      onRestoreSession: (s) => { restored.push(s.id); },
    });
    const root = shadowRoot(panel);

    await revealArchived(panel);

    const restoreBtn = root.querySelector("[data-session='archived-one'] [data-action='restore']");
    expect(restoreBtn).not.toBeNull();
    if (restoreBtn instanceof HTMLElement) restoreBtn.click();
    await panel.updateComplete;

    expect(restored).toContain("archived-one");
  });
});

// ---------------------------------------------------------------------------
// Archive action hit area (≥44px)
// ---------------------------------------------------------------------------

describe("archive action accessibility", () => {
  it("archive button has a data-action='archive' attribute for CSS ≥44px min-height", async () => {
    const sessions = [mkSession("open-one")];
    const panel = await mountPanel({ globalSessions: mkGlobalSessions(sessions) });
    const root = shadowRoot(panel);

    clickSelector(root, "[data-group='open'] button");
    await panel.updateComplete;

    const archiveBtn = root.querySelector("[data-session='open-one'] [data-action='archive']");
    expect(archiveBtn).not.toBeNull();
    // The min-height CSS rule keys off data-action="archive"; DOM presence confirms wiring.
    expect(archiveBtn?.getAttribute("data-action")).toBe("archive");
  });
});

// ---------------------------------------------------------------------------
// Selected session group auto-expand
// ---------------------------------------------------------------------------

describe("selected session group auto-expand", () => {
  it("auto-expands a group when the selected session is assigned to it", async () => {
    // Open is collapsed by default; set selectedSession to a session in Open.
    const sessions = [mkSession("open-one")];
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions(sessions),
      selectedSession: sessions[0],
    });
    const root = shadowRoot(panel);

    // Open should be auto-expanded because the selected session is in it.
    const openGroup = root.querySelector("[data-group='open']");
    expect(openGroup?.getAttribute("aria-expanded")).toBe("true");
  });

  it("does not reveal the archive when the selected session is archived", async () => {
    const archived = mkSession("archived-one", { archived: true });
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([archived]),
      selectedSession: archived,
    });

    expect(shadowRoot(panel).querySelector("[data-session='archived-one']")).toBeNull();
    expect(shadowRoot(panel).querySelector("[data-action='toggle-archived']")?.getAttribute("aria-expanded")).toBe("false");
  });

  it("expands the destination group when the same selected id moves via live activity", async () => {
    const session = mkSession("moving-one");
    localStorage.setItem("forgerie:inbox:local:collapsed", JSON.stringify(["open", "working"]));
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([session]),
      selectedSession: session,
    });
    const activity: SessionActivity = {
      sessionId: session.id,
      phase: "active",
      label: "running tool",
      at: "2026-08-08T10:00:00.000Z",
    };

    panel.globalSessions = mkGlobalSessions([session], { activities: { [session.id]: activity } });
    await panel.updateComplete;
    await panel.updateComplete;

    const workingGroup = shadowRoot(panel).querySelector("[data-group='working']");
    expect(workingGroup?.getAttribute("aria-expanded")).toBe("true");
  });

  it("uses projectId to expand a collapsed project containing the selected session", async () => {
    const session = mkSession("project-selected");
    localStorage.setItem("forgerie:inbox:local:groupBy", "project");
    localStorage.setItem("forgerie:inbox:local:collapsed", JSON.stringify(["proj-1"]));

    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([session]),
      selectedSession: session,
    });

    expect(shadowRoot(panel).querySelector("[data-group='proj-1']")?.getAttribute("aria-expanded")).toBe("true");
  });

  it("re-expands the selected destination after the grouping mode changes", async () => {
    const session = mkSession("mode-selected");
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([session]),
      selectedSession: session,
    });
    const root = shadowRoot(panel);

    await chooseGroupBy(panel, "project");
    clickSelector(root, "[data-group='proj-1'] > button");
    await panel.updateComplete;
    expect(root.querySelector("[data-group='proj-1']")?.getAttribute("aria-expanded")).toBe("false");

    await chooseGroupBy(panel, "state");
    await chooseGroupBy(panel, "project");
    await panel.updateComplete;

    expect(root.querySelector("[data-group='proj-1']")?.getAttribute("aria-expanded")).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// Loading / stale / empty states
// ---------------------------------------------------------------------------

describe("panel states", () => {
  it("shows a loading indicator when globalSessions is undefined", async () => {
    const panel = await mountPanel({ globalSessions: undefined });
    const root = shadowRoot(panel);

    const loading = root.querySelector("[data-state='loading']");
    expect(loading).not.toBeNull();
  });

  it("shows a loading indicator when globalSessions.status is 'loading'", async () => {
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([], { status: "loading" }),
    });
    const root = shadowRoot(panel);

    const loading = root.querySelector("[data-state='loading']");
    expect(loading).not.toBeNull();
  });

  it("shows a stale indicator when globalSessions.status is 'stale'", async () => {
    const sessions = [mkSession("open-one")];
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions(sessions, { status: "stale" }),
    });
    const root = shadowRoot(panel);

    const stale = root.querySelector("[data-state='stale']");
    expect(stale).not.toBeNull();
  });

  it("shows the 'no sessions' empty state when the machine has no sessions at all", async () => {
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([]),
    });
    const root = shadowRoot(panel);

    const empty = root.querySelector("[data-state='empty']");
    expect(empty).not.toBeNull();
  });

  it("shows all-clear state when only archived sessions exist", async () => {
    const sessions = [mkSession("archived-one", { archived: true })];
    const panel = await mountPanel({ globalSessions: mkGlobalSessions(sessions) });
    const root = shadowRoot(panel);

    const allClear = root.querySelector("[data-state='all-clear']");
    expect(allClear).not.toBeNull();
  });

  it("shows stale indicator even in all-clear state", async () => {
    const sessions = [mkSession("archived-one", { archived: true })];
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions(sessions, { status: "stale" }),
    });
    const root = shadowRoot(panel);

    const allClear = root.querySelector("[data-state='all-clear']");
    const stale = root.querySelector("[data-state='stale']");
    expect(allClear).not.toBeNull();
    expect(stale).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Deleted-workspace rows
// ---------------------------------------------------------------------------

describe("unresolved-workspace rows", () => {
  it("keeps a row enabled until navigation confirms its workspace was removed", async () => {
    const session = mkSession("orphan-one", { cwd: "/not-loaded-yet" });
    const panel = await mountPanel({ globalSessions: mkGlobalSessions([session]) });
    const root = shadowRoot(panel);

    clickSelector(root, "[data-group='open'] button");
    await panel.updateComplete;

    const row = root.querySelector("[data-session='orphan-one']");
    const chip = row?.querySelector("[data-location-chip]");
    expect(row?.getAttribute("aria-disabled")).toBe("false");
    expect(chip?.textContent.trim()).toBe("not-loaded-yet");
    expect(chip?.getAttribute("title")).toBe("/not-loaded-yet");
  });

  it("lets an unresolved row request lazy workspace resolution", async () => {
    const session = mkSession("orphan-one", { cwd: "/not-loaded-yet" });
    const selected: string[] = [];
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([session]),
      onSelectSession: (s) => { selected.push(s.id); },
    });
    const root = shadowRoot(panel);

    clickSelector(root, "[data-group='open'] button");
    await panel.updateComplete;

    const row = root.querySelector("[data-session='orphan-one']");
    if (row instanceof HTMLElement) row.click();

    expect(selected).toEqual(["orphan-one"]);
  });
});

// ---------------------------------------------------------------------------
// unavailableCwds prop
// ---------------------------------------------------------------------------

describe("unavailableCwds prop", () => {
  it("disables a row whose cwd is in unavailableCwds even when the workspace is known", async () => {
    // The workspace IS in the locationMap (not truly deleted) but the cwd is
    // in unavailableCwds because a previous navigation attempt found no match
    // after lazy loading. The row should render as disabled.
    const session = mkSession("known-ws-session");
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([session]),
      projects: [mkProject()],
      workspacesByProjectId: { "proj-1": [mkWorkspace()] },
      unavailableCwds: new Set(["/repo"]),
    });
    const root = shadowRoot(panel);

    clickSelector(root, "[data-group='open'] button");
    await panel.updateComplete;

    const row = root.querySelector("[data-session='known-ws-session']");
    expect(row?.getAttribute("aria-disabled")).toBe("true");
  });

  it("shows 'workspace removed' chip when cwd is in unavailableCwds even if workspace is in locationMap", async () => {
    // cwd=/repo IS in the locationMap (via the default workspace) but the
    // cwd is also in unavailableCwds because a lazy-load navigation attempt
    // confirmed no workspace matched. The chip must show 'workspace removed',
    // not the project name.
    const session = mkSession("unavail-session", { cwd: "/repo" });
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([session]),
      projects: [mkProject()],
      workspacesByProjectId: { "proj-1": [mkWorkspace()] },
      unavailableCwds: new Set(["/repo"]),
    });
    const root = shadowRoot(panel);

    clickSelector(root, "[data-group='open'] button");
    await panel.updateComplete;

    const chip = root.querySelector("[data-session='unavail-session'] [data-location-chip]");
    expect(chip?.textContent).toContain("workspace removed");
  });
});

// ---------------------------------------------------------------------------
// Semantic accessibility
// ---------------------------------------------------------------------------

describe("accessibility", () => {
  it("group section header has aria-expanded reflecting collapse state", async () => {
    const sessions = [mkSession("open-one")];
    const panel = await mountPanel({ globalSessions: mkGlobalSessions(sessions) });
    const root = shadowRoot(panel);

    const openGroup = root.querySelector("[data-group='open']");
    expect(openGroup?.getAttribute("aria-expanded")).toBe("false");

    clickSelector(root, "[data-group='open'] button");
    await panel.updateComplete;
    expect(root.querySelector("[data-group='open']")?.getAttribute("aria-expanded")).toBe("true");
  });

  it("selected row has aria-selected='true'", async () => {
    const session = mkSession("open-one");
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([session]),
      selectedSession: session,
    });
    const root = shadowRoot(panel);

    // Open group auto-expands because selected session is in it.
    const row = root.querySelector("[data-session='open-one']");
    expect(row?.getAttribute("aria-selected")).toBe("true");
  });

  it("keeps focus on a selected row through an ordinary board recomputation", async () => {
    const session = mkSession("focused");
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([session]),
      selectedSession: session,
    });
    const row = shadowRoot(panel).querySelector("[data-session='focused']");
    if (!(row instanceof HTMLElement)) throw new Error("Expected focused session row");
    row.focus();

    panel.globalSessions = mkGlobalSessions([session]);
    await panel.updateComplete;

    const focusedRow = shadowRoot(panel).activeElement;
    expect(focusedRow?.getAttribute("data-session")).toBe("focused");
    expect(focusedRow?.getAttribute("aria-selected")).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// Location chip
// ---------------------------------------------------------------------------

describe("location chip", () => {
  it("shows project name for sessions with a known workspace", async () => {
    const session = mkSession("open-one", { cwd: "/repo" });
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([session]),
      projects: [mkProject("proj-1", "My Repo")],
      workspacesByProjectId: { "proj-1": [mkWorkspace("ws-1", "proj-1", "/repo")] },
    });
    const root = shadowRoot(panel);

    clickSelector(root, "[data-group='open'] button");
    await panel.updateComplete;

    const chip = root.querySelector("[data-session='open-one'] [data-location-chip]");
    expect(chip?.textContent).toContain("My Repo");
  });

  it("shows workspace label when not main branch", async () => {
    const session = mkSession("feat-one", { cwd: "/repo-feat" });
    const ws: Workspace = {
      id: "ws-feat",
      projectId: "proj-1",
      path: "/repo-feat",
      label: "feat/inbox",
      isMain: false,
      isGitRepo: true,
      isGitWorktree: true,
      effectiveConfig: {},
    };
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([session]),
      projects: [mkProject("proj-1", "My Repo")],
      workspacesByProjectId: { "proj-1": [ws] },
    });
    const root = shadowRoot(panel);

    clickSelector(root, "[data-group='open'] button");
    await panel.updateComplete;

    const chip = root.querySelector("[data-session='feat-one'] [data-location-chip]");
    expect(chip?.textContent).toContain("feat/inbox");
  });
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Undo toast
// ---------------------------------------------------------------------------

describe("undo toast", () => {
  it("is not rendered when undoToast prop is undefined", async () => {
    const sessions = [mkSession("open-one")];
    const panel = await mountPanel({ globalSessions: mkGlobalSessions(sessions) });
    const root = shadowRoot(panel);

    const toast = root.querySelector("[data-undo-toast]");
    expect(toast).toBeNull();
  });

  it("renders the undo toast when undoToast prop is set", async () => {
    const session = mkSession("archived-one");
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([session]),
      undoToast: { session },
    });
    const root = shadowRoot(panel);

    const toast = root.querySelector("[data-undo-toast]");
    expect(toast).not.toBeNull();
  });

  it("clicking Undo fires onUndoArchive", async () => {
    const session = mkSession("archived-one");
    let undoCalled = false;
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([session]),
      undoToast: { session },
      onUndoArchive: () => { undoCalled = true; },
    });
    const root = shadowRoot(panel);

    const undoBtn = root.querySelector("[data-action='undo-archive']");
    expect(undoBtn).not.toBeNull();
    if (undoBtn instanceof HTMLElement) undoBtn.click();
    await panel.updateComplete;

    expect(undoCalled).toBe(true);
  });

  it("clicking Dismiss fires onDismissUndoToast", async () => {
    const session = mkSession("archived-one");
    let dismissCalled = false;
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([session]),
      undoToast: { session },
      onDismissUndoToast: () => { dismissCalled = true; },
    });
    const root = shadowRoot(panel);

    const dismissBtn = root.querySelector("[data-action='dismiss-undo']");
    expect(dismissBtn).not.toBeNull();
    if (dismissBtn instanceof HTMLElement) dismissBtn.click();
    await panel.updateComplete;

    expect(dismissCalled).toBe(true);
  });

  it("toast shows the session title", async () => {
    const session = mkSession("archived-one", { firstMessage: "My important task" });
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([session]),
      undoToast: { session },
    });
    const root = shadowRoot(panel);

    const toast = root.querySelector("[data-undo-toast]");
    expect(toast?.textContent).toContain("My important task");
  });

  it("toast disappears when undoToast prop is set to undefined", async () => {
    const session = mkSession("archived-one");
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([session]),
      undoToast: { session },
    });
    const root = shadowRoot(panel);
    expect(root.querySelector("[data-undo-toast]")).not.toBeNull();

    // Use Reflect.set to assign undefined with exactOptionalPropertyTypes.
    Reflect.set(panel, "undoToast", undefined);
    await panel.updateComplete;

    expect(root.querySelector("[data-undo-toast]")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// New session callback
// ---------------------------------------------------------------------------

describe("new session callback", () => {
  it("fires onNewSession when the header action is clicked", async () => {
    const onNewSession = vi.fn();
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([]),
      onNewSession,
    });
    const root = shadowRoot(panel);

    const newBtn = root.querySelector<HTMLButtonElement>(".board-actions [data-action='new-session']");
    expect(newBtn).not.toBeNull();
    expect(newBtn?.title).toBe(NEW_SESSION_LABEL);
    expect(newBtn?.getAttribute("aria-label")).toBe(NEW_SESSION_LABEL);
    expect(newBtn?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    newBtn?.click();
    await panel.updateComplete;

    expect(onNewSession).toHaveBeenCalledOnce();
  });

  it("uses the exact shared New session contract for the empty-inbox CTA", async () => {
    const onNewSession = vi.fn();
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([]),
      onNewSession,
    });

    const action = shadowRoot(panel).querySelector<HTMLButtonElement>("[data-state='empty'] [data-action='new-session']");
    expect(action).not.toBeNull();
    expect(action?.textContent.trim()).toBe(NEW_SESSION_LABEL);
    expect(action?.title).toBe(NEW_SESSION_LABEL);
    expect(action?.getAttribute("aria-label")).toBe(NEW_SESSION_LABEL);
    expect(action?.querySelector("svg.new-session-icon")?.getAttribute("aria-hidden")).toBe("true");

    action?.click();
    await panel.updateComplete;

    expect(onNewSession).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

describe("header", () => {
  it("names the current grouping in the title", async () => {
    const panel = await mountPanel({ globalSessions: mkGlobalSessions([mkSession("open-one")]) });

    expect(groupingValue(panel)).toBe("State");

    await chooseGroupBy(panel, "project");
    expect(groupingValue(panel)).toBe("Project");
  });

  it("marks the grouping menu closed until the title is used", async () => {
    const panel = await mountPanel({ globalSessions: mkGlobalSessions([mkSession("open-one")]) });
    const root = shadowRoot(panel);

    expect(root.querySelector("[data-action='group-by-menu']")?.getAttribute("aria-expanded")).toBe("false");
    expect(root.querySelector("[data-group-by='project']")).toBeNull();

    clickSelector(root, "[data-action='group-by-menu']");
    await panel.updateComplete;

    expect(root.querySelector("[data-action='group-by-menu']")?.getAttribute("aria-expanded")).toBe("true");
    expect(root.querySelector("[data-group-by='state']")?.getAttribute("aria-checked")).toBe("true");
  });

  it("reaches workspace management and app actions through the overflow menu", async () => {
    const opened: string[] = [];
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([mkSession("open-one")]),
      onManageWorkspaces: () => { opened.push("workspaces"); },
      onShowActions: () => { opened.push("actions"); },
    });
    const root = shadowRoot(panel);

    expect(root.querySelector("[data-action='manage-workspaces']")).toBeNull();

    clickSelector(root, "[data-action='board-menu']");
    await panel.updateComplete;
    clickSelector(root, "[data-action='manage-workspaces']");
    await panel.updateComplete;

    clickSelector(root, "[data-action='board-menu']");
    await panel.updateComplete;
    clickSelector(root, "[data-action='show-actions']");
    await panel.updateComplete;

    expect(opened).toEqual(["workspaces", "actions"]);
    expect(root.querySelector("[data-action='manage-workspaces']")).toBeNull();
  });

  it("omits app actions when the shell offers none", async () => {
    const panel = await mountPanel({ globalSessions: mkGlobalSessions([mkSession("open-one")]) });
    const root = shadowRoot(panel);

    clickSelector(root, "[data-action='board-menu']");
    await panel.updateComplete;

    expect(root.querySelector("[data-action='manage-workspaces']")).not.toBeNull();
    expect(root.querySelector("[data-action='show-actions']")).toBeNull();
  });

  it("closes an open menu on Escape", async () => {
    const panel = await mountPanel({ globalSessions: mkGlobalSessions([mkSession("open-one")]) });
    const root = shadowRoot(panel);

    clickSelector(root, "[data-action='board-menu']");
    await panel.updateComplete;
    expect(root.querySelector("#inbox-board-menu")).not.toBeNull();

    await pressKey(panel, "Escape");

    expect(root.querySelector("#inbox-board-menu")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Archived visibility toggle
// ---------------------------------------------------------------------------

describe("archived visibility toggle", () => {
  it("hides archived sessions again when the inbox remounts", async () => {
    const sessions = [mkSession("open-one"), mkSession("archived-one", { archived: true })];
    const panel = await mountPanel({ globalSessions: mkGlobalSessions(sessions) });

    expect(shadowRoot(panel).querySelector("[data-action='toggle-archived']")?.getAttribute("aria-expanded")).toBe("false");

    await revealArchived(panel);
    expect(shadowRoot(panel).querySelector("[data-action='toggle-archived']")?.getAttribute("aria-expanded")).toBe("true");

    const remounted = await mountPanel({ globalSessions: mkGlobalSessions(sessions) });
    expect(shadowRoot(remounted).querySelector("[data-session='archived-one']")).toBeNull();
    expect(shadowRoot(remounted).querySelector("[data-action='toggle-archived']")?.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps archived out of the project grouping until it is revealed", async () => {
    const sessions = [mkSession("open-one"), mkSession("archived-one", { archived: true })];
    const panel = await mountPanel({ globalSessions: mkGlobalSessions(sessions) });
    const root = shadowRoot(panel);

    await chooseGroupBy(panel, "project");
    expect(root.querySelector("[data-session='archived-one']")).toBeNull();

    await revealArchived(panel);
    expect(root.querySelector("[data-session='archived-one']")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Location metadata
// ---------------------------------------------------------------------------

describe("location metadata", () => {
  it("names the project for a workspace that was never listed", async () => {
    const sessions = [mkSession("open-one", { cwd: "/repo/.worktrees/feat/session-inbox" })];
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions(sessions),
      workspacesByProjectId: {},
    });
    const root = shadowRoot(panel);

    clickSelector(root, "[data-group='open'] button");
    await panel.updateComplete;

    const chip = root.querySelector("[data-session='open-one'] [data-location-chip]");
    expect(chip?.textContent.replace(/\s+/gu, " ").trim()).toBe("Repo · session-inbox");
  });

  it("shows only the last segment for a cwd outside every project", async () => {
    const sessions = [mkSession("open-one", { cwd: "/elsewhere/scratch" })];
    const panel = await mountPanel({ globalSessions: mkGlobalSessions(sessions) });
    const root = shadowRoot(panel);

    clickSelector(root, "[data-group='open'] button");
    await panel.updateComplete;

    const chip = root.querySelector("[data-session='open-one'] [data-location-chip]");
    expect(chip?.textContent.trim()).toBe("scratch");
    expect(chip?.getAttribute("title")).toBe("/elsewhere/scratch");
  });
});

// ---------------------------------------------------------------------------
// Board shortcuts
// ---------------------------------------------------------------------------

describe("board shortcuts", () => {
  it("J and K walk the rendered rows and select them", async () => {
    const sessions = [mkSession("open-one"), mkSession("open-two")];
    const selected: string[] = [];
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions(sessions),
      onSelectSession: (s) => { selected.push(s.id); },
    });
    clickSelector(shadowRoot(panel), "[data-group='open'] button");
    await panel.updateComplete;

    await pressKey(panel, "j");
    expect(selected).toEqual(["open-one"]);

    panel.selectedSession = sessions[0];
    await panel.updateComplete;
    await pressKey(panel, "j");
    expect(selected).toEqual(["open-one", "open-two"]);

    panel.selectedSession = sessions[1];
    await panel.updateComplete;
    await pressKey(panel, "k");
    expect(selected).toEqual(["open-one", "open-two", "open-one"]);
  });

  it("does not walk rows hidden inside a collapsed group", async () => {
    const selected: string[] = [];
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([mkSession("open-one")]),
      onSelectSession: (s) => { selected.push(s.id); },
    });

    await pressKey(panel, "j");

    expect(selected).toEqual([]);
  });

  it("G switches grouping and A reveals the archive", async () => {
    const sessions = [mkSession("open-one"), mkSession("archived-one", { archived: true })];
    const panel = await mountPanel({ globalSessions: mkGlobalSessions(sessions) });
    const root = shadowRoot(panel);

    await pressKey(panel, "g");
    expect(groupingValue(panel)).toBe("Project");

    await pressKey(panel, "a");
    expect(root.querySelector("[data-session='archived-one']")).not.toBeNull();
  });

  it("ignores shortcuts typed into an input", async () => {
    const sessions = [mkSession("open-one"), mkSession("archived-one", { archived: true })];
    const panel = await mountPanel({ globalSessions: mkGlobalSessions(sessions) });
    const input = document.createElement("input");
    document.body.append(input);

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true, composed: true }));
    await panel.updateComplete;

    expect(shadowRoot(panel).querySelector("[data-action='toggle-archived']")?.getAttribute("aria-expanded")).toBe("false");
  });
});

// ---------------------------------------------------------------------------
// Overlay dismissal
// ---------------------------------------------------------------------------

describe("overlay dismissal", () => {
  it("offers a way back only while the board is overlaid", async () => {
    const docked = await mountPanel({
      globalSessions: mkGlobalSessions([mkSession("open-one")]),
      onCloseOverlay: () => { /* unused while docked */ },
    });
    expect(shadowRoot(docked).querySelector("[data-action='close-overlay']")).toBeNull();

    let closed = 0;
    const overlaid = await mountPanel({
      globalSessions: mkGlobalSessions([mkSession("open-one")]),
      compact: true,
      onCloseOverlay: () => { closed += 1; },
    });
    clickSelector(shadowRoot(overlaid), "[data-action='close-overlay']");
    await overlaid.updateComplete;

    expect(closed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Stylesheet integrity
// ---------------------------------------------------------------------------

describe("stylesheet integrity", () => {
  it("declares nothing outside a selector block", () => {
    // A stray top-level declaration is a CSS parse error, and error recovery
    // swallows the rule that follows it — which silently deleted the whole
    // `.row` layout once already.
    const css = SessionInboxPanel.styles.toString().replace(/\/\*[\s\S]*?\*\//gu, "");
    const strays: string[] = [];
    let depth = 0;
    let prelude = "";
    for (const char of css) {
      if (char === "{") {
        if (depth === 0 && prelude.includes(";")) strays.push(prelude.trim());
        depth += 1;
        prelude = "";
        continue;
      }
      if (char === "}") {
        depth = Math.max(depth - 1, 0);
        continue;
      }
      if (depth === 0) prelude += char;
    }

    expect(strays).toEqual([]);
  });
});

describe("working runtime", () => {
  it("replaces message recency with the active turn runtime and a clock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-11T10:02:30.000Z");
    const session = mkSession("running", { modified: "2026-08-01T00:00:00.000Z" });
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([session], {
        statuses: { running: mkWorkingStatus("running") },
        activities: {
          running: {
            sessionId: "running",
            phase: "active",
            label: "running tool",
            at: "2026-08-11T10:02:15.000Z",
            activeSince: "2026-08-11T10:00:00.000Z",
          },
        },
      }),
    });

    const runtime = workingRuntime(panel);
    const runtimeRoot = runtime.shadowRoot;
    if (runtimeRoot === null) throw new Error("No runtime shadow root");
    expect(runtime.startedAt).toBe("2026-08-11T10:00:00.000Z");
    expect(runtimeRoot.textContent.trim()).toBe("2m");
    expect(runtimeRoot.querySelector("[data-runtime-clock]")).not.toBeNull();
  });

  it("keeps the first observed start until a Working row settles", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-11T10:00:00.000Z");
    const session = mkSession("fallback");
    const working = () => mkGlobalSessions([session], {
      statuses: { fallback: mkWorkingStatus("fallback") },
      activities: {
        fallback: {
          sessionId: "fallback",
          phase: "active",
          label: "agent running",
          at: new Date().toISOString(),
        },
      },
    });
    const panel = await mountPanel({ globalSessions: working(), selectedSession: session });

    expect(workingRuntime(panel).startedAt).toBe("2026-08-11T10:00:00.000Z");
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    panel.globalSessions = working();
    await panel.updateComplete;
    expect(workingRuntime(panel).startedAt).toBe("2026-08-11T10:00:00.000Z");

    panel.globalSessions = mkGlobalSessions([session]);
    await panel.updateComplete;
    panel.globalSessions = working();
    await panel.updateComplete;
    expect(workingRuntime(panel).startedAt).toBe("2026-08-11T10:02:00.000Z");
  });

  it("keeps message recency for a session that is not working", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-07T10:02:00.000Z");
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([mkSession("idle", { modified: "2026-08-07T10:00:00.000Z" })]),
      selectedSession: mkSession("idle"),
    });

    const rowTime = shadowRoot(panel).querySelector(".row-time");
    if (rowTime === null) throw new Error("No row time");
    expect(rowTime.textContent.trim()).toBe("2m");
    expect(shadowRoot(panel).querySelector("session-working-runtime")).toBeNull();
  });
});

describe("live work indicator", () => {
  function statusWith(patch: Record<string, unknown>) {
    return {
      sessionId: "live", isStreaming: true, isCompacting: false, isBashRunning: false,
      pendingMessageCount: 0, queuedMessages: [],
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0,
      ...patch,
    };
  }

  it("shows an icon and a count for agents and processes", async () => {
    const session = mkSession("live", { name: "Busy session" });
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([session], {
        statuses: { live: statusWith({ workingAgents: 2, runningProcesses: 1 }) },
      }),
    });
    const root = shadowRoot(panel);

    const items = root.querySelectorAll("[data-live-work] .live-work-item");
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent.trim()).toBe("2");
    expect(items[1]?.textContent.trim()).toBe("1");
    expect(items[0]?.getAttribute("title")).toBe("2 agents working");
    expect(items[1]?.getAttribute("title")).toBe("1 process running");
  });

  it("omits a count that is zero rather than showing a nought", async () => {
    const session = mkSession("live", { name: "Busy session" });
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([session], {
        statuses: { live: statusWith({ workingAgents: 3 }) },
      }),
    });

    const items = shadowRoot(panel).querySelectorAll("[data-live-work] .live-work-item");
    expect(items).toHaveLength(1);
    expect(items[0]?.getAttribute("title")).toBe("3 agents working");
  });

  it("stays silent for a session with nothing running", async () => {
    const panel = await mountPanel({ globalSessions: mkGlobalSessions([mkSession("idle")]) });

    expect(shadowRoot(panel).querySelector("[data-live-work]")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Swipe to archive
//
// The gesture reads pointerType from the event, so these tests send real
// pointer events and never touch a device query.
// ---------------------------------------------------------------------------

/** A named no-op, because the lint bans an empty arrow in place. */
function noop(): void {
  return;
}

/**
 * happy-dom has no PointerEvent, and no layout, so a row measures zero. The
 * helper supplies both: an event carrying pointerType, and a width for the
 * commit distance.
 */
function sendPointer(
  row: HTMLElement,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  init: { pointerType: string; clientX: number; clientY: number },
): void {
  const event = new Event(type, { bubbles: true, composed: true });
  Object.assign(event, init, { pointerId: 1 });
  row.dispatchEvent(event);
}

async function mountRowForSwipe(
  onArchiveSession: (session: SessionInfo) => void,
  onSelectSession: (session: SessionInfo) => void = noop,
): Promise<{ panel: SessionInboxPanel; row: HTMLElement }> {
  const panel = await mountPanel({
    globalSessions: mkGlobalSessions([mkSession("open-one")]),
    onArchiveSession,
    onSelectSession,
  });
  const root = shadowRoot(panel);
  clickSelector(root, "[data-group='open'] button");
  await panel.updateComplete;

  const row = root.querySelector("[data-session='open-one']");
  if (!(row instanceof HTMLElement)) throw new Error("No row");
  // No layout in happy-dom: give the row a width so the commit distance is real.
  row.getBoundingClientRect = () => new DOMRect(0, 0, 340, 56);
  row.setPointerCapture = noop;
  return { panel, row };
}

describe("swipe to archive", () => {
  it("archives when a finger carries the row past the commit distance", async () => {
    const archived: string[] = [];
    const { row } = await mountRowForSwipe((s) => { archived.push(s.id); });

    sendPointer(row, "pointerdown", { pointerType: "touch", clientX: 300, clientY: 100 });
    sendPointer(row, "pointermove", { pointerType: "touch", clientX: 160, clientY: 100 });
    sendPointer(row, "pointerup", { pointerType: "touch", clientX: 160, clientY: 100 });

    expect(archived).toEqual(["open-one"]);
  });

  it("returns the row and archives nothing when the finger stops short", async () => {
    const archived: string[] = [];
    const { row } = await mountRowForSwipe((s) => { archived.push(s.id); });

    sendPointer(row, "pointerdown", { pointerType: "touch", clientX: 300, clientY: 100 });
    sendPointer(row, "pointermove", { pointerType: "touch", clientX: 270, clientY: 100 });
    sendPointer(row, "pointerup", { pointerType: "touch", clientX: 270, clientY: 100 });

    expect(archived).toEqual([]);
    expect(row.parentElement?.style.getPropertyValue("--swipe-x")).toBe("0px");
  });

  it("leaves the row alone when the finger scrolls the list", async () => {
    const archived: string[] = [];
    const { row } = await mountRowForSwipe((s) => { archived.push(s.id); });

    // Down the list, with the sideways drift a real finger produces.
    sendPointer(row, "pointerdown", { pointerType: "touch", clientX: 300, clientY: 400 });
    sendPointer(row, "pointermove", { pointerType: "touch", clientX: 270, clientY: 200 });
    sendPointer(row, "pointerup", { pointerType: "touch", clientX: 270, clientY: 200 });

    expect(archived).toEqual([]);
  });

  it("does not open the session after a swipe", async () => {
    const selected: string[] = [];
    const { row } = await mountRowForSwipe(noop, (s) => { selected.push(s.id); });

    sendPointer(row, "pointerdown", { pointerType: "touch", clientX: 300, clientY: 100 });
    sendPointer(row, "pointermove", { pointerType: "touch", clientX: 160, clientY: 100 });
    sendPointer(row, "pointerup", { pointerType: "touch", clientX: 160, clientY: 100 });
    row.click();

    expect(selected).toEqual([]);
  });

  it("still opens the session on a tap", async () => {
    const selected: string[] = [];
    const { row } = await mountRowForSwipe(noop, (s) => { selected.push(s.id); });

    sendPointer(row, "pointerdown", { pointerType: "touch", clientX: 300, clientY: 100 });
    sendPointer(row, "pointerup", { pointerType: "touch", clientX: 300, clientY: 100 });
    row.click();

    expect(selected).toEqual(["open-one"]);
  });

  it("ignores a mouse drag, which has its own action row", async () => {
    const archived: string[] = [];
    const { row } = await mountRowForSwipe((s) => { archived.push(s.id); });

    sendPointer(row, "pointerdown", { pointerType: "mouse", clientX: 300, clientY: 100 });
    sendPointer(row, "pointermove", { pointerType: "mouse", clientX: 100, clientY: 100 });
    sendPointer(row, "pointerup", { pointerType: "mouse", clientX: 100, clientY: 100 });

    expect(archived).toEqual([]);
  });

  it("archives nothing when the gesture is cancelled", async () => {
    const archived: string[] = [];
    const { row } = await mountRowForSwipe((s) => { archived.push(s.id); });

    sendPointer(row, "pointerdown", { pointerType: "touch", clientX: 300, clientY: 100 });
    sendPointer(row, "pointermove", { pointerType: "touch", clientX: 160, clientY: 100 });
    sendPointer(row, "pointercancel", { pointerType: "touch", clientX: 160, clientY: 100 });

    expect(archived).toEqual([]);
  });
});
