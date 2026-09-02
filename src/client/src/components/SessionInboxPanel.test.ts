// @vitest-environment happy-dom

/**
 * Component tests for SessionInboxPanel.
 *
 * Covers: group rendering, default collapse, localStorage persistence,
 * group-by toggle, row selection/archive callbacks, auto-expand on group move,
 * loading/stale/empty states, deleted-workspace row disabled behaviour,
 * and semantic accessibility attributes.
 */

import { html } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project, SessionActivity, SessionInfo, SessionStatus, Workspace } from "../api";
import type { GlobalSessionsState } from "../appState";
import * as inboxLocation from "../inboxLocation";
import * as sessionBoard from "../sessionBoard";
import { ROW_PRESS } from "../rowPress";
import { NEW_SESSION_LABEL } from "./shared";
import { SessionInboxPanel } from "./SessionInboxPanel";
import { SessionWorkingRuntime } from "./SessionWorkingRuntime";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recent enough to land in the `hour` age band, which is open by default.
 * Idle rows are grouped by age now, so a fixture pinned to a fixed date would
 * drift into a collapsed band as the calendar moves and stop rendering.
 */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function mkSession(id: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id,
    cwd: "/repo",
    path: `/tmp/${id}.jsonl`,
    created: "2026-08-07T10:00:00.000Z",
    modified: minutesAgo(5),
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

/** Reveal the archive through the inbox overflow menu. */
async function revealArchived(panel: SessionInboxPanel): Promise<void> {
  clickSelector(shadowRoot(panel), "[data-action='board-menu']");
  await panel.updateComplete;
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
    // Provide sessions in open and archived. The idle one is dated rather than
    // filed under "open", so its band renders in Open's place.
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
    expect(kinds).toContain("hour");
    expect(kinds).toContain("archived");
    // Empty groups and empty bands are hidden.
    expect(kinds).not.toContain("open");
    expect(kinds).not.toContain("blocked");
    expect(kinds).not.toContain("errored");
    expect(kinds).not.toContain("working");
    expect(kinds).not.toContain("unread");
    expect(kinds).not.toContain("yesterday");

    // The idle bands come before archived.
    expect(kinds.indexOf("hour")).toBeLessThan(kinds.indexOf("archived"));
  });

  it("draws Pinned first and keeps its rows out of the age bands", async () => {
    const sessions = [
      mkSession("recent"),
      mkSession("pinned-stale", { modified: minutesAgo(60 * 24 * 10), pinned: true }),
    ];
    const panel = await mountPanel({ globalSessions: mkGlobalSessions(sessions) });
    const root = shadowRoot(panel);

    const kinds = Array.from(root.querySelectorAll("[data-group]"), (el) => el.getAttribute("data-group"));
    expect(kinds[0]).toBe("pinned");
    expect(kinds).not.toContain("month");

    // Pinned opens by default, so a ten-day-old pin is reachable without a tap.
    expect(root.querySelector("[data-group='pinned'] [data-session='pinned-stale']")).not.toBeNull();
    expect(root.querySelector("[data-band-label]")?.textContent.trim()).toBe("Open · 1 · by age");
  });

  it("keeps a pinned working session's marker and count where the reader can see them", async () => {
    const sessions = [
      mkSession("pinned-working", { pinned: true }),
      mkSession("plain-working"),
    ];
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions(sessions, {
        statuses: {
          "pinned-working": mkWorkingStatus("pinned-working"),
          "plain-working": mkWorkingStatus("plain-working"),
        },
      }),
    });
    const root = shadowRoot(panel);

    // Pinned owns the row, so Working counts only the session it still holds.
    expect(root.querySelector("[data-group='working'] [data-group-count]")?.textContent).toBe("1");
    // The row keeps the working marker, so the state is not lost with the group.
    expect(root.querySelector("[data-session='pinned-working']")?.getAttribute("data-state")).toBe("working");
  });

  it("labels the run of bands as the idle pile they replace", async () => {
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([mkSession("open-one"), mkSession("open-two")]),
    });

    const label = shadowRoot(panel).querySelector("[data-band-label]");

    expect(label?.textContent.trim()).toBe("Open · 2 · by age");
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

    const bandGroup = root.querySelector("[data-group='hour']");
    const archivedGroup = root.querySelector("[data-group='archived']");
    expect(bandGroup?.querySelector("[data-group-count]")?.textContent).toBe("2");
    expect(archivedGroup?.querySelector("[data-group-count]")?.textContent).toBe("1");
  });

  it("files an idle session in its age band and leaves the rest of the board alone", async () => {
    const sessions: SessionInfo[] = [
      mkSession("open-one"),
      mkSession("stale-one", { modified: minutesAgo(60 * 24 * 10) }),
      mkSession("working-one", { modified: minutesAgo(60 * 24 * 10) }),
    ];
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions(sessions, {
        statuses: { "working-one": mkWorkingStatus("working-one") },
      }),
    });
    const root = shadowRoot(panel);

    // A ten-day-old idle row bands by age; a ten-day-old working row does not.
    expect(root.querySelector("[data-group='hour'] [data-session='open-one']")).not.toBeNull();
    expect(root.querySelector("[data-group='month']")?.getAttribute("aria-expanded")).toBe("false");
    expect(root.querySelector("[data-group='working'] [data-session='working-one']")).not.toBeNull();

    clickSelector(root, "[data-group='month'] button");
    await panel.updateComplete;

    expect(root.querySelector("[data-group='month'] [data-session='stale-one']")).not.toBeNull();
  });

  it("shows a row for each session in the correct group", async () => {
    const sessions: SessionInfo[] = [
      mkSession("open-one"),
      mkSession("archived-one", { archived: true }),
    ];
    const panel = await mountPanel({ globalSessions: mkGlobalSessions(sessions) });
    const root = shadowRoot(panel);

    await revealArchived(panel);

    const openRow = root.querySelector("[data-session='open-one']");
    const archivedRow = root.querySelector("[data-session='archived-one']");
    expect(openRow).not.toBeNull();
    expect(archivedRow).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Default visibility — Open starts collapsed and Archived starts hidden
// ---------------------------------------------------------------------------

describe("default collapse", () => {
  it("opens the recent bands and collapses the ones nobody asked to see", async () => {
    const sessions = [
      mkSession("recent"),
      mkSession("this-week", { modified: minutesAgo(60 * 24 * 3) }),
      mkSession("this-month", { modified: minutesAgo(60 * 24 * 10) }),
    ];
    const panel = await mountPanel({ globalSessions: mkGlobalSessions(sessions) });
    const root = shadowRoot(panel);

    expect(root.querySelector("[data-group='hour']")?.getAttribute("aria-expanded")).toBe("true");
    expect(root.querySelector("[data-group='week']")?.getAttribute("aria-expanded")).toBe("false");
    expect(root.querySelector("[data-group='month']")?.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps the archive hidden behind the overflow menu until it is asked to open", async () => {
    const sessions = [mkSession("archived-one", { archived: true })];
    const panel = await mountPanel({ globalSessions: mkGlobalSessions(sessions) });
    const root = shadowRoot(panel);

    expect(root.querySelector("[data-archive-shelf]")).toBeNull();
    expect(root.querySelector("[data-session='archived-one']")).toBeNull();

    clickSelector(root, "[data-action='board-menu']");
    await panel.updateComplete;

    const toggle = root.querySelector("[data-action='toggle-archived']");
    expect(toggle?.getAttribute("role")).toBe("menuitemcheckbox");
    expect(toggle?.getAttribute("aria-checked")).toBe("false");
    expect(toggle?.textContent).toContain("1");

    clickSelector(root, "[data-action='toggle-archived']");
    await panel.updateComplete;

    expect(root.querySelector("[data-group='archived']")?.getAttribute("aria-expanded")).toBe("true");
    expect(root.querySelector("[data-session='archived-one']")).not.toBeNull();

    clickSelector(root, "[data-action='board-menu']");
    await panel.updateComplete;
    expect(root.querySelector("[data-action='toggle-archived']")?.getAttribute("aria-checked")).toBe("true");

    clickSelector(root, "[data-action='toggle-archived']");
    await panel.updateComplete;
    expect(root.querySelector("[data-session='archived-one']")).toBeNull();
  });

  it("omits the archived visibility command when the machine has never archived anything", async () => {
    const panel = await mountPanel({ globalSessions: mkGlobalSessions([mkSession("open-one")]) });
    const root = shadowRoot(panel);

    clickSelector(root, "[data-action='board-menu']");
    await panel.updateComplete;

    expect(root.querySelector("[data-action='toggle-archived']")).toBeNull();
  });

  it("pins plugin shelves to the inbox floor outside the session scroller", async () => {
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([mkSession("open-one")]),
      inboxShelves: [html`<div data-plugin-shelf>Quota</div>`],
    });
    const root = shadowRoot(panel);
    const pluginShelves = root.querySelector("[data-inbox-plugin-shelves]");
    const boardScroll = root.querySelector(".board-scroll");

    expect(pluginShelves?.querySelector("[data-plugin-shelf]")?.textContent).toBe("Quota");
    expect(root.lastElementChild).toBe(pluginShelves);
    expect(boardScroll?.contains(pluginShelves)).toBe(false);
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
    // The month band starts collapsed, so opening it is a real preference.
    const sessions = [mkSession("stale-one", { modified: minutesAgo(60 * 24 * 10) })];
    const gs = mkGlobalSessions(sessions);

    const panel = await mountPanel({ globalSessions: gs });
    clickSelector(shadowRoot(panel), "[data-group='month'] button");
    await panel.updateComplete;

    expect(shadowRoot(panel).querySelector("[data-group='month']")?.getAttribute("aria-expanded")).toBe("true");

    // Unmount and recreate.
    panel.remove();
    const panel2 = await mountPanel({ globalSessions: gs });

    expect(shadowRoot(panel2).querySelector("[data-group='month']")?.getAttribute("aria-expanded")).toBe("true");
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
    // The month band is collapsed by default; select a session inside it.
    const sessions = [mkSession("stale-one", { modified: minutesAgo(60 * 24 * 10) })];
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions(sessions),
      selectedSession: sessions[0],
    });
    const root = shadowRoot(panel);

    // The band holding the selection is auto-expanded, collapsed default or not.
    expect(root.querySelector("[data-group='month']")?.getAttribute("aria-expanded")).toBe("true");
  });

  it("does not reveal the archive when the selected session is archived", async () => {
    const archived = mkSession("archived-one", { archived: true });
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([archived]),
      selectedSession: archived,
    });
    const root = shadowRoot(panel);

    expect(root.querySelector("[data-session='archived-one']")).toBeNull();
    expect(root.querySelector("[data-archive-shelf]")).toBeNull();

    clickSelector(root, "[data-action='board-menu']");
    await panel.updateComplete;
    expect(root.querySelector("[data-action='toggle-archived']")?.getAttribute("aria-checked")).toBe("false");
  });

  it("expands the destination group when the same selected id moves via live activity", async () => {
    const session = mkSession("moving-one");
    localStorage.setItem("forgerie:inbox:local:collapsed-bands", JSON.stringify(["hour", "working"]));
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
    localStorage.setItem("forgerie:inbox:local:collapsed-bands", JSON.stringify(["proj-1"]));

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


    const chip = root.querySelector("[data-session='unavail-session'] [data-location-chip]");
    expect(chip?.textContent).toContain("workspace removed");
  });
});

