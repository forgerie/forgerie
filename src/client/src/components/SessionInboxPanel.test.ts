// @vitest-environment happy-dom

/**
 * Component tests for SessionInboxPanel.
 *
 * Covers: group rendering, default collapse, localStorage persistence,
 * group-by toggle, row selection/archive callbacks, auto-expand on group move,
 * loading/stale/empty states, deleted-workspace row disabled behaviour,
 * and semantic accessibility attributes.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { Project, SessionInfo, SessionStatus, Workspace } from "../api";
import type { GlobalSessionsState } from "../appState";
import { SessionInboxPanel } from "./SessionInboxPanel";

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

function mkGlobalSessions(
  sessions: SessionInfo[],
  overrides: Partial<GlobalSessionsState> = {},
): GlobalSessionsState {
  return {
    machineId: "local",
    status: "fresh",
    sessions,
    statuses: {},
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

/** Click a DOM element found by selector, if it exists and is an HTMLElement. */
function clickSelector(root: ShadowRoot | Element, selector: string): void {
  const el = root.querySelector(selector);
  if (el instanceof HTMLElement) el.click();
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
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

    // Expand Open and Archived so rows are visible.
    clickSelector(root, "[data-group='open'] button");
    await panel.updateComplete;
    clickSelector(root, "[data-group='archived'] button");
    await panel.updateComplete;

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

  it("Archived group is collapsed by default", async () => {
    const sessions = [mkSession("archived-one", { archived: true })];
    const panel = await mountPanel({ globalSessions: mkGlobalSessions(sessions) });
    const root = shadowRoot(panel);

    const archivedGroup = root.querySelector("[data-group='archived']");
    expect(archivedGroup?.getAttribute("aria-expanded")).toBe("false");
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
    const root = shadowRoot(panel);

    // Switch to project view.
    clickSelector(root, "[data-group-by='project']");
    await panel.updateComplete;

    panel.remove();

    const panel2 = await mountPanel({ globalSessions: gs });
    const root2 = shadowRoot(panel2);
    const projectBtn = root2.querySelector("[data-group-by='project']");
    expect(projectBtn?.getAttribute("aria-pressed")).toBe("true");
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

    clickSelector(root, "[data-group='archived'] button");
    await panel.updateComplete;

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

  it("expands the destination group when selectedSession changes groups via live update", async () => {
    const session = mkSession("moving-one");
    const gs = mkGlobalSessions([session]);

    // Initially open, no selection.
    const panel = await mountPanel({ globalSessions: gs });

    // Now select the session (it's in 'open', which is collapsed by default).
    panel.selectedSession = session;
    await panel.updateComplete;
    await panel.updateComplete;

    const openGroup = shadowRoot(panel).querySelector("[data-group='open']");
    expect(openGroup?.getAttribute("aria-expanded")).toBe("true");
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
    expect(row?.getAttribute("aria-disabled")).toBe("false");
    expect(row?.querySelector("[data-location-chip]")?.textContent).toContain("/not-loaded-yet");
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
// New session callback
// ---------------------------------------------------------------------------

describe("new session callback", () => {
  it("fires onNewSession when the new-session button is clicked", async () => {
    let called = false;
    const panel = await mountPanel({
      globalSessions: mkGlobalSessions([]),
      onNewSession: () => { called = true; },
    });
    const root = shadowRoot(panel);

    const newBtn = root.querySelector("[data-action='new-session']");
    expect(newBtn).not.toBeNull();
    if (newBtn instanceof HTMLElement) newBtn.click();
    await panel.updateComplete;

    expect(called).toBe(true);
  });
});
