/**
 * Tests for inbox cross-workspace session navigation.
 *
 * Verifies the guarded selection helper used by PiWebApp when an inbox row
 * is clicked:
 *   - Same-workspace → selectSession only, no workspace teardown.
 *   - Cross-workspace same project → workspace switch + target session.
 *   - Cross-workspace via project load → project selected, workspaces loaded, session selected.
 *   - Missing workspace → navigation declines, no teardown.
 *   - Rapid selection → last navigation token wins (earlier results discarded).
 */

import { describe, expect, it } from "vitest";
import type { Project, SessionInfo, Workspace } from "../api";
import {
  navigateToInboxSession,
  type InboxNavigationDeps,
} from "./inboxNavigation";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkSession(id: string, cwd = "/repo"): SessionInfo {
  return {
    id,
    cwd,
    path: `/tmp/${id}.jsonl`,
    created: "2026-08-07T10:00:00.000Z",
    modified: "2026-08-07T10:00:00.000Z",
    messageCount: 0,
    firstMessage: "test",
  };
}

function mkWorkspace(id: string, projectId: string, path: string): Workspace {
  return {
    id,
    projectId,
    path,
    label: id,
    isMain: true,
    isGitRepo: true,
    isGitWorktree: false,
    effectiveConfig: {},
  };
}

function mkProject(id: string, name = id): Project {
  return { id, name, path: `/path/${id}`, createdAt: "2026-08-07T00:00:00.000Z" };
}

/** A deps factory that resolves workspace+project synchronously from arrays. */
function makeDeps(opts: {
  selectedWorkspacePath?: string;
  selectedProjectId?: string;
  workspaces?: Workspace[];
  projects?: Project[];
  onSelectSession?: (s: SessionInfo) => void;
  onSelectWorkspace?: (ws: Workspace, wsOpts?: { sessionId?: string; isCurrent?: () => boolean }) => void;
  onSelectProject?: (p: Project, pOpts?: { workspaceId?: string; sessionId?: string; isCurrent?: () => boolean }) => void;
}): InboxNavigationDeps {
  return {
    getSelectedWorkspacePath: () => opts.selectedWorkspacePath,
    getSelectedProjectId: () => opts.selectedProjectId,
    allWorkspaces: () => opts.workspaces ?? [],
    allProjects: () => opts.projects ?? [],
    selectSession: (s) => { opts.onSelectSession?.(s); return Promise.resolve(); },
    selectWorkspace: (ws, wsOpts) => { opts.onSelectWorkspace?.(ws, wsOpts); return Promise.resolve(); },
    selectProject: (p, pOpts) => { opts.onSelectProject?.(p, pOpts); return Promise.resolve(); },
  };
}

// ---------------------------------------------------------------------------
// Same-workspace navigation
// ---------------------------------------------------------------------------