// ---------------------------------------------------------------------------
// Semantic accessibility
// ---------------------------------------------------------------------------

describe("accessibility", () => {
  it("group section header has aria-expanded reflecting collapse state", async () => {
    const sessions = [mkSession("stale-one", { modified: minutesAgo(60 * 24 * 10) })];
    const panel = await mountPanel({ globalSessions: mkGlobalSessions(sessions) });
    const root = shadowRoot(panel);

    expect(root.querySelector("[data-group='month']")?.getAttribute("aria-expanded")).toBe("false");

    clickSelector(root, "[data-group='month'] button");
    await panel.updateComplete;

    expect(root.querySelector("[data-group='month']")?.getAttribute("aria-expanded")).toBe("true");
  });

  it("selected row has aria-selected='true'", async () => {
    const session = mkSession("open-one");
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([session]),
      selectedSession: session,
    });
    const root = shadowRoot(panel);

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

    const newButtons = root.querySelectorAll<HTMLButtonElement>("[data-action='new-session']");
    expect(newButtons).toHaveLength(1);
    const newBtn = newButtons.item(0);
    expect(newBtn.closest(".board-actions")).not.toBeNull();
    expect(newBtn.title).toBe(NEW_SESSION_LABEL);
    expect(newBtn.getAttribute("aria-label")).toBe(NEW_SESSION_LABEL);
    expect(newBtn.textContent.trim()).toBe("+ New");
    expect(root.querySelector("[data-state='empty'] [data-action='new-session']")).toBeNull();
    newBtn.click();
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
    expect(root.querySelector("[data-action='manage-workspaces']")?.textContent).toContain("Manage projects and workspaces");
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

    await revealArchived(panel);
    expect(shadowRoot(panel).querySelector("[data-session='archived-one']")).not.toBeNull();

    const remounted = await mountPanel({ globalSessions: mkGlobalSessions(sessions) });
    const root = shadowRoot(remounted);
    expect(root.querySelector("[data-session='archived-one']")).toBeNull();

    clickSelector(root, "[data-action='board-menu']");
    await remounted.updateComplete;
    expect(root.querySelector("[data-action='toggle-archived']")?.getAttribute("aria-checked")).toBe("false");
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


    const chip = root.querySelector("[data-session='open-one'] [data-location-chip]");
    expect(chip?.textContent.replace(/\s+/gu, " ").trim()).toBe("Repo · session-inbox");
  });

  it("shows only the last segment for a cwd outside every project", async () => {
    const sessions = [mkSession("open-one", { cwd: "/elsewhere/scratch" })];
    const panel = await mountPanel({ globalSessions: mkGlobalSessions(sessions) });
    const root = shadowRoot(panel);


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
      // Only row on the board, and its band starts collapsed.
      globalSessions: mkGlobalSessions([mkSession("stale-one", { modified: minutesAgo(60 * 24 * 10) })]),
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

    expect(shadowRoot(panel).querySelector("[data-session='archived-one']")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Overlay dismissal
// ---------------------------------------------------------------------------

describe("overlay dismissal", () => {
  it("leaves dismissal to the panel's own close, not a second control", async () => {
    // The board used to carry a back arrow of its own while overlaid. The panel
    // now brings a close with it wherever it appears, so a second control here
    // would be two ways to put the same thing away.
    const overlaid = await mountPanel({
      globalSessions: mkGlobalSessions([mkSession("open-one")]),
      compact: true,
    });

    expect(shadowRoot(overlaid).querySelector("[data-action='close-overlay']")).toBeNull();
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
  it("replaces message recency with the active turn runtime", async () => {
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

  /*
   * The counts hold a column of the board, so they are a child of the row and
   * not a tail on the location chip. Hung off the chip they would start at a
   * different x on every row; happy-dom does no layout, so this asserts the
   * structure the column model needs rather than the geometry it produces.
   */
  it("puts the counts beside the location rather than inside it", async () => {
    const session = mkSession("live", { name: "Busy session" });
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([session], {
        statuses: { live: statusWith({ workingAgents: 1 }) },
      }),
    });

    const work = shadowRoot(panel).querySelector("[data-live-work]");
    expect(work?.parentElement?.classList.contains("row")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Row density
//
// The shape is a derived value written to data-shape, so these assert the
// attribute the styles select on rather than any geometry happy-dom cannot
// produce.
// ---------------------------------------------------------------------------

describe("row density", () => {
  it("gives an ordinary row one line when dense", async () => {
    const panel = await mountPanel({ globalSessions: mkGlobalSessions([mkSession("open-one")]) });

    expect(rowShape(panel, "open-one")).toBe("one-line");
  });

  it("keeps the second line for a blocked row even when dense", async () => {
    // The question is the reason to read the row, so density never takes it.
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([mkSession("blocked-one")], {
        statuses: { "blocked-one": mkBlockedStatus("blocked-one") },
      }),
    });

    expect(rowShape(panel, "blocked-one")).toBe("two-line");
    expect(rowElement(panel, "blocked-one").querySelector(".row-detail")?.textContent.trim()).toBe("Proceed?");
  });

  it("gives every row two lines when comfortable", async () => {
    const panel = await mountPanel({
      density: "comfortable",
      globalSessions: mkGlobalSessions([mkSession("open-one")]),
    });

    expect(rowShape(panel, "open-one")).toBe("two-line");
  });

  it("keeps the location on a dense row rather than dropping it", async () => {
    const panel = await mountPanel({ globalSessions: mkGlobalSessions([mkSession("open-one")]) });

    const chip = rowElement(panel, "open-one").querySelector("[data-location-chip]");
    expect(chip?.textContent).toContain("Repo");
  });

  it("puts the pinned marker in the trailing mark slot, not before the title", async () => {
    const panel = await mountPanel({ globalSessions: mkGlobalSessions([mkSession("pinned-one", { pinned: true })]) });
    const row = rowElement(panel, "pinned-one");

    // Leading the title indented every pinned row's title away from the rows
    // below it, and pinned rows arrive together at the top of their group.
    expect(row.querySelector(".row-title [data-pinned-marker]")).toBeNull();
    expect(row.querySelector(".row-mark [data-pinned-marker]")).not.toBeNull();
  });

  it("reserves the mark slot on every row, so revealing an action moves nothing", async () => {
    // The action draws into the same slot the pin occupies. Were the slot only
    // present on pinned rows, revealing an action would shove the timestamp
    // sideways under the pointer.
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([mkSession("plain-one"), mkSession("pinned-one", { pinned: true })]),
    });

    for (const id of ["plain-one", "pinned-one"]) {
      expect(rowElement(panel, id).querySelector(".row-mark")).not.toBeNull();
    }
    expect(rowElement(panel, "plain-one").querySelector("[data-pinned-marker]")).toBeNull();
  });
});

function rowElement(panel: SessionInboxPanel, sessionId: string): HTMLElement {
  const row = shadowRoot(panel).querySelector(`[data-session='${sessionId}']`);
  if (!(row instanceof HTMLElement)) throw new Error(`No row for ${sessionId}`);
  return row;
}

function rowShape(panel: SessionInboxPanel, sessionId: string): string | null {
  return rowElement(panel, sessionId).getAttribute("data-shape");
}

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

async function mountRowForPress(options: {
  onArchiveSession?: (session: SessionInfo) => void;
  onSelectSession?: (session: SessionInfo) => void;
  onDeleteSession?: (session: SessionInfo) => void;
  onRestoreSession?: (session: SessionInfo) => void;
  onPinSession?: (session: SessionInfo) => void;
  onUnpinSession?: (session: SessionInfo) => void;
  session?: SessionInfo;
} = {}): Promise<{ panel: SessionInboxPanel; row: HTMLElement }> {
  const session = options.session ?? mkSession("open-one");
  const group = session.archived === true ? "archived" : "open";
  const panel = await mountPanel({
    globalSessions: mkGlobalSessions([session]),
    onArchiveSession: options.onArchiveSession ?? noop,
    onSelectSession: options.onSelectSession ?? noop,
    onDeleteSession: options.onDeleteSession ?? noop,
    onRestoreSession: options.onRestoreSession ?? noop,
    onPinSession: options.onPinSession ?? noop,
    onUnpinSession: options.onUnpinSession ?? noop,
  });
  const root = shadowRoot(panel);
  if (group === "archived") await revealArchived(panel);
  const disclosure = root.querySelector(`[data-group='${group}'] button`);
  if (disclosure instanceof HTMLElement) disclosure.click();
  await panel.updateComplete;

  const row = root.querySelector(`[data-session='${session.id}']`);
  if (!(row instanceof HTMLElement)) throw new Error("No row");
  row.setPointerCapture = noop;
  row.hasPointerCapture = () => false;
  row.releasePointerCapture = noop;
  return { panel, row };
}

/** Hold a finger on the row for long enough that the commands open. */
async function holdRow(panel: SessionInboxPanel, row: HTMLElement, travelPx = 0): Promise<void> {
  sendPointer(row, "pointerdown", { pointerType: "touch", clientX: 300, clientY: 100 });
  if (travelPx !== 0) sendPointer(row, "pointermove", { pointerType: "touch", clientX: 300 + travelPx, clientY: 100 });
  await new Promise((resolve) => { setTimeout(resolve, ROW_PRESS.holdMs + 40); });
  await panel.updateComplete;
}

function rowMenuItem(panel: SessionInboxPanel, action: string): HTMLElement | null {
  const item = shadowRoot(panel).querySelector(`#inbox-row-menu [data-action='${action}']`);
  return item instanceof HTMLElement ? item : null;
}

describe("row commands", () => {
  it("opens a row's commands when a finger holds still on it", async () => {
    const { panel, row } = await mountRowForPress();

    await holdRow(panel, row);

    expect(rowMenuItem(panel, "menu-archive")).not.toBeNull();
    expect(rowMenuItem(panel, "menu-copy-path")).not.toBeNull();
  });

  it("archives from the commands rather than from a swipe", async () => {
    const archived: string[] = [];
    const { panel, row } = await mountRowForPress({ onArchiveSession: (s) => { archived.push(s.id); } });

    await holdRow(panel, row);
    rowMenuItem(panel, "menu-archive")?.click();

    expect(archived).toEqual(["open-one"]);
  });

  it("does not open the session when the hold opened the commands", async () => {
    const selected: string[] = [];
    const { panel, row } = await mountRowForPress({ onSelectSession: (s) => { selected.push(s.id); } });

    await holdRow(panel, row);
    row.click();

    expect(selected).toEqual([]);
  });

  it("still opens the session on a tap", async () => {
    const selected: string[] = [];
    const { panel, row } = await mountRowForPress({ onSelectSession: (s) => { selected.push(s.id); } });

    sendPointer(row, "pointerdown", { pointerType: "touch", clientX: 300, clientY: 100 });
    sendPointer(row, "pointerup", { pointerType: "touch", clientX: 300, clientY: 100 });
    row.click();
    await panel.updateComplete;

    expect(selected).toEqual(["open-one"]);
    expect(rowMenuItem(panel, "menu-archive")).toBeNull();
  });

  it("gives a scrolling finger back to the list", async () => {
    const { panel, row } = await mountRowForPress();

    await holdRow(panel, row, ROW_PRESS.moveTolerancePx + 20);

    expect(rowMenuItem(panel, "menu-archive")).toBeNull();
  });

  it("leaves horizontal travel to the shell instead of acting on the row", async () => {
    const archived: string[] = [];
    const { panel, row } = await mountRowForPress({ onArchiveSession: (s) => { archived.push(s.id); } });

    // The swipe that used to archive. It now belongs to the side panels.
    sendPointer(row, "pointerdown", { pointerType: "touch", clientX: 300, clientY: 100 });
    sendPointer(row, "pointermove", { pointerType: "touch", clientX: 160, clientY: 100 });
    sendPointer(row, "pointerup", { pointerType: "touch", clientX: 160, clientY: 100 });
    await panel.updateComplete;

    expect(archived).toEqual([]);
    expect(rowMenuItem(panel, "menu-archive")).toBeNull();
  });

  it("opens nothing when the press is cancelled", async () => {
    const { panel, row } = await mountRowForPress();

    sendPointer(row, "pointerdown", { pointerType: "touch", clientX: 300, clientY: 100 });
    sendPointer(row, "pointercancel", { pointerType: "touch", clientX: 300, clientY: 100 });
    await new Promise((resolve) => { setTimeout(resolve, ROW_PRESS.holdMs + 40); });
    await panel.updateComplete;

    expect(rowMenuItem(panel, "menu-archive")).toBeNull();
  });

  it("reaches the same commands from a mouse, which cannot hold", async () => {
    const { panel, row } = await mountRowForPress();

    row.dispatchEvent(new Event("contextmenu", { bubbles: true, composed: true }));
    await panel.updateComplete;

    expect(rowMenuItem(panel, "menu-archive")).not.toBeNull();
  });

  it("does not open the session when the browser's own long-press raises the commands", async () => {
    const selected: string[] = [];
    const { panel, row } = await mountRowForPress({ onSelectSession: (s) => { selected.push(s.id); } });

    // Chromium's long-press contextmenu lands while the finger is still down,
    // racing ROW_PRESS; the release still fires a click.
    sendPointer(row, "pointerdown", { pointerType: "touch", clientX: 300, clientY: 100 });
    row.dispatchEvent(new Event("contextmenu", { bubbles: true, composed: true }));
    sendPointer(row, "pointerup", { pointerType: "touch", clientX: 300, clientY: 100 });
    row.click();
    await panel.updateComplete;

    expect(rowMenuItem(panel, "menu-archive")).not.toBeNull();
    expect(selected).toEqual([]);
  });

  it("still selects the session on the click after a mouse context menu", async () => {
    const selected: string[] = [];
    const { panel, row } = await mountRowForPress({ onSelectSession: (s) => { selected.push(s.id); } });

    // No press is in flight for a mouse, so the next left click stays a click.
    row.dispatchEvent(new Event("contextmenu", { bubbles: true, composed: true }));
    await panel.updateComplete;
    row.click();
    await panel.updateComplete;

    expect(selected).toEqual(["open-one"]);
  });

  it("offers an archived row its way back, and its way out", async () => {
    const { panel, row } = await mountRowForPress({ session: mkSession("gone-one", { archived: true }) });

    await holdRow(panel, row);

    expect(rowMenuItem(panel, "menu-restore")).not.toBeNull();
    expect(rowMenuItem(panel, "menu-delete")).not.toBeNull();
    expect(rowMenuItem(panel, "menu-archive")).toBeNull();
    expect(rowMenuItem(panel, "menu-pin")).toBeNull();
  });

  it("pins an open row from its commands", async () => {
    const pinned: string[] = [];
    const { panel, row } = await mountRowForPress({ onPinSession: (s) => { pinned.push(s.id); } });

    await holdRow(panel, row);
    expect(rowMenuItem(panel, "menu-unpin")).toBeNull();
    rowMenuItem(panel, "menu-pin")?.click();

    expect(pinned).toEqual(["open-one"]);
  });

  it("a pinned row offers unpin and withholds every archive affordance", async () => {
    const unpinned: string[] = [];
    const { panel, row } = await mountRowForPress({
      session: mkSession("pinned-one", { pinned: true }),
      onUnpinSession: (s) => { unpinned.push(s.id); },
    });

    expect(row.querySelector("[data-pinned-marker]")).not.toBeNull();
    expect(row.querySelector("[data-action='archive']")).toBeNull();
    const unpinAction = row.querySelector("[data-action='unpin']");
    expect(unpinAction).not.toBeNull();

    await holdRow(panel, row);
    expect(rowMenuItem(panel, "menu-archive")).toBeNull();
    expect(rowMenuItem(panel, "menu-pin")).toBeNull();
    rowMenuItem(panel, "menu-unpin")?.click();

    expect(unpinned).toEqual(["pinned-one"]);
  });

  it("unpins from the row's inline action", async () => {
    const unpinned: string[] = [];
    const { row } = await mountRowForPress({
      session: mkSession("pinned-one", { pinned: true }),
      onUnpinSession: (s) => { unpinned.push(s.id); },
    });

    const unpinAction = row.querySelector("[data-action='unpin']");
    if (!(unpinAction instanceof HTMLElement)) throw new Error("No unpin action");
    unpinAction.click();

    expect(unpinned).toEqual(["pinned-one"]);
  });

  it("asks twice before deleting, because deleting has no undo", async () => {
    const deleted: string[] = [];
    const { panel, row } = await mountRowForPress({
      session: mkSession("gone-one", { archived: true }),
      onDeleteSession: (s) => { deleted.push(s.id); },
    });

    await holdRow(panel, row);
    rowMenuItem(panel, "menu-delete")?.click();
    await panel.updateComplete;

    expect(deleted).toEqual([]);

    rowMenuItem(panel, "menu-delete-confirm")?.click();

    expect(deleted).toEqual(["gone-one"]);
  });
});
