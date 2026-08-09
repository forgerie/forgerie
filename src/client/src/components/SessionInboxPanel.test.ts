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
import type { Project, SessionActivity, SessionInfo, SessionStatus, Workspace } from "../api";
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

/** Click a DOM element found by selector, if it exists and is an HTMLElement. */
function clickSelector(root: ShadowRoot | Element, selector: string): void {
  const el = root.querySelector(selector);
  if (el instanceof HTMLElement) el.click();
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

  it("Archived is hidden until the toggle asks for it, then opens", async () => {
    const sessions = [mkSession("archived-one", { archived: true })];
    const panel = await mountPanel({ globalSessions: mkGlobalSessions(sessions) });
    const root = shadowRoot(panel);

    expect(root.querySelector("[data-group='archived']")).toBeNull();

    await revealArchived(panel);

    // A toggle that revealed a collapsed header would need a second click to
    // mean anything, so revealing also expands.
    expect(root.querySelector("[data-group='archived']")?.getAttribute("aria-expanded")).toBe("true");
    expect(root.querySelector("[data-session='archived-one']")).not.toBeNull();
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

    clickSelector(root, "[data-group-by='project']");
    await panel.updateComplete;
    clickSelector(root, "[data-group='proj-1'] > button");
    await panel.updateComplete;
    expect(root.querySelector("[data-group='proj-1']")?.getAttribute("aria-expanded")).toBe("false");

    clickSelector(root, "[data-group-by='state']");
    await panel.updateComplete;
    clickSelector(root, "[data-group-by='project']");
    await panel.updateComplete;
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

// ---------------------------------------------------------------------------
// Archived visibility toggle
// ---------------------------------------------------------------------------

describe("archived visibility toggle", () => {
  it("persists the choice per machine and reflects it in the control", async () => {
    const sessions = [mkSession("open-one"), mkSession("archived-one", { archived: true })];
    const panel = await mountPanel({ globalSessions: mkGlobalSessions(sessions) });

    expect(shadowRoot(panel).querySelector("[data-action='toggle-archived']")?.getAttribute("aria-pressed")).toBe("false");

    await revealArchived(panel);
    expect(shadowRoot(panel).querySelector("[data-action='toggle-archived']")?.getAttribute("aria-pressed")).toBe("true");

    const remounted = await mountPanel({ globalSessions: mkGlobalSessions(sessions) });
    expect(shadowRoot(remounted).querySelector("[data-group='archived']")).not.toBeNull();
  });

  it("keeps archived out of the project grouping until it is revealed", async () => {
    const sessions = [mkSession("open-one"), mkSession("archived-one", { archived: true })];
    const panel = await mountPanel({ globalSessions: mkGlobalSessions(sessions) });
    const root = shadowRoot(panel);

    clickSelector(root, "[data-group-by='project']");
    await panel.updateComplete;
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
    expect(root.querySelector("[data-group-by='project']")?.getAttribute("aria-pressed")).toBe("true");

    await pressKey(panel, "a");
    expect(root.querySelector("[data-session='archived-one']")).not.toBeNull();
  });

  it("ignores shortcuts typed into an input", async () => {
    const panel = await mountPanel({ globalSessions: mkGlobalSessions([mkSession("open-one")]) });
    const input = document.createElement("input");
    document.body.append(input);

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true, composed: true }));
    await panel.updateComplete;

    expect(shadowRoot(panel).querySelector("[data-action='toggle-archived']")?.getAttribute("aria-pressed")).toBe("false");
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