describe("same-workspace navigation", () => {
  it("calls selectSession directly when session.cwd matches the selected workspace", async () => {
    const session = mkSession("s1", "/repo");
    const selectedSessions: SessionInfo[] = [];

    const deps = makeDeps({
      selectedWorkspacePath: "/repo",
      selectedProjectId: "proj-1",
      workspaces: [mkWorkspace("ws-1", "proj-1", "/repo")],
      onSelectSession: (s) => { selectedSessions.push(s); },
    });

    const result = await navigateToInboxSession(session, deps, { token: 1, isCurrentToken: () => true });
    expect(result).toBe("selected");
    expect(selectedSessions).toHaveLength(1);
    expect(selectedSessions[0]?.id).toBe("s1");
  });

  it("does not call selectWorkspace or selectProject when cwd matches", async () => {
    const session = mkSession("s1", "/repo");
    const workspaceSwitches: string[] = [];
    const projectSwitches: string[] = [];

    const deps = makeDeps({
      selectedWorkspacePath: "/repo",
      onSelectWorkspace: (ws) => { workspaceSwitches.push(ws.id); },
      onSelectProject: (p) => { projectSwitches.push(p.id); },
    });

    await navigateToInboxSession(session, deps, { token: 1, isCurrentToken: () => true });
    expect(workspaceSwitches).toHaveLength(0);
    expect(projectSwitches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Cross-workspace navigation
// ---------------------------------------------------------------------------

describe("cross-workspace navigation (same project)", () => {
  it("calls selectWorkspace with the target workspace when cwd is in a known workspace", async () => {
    const session = mkSession("s2", "/repo-feat");
    const targetWs = mkWorkspace("ws-feat", "proj-1", "/repo-feat");
    const switchedWorkspaces: { wsId: string; sessionId: string | undefined }[] = [];

    const deps = makeDeps({
      selectedWorkspacePath: "/repo",
      selectedProjectId: "proj-1",
      workspaces: [
        mkWorkspace("ws-main", "proj-1", "/repo"),
        targetWs,
      ],
      onSelectWorkspace: (ws, wsOpts) => {
        switchedWorkspaces.push({ wsId: ws.id, sessionId: wsOpts?.sessionId });
      },
    });

    const result = await navigateToInboxSession(session, deps, { token: 1, isCurrentToken: () => true });
    expect(result).toBe("workspace-switch");
    expect(switchedWorkspaces).toHaveLength(1);
    expect(switchedWorkspaces[0]?.wsId).toBe("ws-feat");
    expect(switchedWorkspaces[0]?.sessionId).toBe("s2");
  });
});

describe("cross-workspace navigation (different project)", () => {
  it("calls selectProject when the target cwd is in a workspace of a different project", async () => {
    const session = mkSession("s3", "/other-repo");
    const otherWs = mkWorkspace("ws-other", "proj-2", "/other-repo");
    const otherProject = mkProject("proj-2", "Other");
    const projectSwitches: { projectId: string; workspaceId: string | undefined; sessionId: string | undefined }[] = [];

    const deps = makeDeps({
      selectedWorkspacePath: "/repo",
      selectedProjectId: "proj-1",
      projects: [mkProject("proj-1"), otherProject],
      workspaces: [mkWorkspace("ws-main", "proj-1", "/repo"), otherWs],
      onSelectProject: (p, pOpts) => {
        projectSwitches.push({ projectId: p.id, workspaceId: pOpts?.workspaceId, sessionId: pOpts?.sessionId });
      },
    });

    const result = await navigateToInboxSession(session, deps, { token: 1, isCurrentToken: () => true });
    expect(result).toBe("project-switch");
    expect(projectSwitches).toHaveLength(1);
    expect(projectSwitches[0]?.projectId).toBe("proj-2");
    expect(projectSwitches[0]?.workspaceId).toBe("ws-other");
    expect(projectSwitches[0]?.sessionId).toBe("s3");
  });
});

// ---------------------------------------------------------------------------
// Missing workspace
// ---------------------------------------------------------------------------

describe("missing workspace navigation", () => {
  it("returns 'unavailable' when the session cwd has no matching workspace", async () => {
    const session = mkSession("s4", "/deleted-path");
    const selectedSessions: string[] = [];

    const deps = makeDeps({
      selectedWorkspacePath: "/repo",
      workspaces: [mkWorkspace("ws-main", "proj-1", "/repo")],
      onSelectSession: (s) => { selectedSessions.push(s.id); },
    });

    const result = await navigateToInboxSession(session, deps, { token: 1, isCurrentToken: () => true });
    expect(result).toBe("unavailable");
    expect(selectedSessions).toHaveLength(0);
  });

  it("does not teardown any state when workspace is unavailable", async () => {
    const session = mkSession("s4", "/deleted-path");
    const workspaceSwitches: string[] = [];
    const projectSwitches: string[] = [];

    const deps = makeDeps({
      selectedWorkspacePath: "/repo",
      workspaces: [],
      onSelectWorkspace: (ws) => { workspaceSwitches.push(ws.id); },
      onSelectProject: (p) => { projectSwitches.push(p.id); },
    });

    await navigateToInboxSession(session, deps, { token: 1, isCurrentToken: () => true });
    expect(workspaceSwitches).toHaveLength(0);
    expect(projectSwitches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Lazy workspace loading (Gap U6/#2)
// ---------------------------------------------------------------------------

describe("lazy workspace loading", () => {
  it("loads workspaces for an uncached project and navigates via project-switch when cwd is found in a different project", async () => {
    // Project proj-2 is known but its workspaces have not been cached yet.
    // The session's cwd belongs to proj-2 (different from selected proj-1).
    const session = mkSession("s5", "/proj2-repo");
    const proj2 = mkProject("proj-2", "Project 2");
    const proj2Ws = mkWorkspace("ws-proj2", "proj-2", "/proj2-repo");

    const loadedProjects: string[] = [];
    // The workspace cache starts with only proj-1 workspaces; proj-2 is uncached.
    let cachedWorkspaces: Workspace[] = [mkWorkspace("ws-main", "proj-1", "/repo")];

    const projectSwitches: { projectId: string; workspaceId: string | undefined; sessionId: string | undefined }[] = [];

    const deps: InboxNavigationDeps = {
      getSelectedWorkspacePath: () => "/repo",
      getSelectedProjectId: () => "proj-1",
      allWorkspaces: () => cachedWorkspaces,
      allProjects: () => [mkProject("proj-1"), proj2],
      loadProjectWorkspaces: (project) => {
        loadedProjects.push(project.id);
        if (project.id === "proj-2") {
          // Simulate the cache being updated by the load.
          cachedWorkspaces = [...cachedWorkspaces, proj2Ws];
          return Promise.resolve([proj2Ws]);
        }
        return Promise.resolve([]);
      },
      selectSession: () => Promise.resolve(),
      selectWorkspace: () => Promise.resolve(),
      selectProject: (p, opts) => {
        projectSwitches.push({ projectId: p.id, workspaceId: opts?.workspaceId, sessionId: opts?.sessionId });
        return Promise.resolve();
      },
    };

    const result = await navigateToInboxSession(session, deps, { token: 1, isCurrentToken: () => true });

    // Loaded only the uncached project.
    expect(loadedProjects).toEqual(["proj-2"]);
    // Found in proj-2 (different from selected proj-1) → project-switch.
    expect(result).toBe("project-switch");
    expect(projectSwitches).toHaveLength(1);
    expect(projectSwitches[0]?.projectId).toBe("proj-2");
    expect(projectSwitches[0]?.workspaceId).toBe("ws-proj2");
    expect(projectSwitches[0]?.sessionId).toBe("s5");
  });

  it("loads workspaces for an uncached project and navigates via workspace-switch when cwd is in the same project", async () => {
    // proj-1 has a second workspace (/repo-feat) that is not yet cached.
    const session = mkSession("s5e", "/repo-feat");
    const featWs = mkWorkspace("ws-feat", "proj-1", "/repo-feat");

    // Simulate: proj-1 workspaces are NOT pre-cached (empty workspacesByProjectId).
    // This tests the case where even the selected project's workspaces are loaded lazily.
    let cachedWorkspaces: Workspace[] = [];
    const loadedProjects: string[] = [];
    const switchedWorkspaces: { wsId: string; sessionId: string | undefined }[] = [];

    const deps: InboxNavigationDeps = {
      getSelectedWorkspacePath: () => "/repo",
      getSelectedProjectId: () => "proj-1",
      allWorkspaces: () => cachedWorkspaces,
      allProjects: () => [mkProject("proj-1")],
      loadProjectWorkspaces: (project) => {
        loadedProjects.push(project.id);
        const wsList = [mkWorkspace("ws-main", "proj-1", "/repo"), featWs];
        cachedWorkspaces = wsList;
        return Promise.resolve(wsList);
      },
      selectSession: () => Promise.resolve(),
      selectWorkspace: (ws, opts) => { switchedWorkspaces.push({ wsId: ws.id, sessionId: opts?.sessionId }); return Promise.resolve(); },
      selectProject: () => Promise.resolve(),
    };

    const result = await navigateToInboxSession(session, deps, { token: 1, isCurrentToken: () => true });

    expect(loadedProjects).toEqual(["proj-1"]);
    // Same project, different workspace after lazy load → workspace-switch.
    expect(result).toBe("workspace-switch");
    expect(switchedWorkspaces).toHaveLength(1);
    expect(switchedWorkspaces[0]?.wsId).toBe("ws-feat");
    expect(switchedWorkspaces[0]?.sessionId).toBe("s5e");
  });

  it("returns 'unavailable' after exhausting all unloaded projects with no match", async () => {
    // Session cwd /deleted-path does not appear in any project's workspaces.
    const session = mkSession("s5b", "/deleted-path");
    const proj2 = mkProject("proj-2", "Project 2");

    // Cached: proj-1 only. Proj-2 has no matching workspace either.
    let cachedWorkspaces: Workspace[] = [mkWorkspace("ws-main", "proj-1", "/repo")];
    const loadedProjects: string[] = [];

    const deps: InboxNavigationDeps = {
      getSelectedWorkspacePath: () => "/repo",
      getSelectedProjectId: () => "proj-1",
      allWorkspaces: () => cachedWorkspaces,
      allProjects: () => [mkProject("proj-1"), proj2],
      loadProjectWorkspaces: (project) => {
        loadedProjects.push(project.id);
        const ws = mkWorkspace("ws-proj2", project.id, "/proj2-repo");
        cachedWorkspaces = [...cachedWorkspaces, ws];
        return Promise.resolve([ws]); // /deleted-path is not here
      },
      selectSession: () => Promise.resolve(),
      selectWorkspace: () => Promise.resolve(),
      selectProject: () => Promise.resolve(),
    };

    const result = await navigateToInboxSession(session, deps, { token: 1, isCurrentToken: () => true });

    expect(loadedProjects).toEqual(["proj-2"]); // tried to load proj-2 (proj-1 already cached)
    expect(result).toBe("unavailable");
  });

  it("returns 'discarded' if token becomes stale during loadProjectWorkspaces", async () => {
    const session = mkSession("s5c", "/proj2-repo");
    let tokenCurrent = true;

    const deps: InboxNavigationDeps = {
      getSelectedWorkspacePath: () => "/repo",
      getSelectedProjectId: () => "proj-1",
      allWorkspaces: () => [mkWorkspace("ws-main", "proj-1", "/repo")],
      allProjects: () => [mkProject("proj-1"), mkProject("proj-2")],
      loadProjectWorkspaces: () => {
        tokenCurrent = false; // stale during load
        return Promise.resolve([]);
      },
      selectSession: () => Promise.resolve(),
      selectWorkspace: () => Promise.resolve(),
      selectProject: () => Promise.resolve(),
    };

    const result = await navigateToInboxSession(session, deps, {
      token: 1,
      isCurrentToken: () => tokenCurrent,
    });

    expect(result).toBe("discarded");
  });

  it("skips projects that already have cached workspaces", async () => {
    // proj-1 IS in the cache already; only proj-2 should be loaded.
    const session = mkSession("s5d", "/proj2-repo");
    const proj2Ws = mkWorkspace("ws-proj2", "proj-2", "/proj2-repo");

    let cachedWorkspaces: Workspace[] = [mkWorkspace("ws-main", "proj-1", "/repo")];
    const loadedProjects: string[] = [];

    const deps: InboxNavigationDeps = {
      getSelectedWorkspacePath: () => "/repo",
      getSelectedProjectId: () => "proj-1",
      allWorkspaces: () => cachedWorkspaces,
      allProjects: () => [mkProject("proj-1"), mkProject("proj-2")],
      loadProjectWorkspaces: (project) => {
        loadedProjects.push(project.id);
        if (project.id === "proj-2") {
          cachedWorkspaces = [...cachedWorkspaces, proj2Ws];
          return Promise.resolve([proj2Ws]);
        }
        return Promise.resolve([]);
      },
      selectSession: () => Promise.resolve(),
      selectWorkspace: () => Promise.resolve(),
      selectProject: () => Promise.resolve(),
    };

    await navigateToInboxSession(session, deps, { token: 1, isCurrentToken: () => true });

    // proj-1 was already cached; only proj-2 should have been loaded.
    expect(loadedProjects).toEqual(["proj-2"]);
  });
});

// ---------------------------------------------------------------------------
// Navigation token guard (rapid selection)
// ---------------------------------------------------------------------------

describe("navigation token guard", () => {
  it("returns 'discarded' when the token is stale before any async work begins", async () => {
    const session = mkSession("s6", "/repo-feat");
    const deps = makeDeps({
      selectedWorkspacePath: "/repo",
      workspaces: [mkWorkspace("ws-feat", "proj-1", "/repo-feat")],
    });

    // Token is already stale at invocation.
    const result = await navigateToInboxSession(session, deps, {
      token: 1,
      isCurrentToken: () => false, // stale from the start
    });

    expect(result).toBe("discarded");
  });

  it("returns 'discarded' when the token becomes stale while selectSession is awaited", async () => {
    const session = mkSession("s7", "/repo");
    let tokenCurrent = true;
    let selectResolved = false;

    const deps = makeDeps({
      selectedWorkspacePath: "/repo",
      onSelectSession: () => {
        // Simulate: by the time selectSession resolves, a newer navigation arrived.
        tokenCurrent = false;
        selectResolved = true;
      },
    });

    const result = await navigateToInboxSession(session, deps, {
      token: 1,
      isCurrentToken: () => tokenCurrent,
    });

    expect(selectResolved).toBe(true); // selectSession was called
    expect(result).toBe("discarded"); // but result is discarded because token went stale
  });

  it("returns 'discarded' when the token becomes stale while selectWorkspace is awaited", async () => {
    const session = mkSession("s8", "/repo-feat");
    const targetWs = mkWorkspace("ws-feat", "proj-1", "/repo-feat");
    let tokenCurrent = true;
    let switchCalled = false;

    const deps = makeDeps({
      selectedWorkspacePath: "/repo",
      selectedProjectId: "proj-1",
      workspaces: [mkWorkspace("ws-main", "proj-1", "/repo"), targetWs],
      onSelectWorkspace: () => {
        tokenCurrent = false; // stale after select
        switchCalled = true;
      },
    });

    const result = await navigateToInboxSession(session, deps, {
      token: 1,
      isCurrentToken: () => tokenCurrent,
    });

    expect(switchCalled).toBe(true);
    expect(result).toBe("discarded");
  });
});

// ---------------------------------------------------------------------------
// Rapid same-workspace navigation — last-wins via isCurrent guard
// ---------------------------------------------------------------------------

describe("rapid same-workspace navigation last-wins", () => {
  it("passes isCurrent to selectWorkspace so WorkspaceController can abort a superseded load", async () => {
    // Simulate two rapid navigations. The first calls selectWorkspace but by
    // the time it resolves the token (seq=1) is stale because seq=2 arrived.
    const sessionA = mkSession("sessionA", "/repo-feat");
    const sessionB = mkSession("sessionB", "/repo-feat");
    const targetWs = mkWorkspace("ws-feat", "proj-1", "/repo-feat");

    // Deferred control of the first selectWorkspace call.
    let resolveFirst!: () => void;
    const firstSelectDone = new Promise<void>((resolve) => { resolveFirst = resolve; });

    let currentSeq = 0;
    // Record which isCurrent guard was passed for each call.
    const isCurrentGuards: ((() => boolean) | undefined)[] = [];
    const selectedSessions: string[] = [];

    const depA = makeDeps({
      selectedWorkspacePath: "/repo",
      selectedProjectId: "proj-1",
      workspaces: [mkWorkspace("ws-main", "proj-1", "/repo"), targetWs],
      onSelectWorkspace: (ws, opts) => {
        isCurrentGuards.push(opts?.isCurrent);
      },
      onSelectSession: (s) => { selectedSessions.push(s.id); },
    });

    // seq=1: starts, then seq=2 arrives before it finishes
    currentSeq = 1;
    const navA = navigateToInboxSession(sessionA, depA, {
      token: currentSeq,
      isCurrentToken: () => currentSeq === 1,
    });

    // seq=2 supersedes seq=1
    currentSeq = 2;
    const navB = navigateToInboxSession(sessionB, depA, {
      token: currentSeq,
      isCurrentToken: () => currentSeq === 2,
    });

    const [resultA, resultB] = await Promise.all([navA, navB]);

    // Both called selectWorkspace; isCurrent was threaded through
    expect(isCurrentGuards).toHaveLength(2);
    // The guard for navA returns false (stale); navB's guard returns true
    const guardA = isCurrentGuards[0];
    const guardB = isCurrentGuards[1];
    expect(typeof guardA).toBe("function");
    expect(typeof guardB).toBe("function");
    // After seq=2 arrived, seq=1's guard is false
    expect(guardA?.()).toBe(false);
    expect(guardB?.()).toBe(true);

    // Both navigation calls complete (one discarded or workspace-switch)
    expect(["workspace-switch", "discarded"]).toContain(resultA);
    expect(resultB).toBe("workspace-switch");
    void resolveFirst;
    void firstSelectDone;
  });
});
