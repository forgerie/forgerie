import { describe, expect, it, vi, type Mock } from "vitest";
import type { AppState } from "../appState";
import { initialAppState } from "../appState";
import type { Machine, Project, SessionInfo, Workspace } from "../api";
import { chatSessionLaunchRecoveryPresentation } from "../components/ChatView";
import { SessionController } from "./sessionController";
import { defaultApi, deferred, FakeSocket } from "./sessionController.testSupport";
import type { UpdateUrl } from "./types";
import { canDeleteWorkspace, WorkspaceController } from "./workspaceController";

function machine(id: string): Machine {
  return { id, name: id, kind: id === "local" ? "local" : "remote", createdAt: "now", updatedAt: "now" };
}

function project(id: string, path: string): Project {
  return { id, name: id, path, createdAt: "now" };
}

function workspace(projectId: string, path: string, options: { isMain?: boolean } = {}): Workspace {
  return { id: path, projectId, path, label: path, isMain: options.isMain ?? false, isGitRepo: true, isGitWorktree: true, effectiveConfig: {} };
}

function session(cwd: string, id = "s1"): SessionInfo {
  return { id, cwd, path: `${cwd}/.sessions/${id}`, created: "now", modified: "now", messageCount: 1, firstMessage: "hello" };
}

type LoadWorkspaces = (projectId: string, machineId?: string) => Promise<Workspace[]>;

type WorkspaceSessionPort = Pick<SessionController, "clearActiveSession" | "mergeCreationFailedSessionStarts" | "preferredSession" | "selectSession">;

interface Harness {
  controller: WorkspaceController;
  state: () => AppState;
  clearActiveSession: Mock<WorkspaceSessionPort["clearActiveSession"]>;
  preferredSession: Mock<WorkspaceSessionPort["preferredSession"]>;
  selectSession: Mock<WorkspaceSessionPort["selectSession"]>;
  updateUrl: Mock<UpdateUrl>;
  backgroundErrors: { message: string; error: unknown }[];
  setState: (patch: Partial<AppState>) => void;
}

function harness(initial: Partial<AppState>, loadWorkspaces: LoadWorkspaces): Harness {
  let state: AppState = { ...initialAppState(), ...initial };
  const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
  const clearActiveSession = vi.fn<WorkspaceSessionPort["clearActiveSession"]>();
  const preferredSession = vi.fn<WorkspaceSessionPort["preferredSession"]>();
  const selectSession = vi.fn<WorkspaceSessionPort["selectSession"]>().mockResolvedValue();
  const sessions: WorkspaceSessionPort = {
    clearActiveSession,
    mergeCreationFailedSessionStarts: (_cwd, listedSessions) => listedSessions,
    preferredSession,
    selectSession,
  };
  const updateUrl = vi.fn<UpdateUrl>();
  const backgroundErrors: { message: string; error: unknown }[] = [];
  const controller = new WorkspaceController(
    () => state,
    setState,
    updateUrl,
    sessions,
    undefined,
    {
      api: { workspaces: loadWorkspaces, sessions: vi.fn<(path: string, machineId?: string) => Promise<SessionInfo[]>>().mockResolvedValue([]) },
      onBackgroundError: (message, error) => { backgroundErrors.push({ message, error }); },
    },
  );
  return { controller, state: () => state, clearActiveSession, preferredSession, selectSession, updateUrl, backgroundErrors, setState };
}

describe("WorkspaceController.selectWorkspace", () => {
  it("restores and selects an off-workspace failed launch with its prompt and recovery controls", async () => {
    const repo = project("p1", "/repo");
    const origin = workspace(repo.id, "/repo-feature/");
    const other = workspace(repo.id, "/repo-other");
    const startRequest = deferred<SessionInfo>();
    let state: AppState = {
      ...initialAppState(),
      selectedMachine: machine("local"),
      projects: [repo],
      selectedProject: repo,
      selectedWorkspace: origin,
      workspaces: [origin, other],
      sessions: [],
    };
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => startRequest.promise,
      sessions: () => Promise.resolve([]),
    };
    const sessions = new SessionController(
      () => state,
      setState,
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );
    const workspaces = new WorkspaceController(
      () => state,
      setState,
      () => undefined,
      sessions,
      undefined,
      { api },
    );

    const launch = sessions.launchSession({ text: "Recover through workspace navigation" });
    const temporaryId = state.selectedSession?.id;
    if (temporaryId === undefined) throw new Error("Expected a pending session");
    await workspaces.selectWorkspace(other);
    startRequest.reject(new Error("backend unavailable"));
    await launch;

    expect(state.sessions).toEqual([]);
    expect(state.selectedWorkspace).toBe(other);

    await workspaces.selectWorkspace({ ...origin, path: "/repo-feature" });

    expect(state.sessions.map((candidate) => candidate.id)).toEqual([temporaryId]);
    expect(state.selectedSession?.id).toBe(temporaryId);
    expect(state.clientQueuedSessionMessages[temporaryId]).toEqual([
      { kind: "followUp", text: "[First prompt queued]" },
    ]);
    expect(state.activity).toMatchObject({ phase: "error", label: "Session creation failed" });
    const recovery = sessions.getSessionLaunchRecovery(temporaryId);
    expect(recovery).toMatchObject({ stage: "creationFailed", retrying: false });
    expect(recovery).not.toHaveProperty("prompt");
    if (recovery === undefined) throw new Error("Expected creation-failed recovery");
    expect(chatSessionLaunchRecoveryPresentation(recovery).actions).toEqual([
      { kind: "retry", label: "Retry", disabled: false },
      { kind: "changeDestination", label: "Change destination", disabled: false },
    ]);
  });
});

describe("WorkspaceController.refreshProjectWorkspaces", () => {
  it("does not cache a lazy workspace response after the machine changes", async () => {
    const repo = project("p1", "/repo");
    let resolveWorkspaces!: (workspaces: Workspace[]) => void;
    const loadWorkspaces = vi.fn().mockReturnValue(new Promise<Workspace[]>((resolve) => { resolveWorkspaces = resolve; }));
    const test = harness({
      selectedMachine: machine("local"),
      projects: [repo],
      workspacesByProjectId: {},
    }, loadWorkspaces);

    const pending = test.controller.refreshProjectWorkspaces(repo.id);
    test.setState({ selectedMachine: machine("remote"), projects: [] });
    resolveWorkspaces([workspace(repo.id, "/repo-feature")]);
    await pending;

    expect(loadWorkspaces).toHaveBeenCalledWith(repo.id, "local");
    expect(test.state().workspacesByProjectId[repo.id]).toBeUndefined();
  });
});

describe("WorkspaceController.refreshSelectedProjectTopology", () => {
  it("surfaces a worktree created outside Forgerie in both the selected list and the per-project cache", async () => {
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const created = workspace(repo.id, "/repo-feature");
    const loadWorkspaces = vi.fn().mockResolvedValue([main, created]);
    const test = harness(
      {
        selectedMachine: machine("local"),
        projects: [repo],
        selectedProject: repo,
        selectedWorkspace: main,
        workspaces: [main],
        workspacesByProjectId: { [repo.id]: [main] },
      },
      loadWorkspaces,
    );

    await test.controller.refreshSelectedProjectTopology();

    expect(loadWorkspaces).toHaveBeenCalledWith(repo.id, "local");
    expect(test.state().workspaces).toEqual([main, created]);
    expect(test.state().workspacesByProjectId[repo.id]).toEqual([main, created]);
  });

  it("preserves the selection and workspace-scoped state when the selected workspace still exists", async () => {
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const selected = workspace(repo.id, "/repo-feature");
    const loadWorkspaces = vi.fn().mockResolvedValue([main, selected, workspace(repo.id, "/repo-other")]);
    const test = harness(
      {
        selectedMachine: machine("local"),
        projects: [repo],
        selectedProject: repo,
        selectedWorkspace: selected,
        workspaces: [main, selected],
        workspacesByProjectId: { [repo.id]: [main, selected] },
        selectedSession: session(selected.path),
        sessions: [session(selected.path)],
        selectedFilePath: "src/index.ts",
        expandedDirs: { src: [] },
        selectedTerminalId: "t1",
      },
      loadWorkspaces,
    );
    const before = test.state();

    await test.controller.refreshSelectedProjectTopology();

    const after = test.state();
    expect(after.selectedWorkspace).toBe(selected);
    expect(after.selectedSession).toBe(before.selectedSession);
    expect(after.sessions).toBe(before.sessions);
    expect(after.selectedFilePath).toBe("src/index.ts");
    expect(after.expandedDirs).toBe(before.expandedDirs);
    expect(after.selectedTerminalId).toBe("t1");
    expect(test.clearActiveSession).not.toHaveBeenCalled();
    expect(test.updateUrl).not.toHaveBeenCalled();
  });

  it("leaves the selection alone when the selected workspace disappeared", async () => {
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const removed = workspace(repo.id, "/repo-gone");
    const loadWorkspaces = vi.fn().mockResolvedValue([main]);
    const test = harness(
      {
        selectedMachine: machine("local"),
        projects: [repo],
        selectedProject: repo,
        selectedWorkspace: removed,
        workspaces: [main, removed],
        workspacesByProjectId: { [repo.id]: [main, removed] },
      },
      loadWorkspaces,
    );

    await test.controller.refreshSelectedProjectTopology();

    expect(test.state().selectedWorkspace).toBe(removed);
    expect(test.state().workspaces).toEqual([main]);
    expect(test.clearActiveSession).not.toHaveBeenCalled();
  });

  it("discards a response for a project the user has since left", async () => {
    const repo = project("p1", "/repo");
    const other = project("p2", "/other");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const created = workspace(repo.id, "/repo-feature");
    let resolveWorkspaces: ((workspaces: Workspace[]) => void) | undefined;
    const loadWorkspaces = vi.fn().mockReturnValue(new Promise<Workspace[]>((resolve) => { resolveWorkspaces = resolve; }));
    const test = harness(
      {
        selectedMachine: machine("local"),
        projects: [repo, other],
        selectedProject: repo,
        selectedWorkspace: main,
        workspaces: [main],
        workspacesByProjectId: { [repo.id]: [main] },
      },
      loadWorkspaces,
    );

    const pending = test.controller.refreshSelectedProjectTopology();
    test.setState({ selectedProject: other, selectedWorkspace: undefined, workspaces: [] });
    resolveWorkspaces?.([main, created]);
    await pending;

    expect(test.state().workspaces).toEqual([]);
    expect(test.state().workspacesByProjectId[repo.id]).toEqual([main]);
  });

  it("discards a response after the selected machine changed", async () => {
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    let resolveWorkspaces: ((workspaces: Workspace[]) => void) | undefined;
    const loadWorkspaces = vi.fn().mockReturnValue(new Promise<Workspace[]>((resolve) => { resolveWorkspaces = resolve; }));
    const test = harness(
      {
        selectedMachine: machine("local"),
        projects: [repo],
        selectedProject: repo,
        selectedWorkspace: main,
        workspaces: [main],
        workspacesByProjectId: { [repo.id]: [main] },
      },
      loadWorkspaces,
    );

    const pending = test.controller.refreshSelectedProjectTopology();
    test.setState({ selectedMachine: machine("remote") });
    resolveWorkspaces?.([main, workspace(repo.id, "/repo-feature")]);
    await pending;

    expect(test.state().workspaces).toEqual([main]);
    expect(test.state().workspacesByProjectId[repo.id]).toEqual([main]);
  });

  it("reports a failed refresh to the background error sink without painting an error banner", async () => {
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const failure = new Error("git worktree list failed");
    const loadWorkspaces = vi.fn().mockRejectedValue(failure);
    const test = harness(
      {
        selectedMachine: machine("local"),
        projects: [repo],
        selectedProject: repo,
        selectedWorkspace: main,
        workspaces: [main],
        workspacesByProjectId: { [repo.id]: [main] },
      },
      loadWorkspaces,
    );

    await test.controller.refreshSelectedProjectTopology();

    expect(test.state().error).toBe("");
    expect(test.state().workspaces).toEqual([main]);
    expect(test.backgroundErrors).toEqual([{ message: `Failed to refresh workspaces for project ${repo.id} on local`, error: failure }]);
  });

  it("re-points the selected workspace at refreshed metadata when its branch changed outside Forgerie", async () => {
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const selected = { ...workspace(repo.id, "/repo-feature"), label: "feature-a", branch: "feature-a" };
    const switched = { ...selected, label: "feature-b", branch: "feature-b" };
    const loadWorkspaces = vi.fn().mockResolvedValue([main, switched]);
    const test = harness(
      {
        selectedMachine: machine("local"),
        projects: [repo],
        selectedProject: repo,
        selectedWorkspace: selected,
        workspaces: [main, selected],
        workspacesByProjectId: { [repo.id]: [main, selected] },
        selectedSession: session(selected.path),
      },
      loadWorkspaces,
    );

    await test.controller.refreshSelectedProjectTopology();

    // Same workspace (same id/path), so the session must survive; only the stale label moves.
    expect(test.state().selectedWorkspace).toEqual(switched);
    expect(test.state().selectedWorkspace?.id).toBe(selected.id);
    expect(test.state().selectedSession).toBeDefined();
    expect(test.clearActiveSession).not.toHaveBeenCalled();
  });

  it("leaves the selected workspace object untouched when the refresh returns identical metadata", async () => {
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const selected = workspace(repo.id, "/repo-feature");
    // A fresh, equal object, exactly what a real HTTP response produces every resume.
    const loadWorkspaces = vi.fn().mockResolvedValue([{ ...main }, { ...selected }]);
    const test = harness(
      {
        selectedMachine: machine("local"),
        projects: [repo],
        selectedProject: repo,
        selectedWorkspace: selected,
        workspaces: [main, selected],
        workspacesByProjectId: { [repo.id]: [main, selected] },
      },
      loadWorkspaces,
    );

    await test.controller.refreshSelectedProjectTopology();

    // Identity preserved: an unchanged resume must not churn selected-workspace identity
    // into state, or every focus would re-render surfaces keyed on this object.
    expect(test.state().selectedWorkspace).toBe(selected);
  });

  it("serializes overlapping refreshes so an earlier response cannot overwrite a newer list", async () => {
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const created = workspace(repo.id, "/repo-feature");
    const gates: ((workspaces: Workspace[]) => void)[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const loadWorkspaces = vi.fn(() => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise<Workspace[]>((resolve) => {
        gates.push((workspaces) => { inFlight -= 1; resolve(workspaces); });
      });
    });
    const test = harness(
      {
        selectedMachine: machine("local"),
        projects: [repo],
        selectedProject: repo,
        selectedWorkspace: main,
        workspaces: [main],
        workspacesByProjectId: { [repo.id]: [main] },
      },
      loadWorkspaces,
    );

    const resumeRefresh = test.controller.refreshSelectedProjectTopology();
    await Promise.resolve();
    const appDataRefresh = test.controller.refreshSelectedProjectTopology();
    await Promise.resolve();

    // The second caller does not open its own request while the first is in flight; it gets
    // one trailing pass afterwards. Without this, two responses race and the slower-but-older
    // one can land last, making a just-created worktree disappear again.
    expect(maxInFlight).toBe(1);
    gates[0]?.([main]);
    await vi.waitFor(() => { expect(gates).toHaveLength(2); });
    gates[1]?.([main, created]);
    await Promise.all([resumeRefresh, appDataRefresh]);

    // The last response wins, so the newly created worktree stays visible.
    expect(test.state().workspaces).toEqual([main, created]);
  });

  it("does not request anything when no project is selected", async () => {
    const loadWorkspaces = vi.fn();
    const test = harness({ selectedMachine: machine("local") }, loadWorkspaces);

    await test.controller.refreshSelectedProjectTopology();

    expect(loadWorkspaces).not.toHaveBeenCalled();
  });
});

describe("WorkspaceController selection contracts", () => {
  it("clears selection, scoped state, and routing on request", () => {
    const repo = project("p1", "/repo");
    const selected = workspace(repo.id, repo.path);
    const test = harness({ selectedProject: repo, selectedWorkspace: selected, workspaces: [selected], selectedFilePath: "file.ts" }, vi.fn());

    test.controller.clearSelection();

    expect(test.clearActiveSession).toHaveBeenCalledOnce();
    expect(test.state().selectedProject).toBeUndefined();
    expect(test.state().selectedWorkspace).toBeUndefined();
    expect(test.state().selectedFilePath).toBeUndefined();
    expect(test.updateUrl).toHaveBeenCalledOnce();

    test.controller.clearSelection({ updateUrl: false });
    expect(test.updateUrl).toHaveBeenCalledOnce();
  });

  it("forgets one project's cached workspaces", () => {
    const test = harness({ workspacesByProjectId: { p1: [workspace("p1", "/one")], p2: [workspace("p2", "/two")] } }, vi.fn());

    test.controller.forgetProject("p1");

    expect(test.state().workspacesByProjectId).toEqual({ p2: [workspace("p2", "/two")] });
  });

  it("loads a project, selects its preferred workspace, and selects its session", async () => {
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const test = harness({ selectedMachine: machine("local"), projects: [repo] }, vi.fn().mockResolvedValue([main]));
    const selectedSession = session(main.path);
    test.preferredSession.mockReturnValue(selectedSession);

    await test.controller.selectProject(repo, { workspaceId: main.id, sessionId: selectedSession.id });

    expect(test.state().selectedProject).toBe(repo);
    expect(test.state().selectedWorkspace).toBe(main);
    expect(test.state().workspacesByProjectId[repo.id]).toEqual([main]);
    expect(test.selectSession).toHaveBeenCalledWith(selectedSession, { updateUrl: undefined });
  });

  it("updates the route when a project has no workspaces", async () => {
    const repo = project("p1", "/repo");
    const test = harness({ selectedMachine: machine("local"), projects: [repo] }, vi.fn().mockResolvedValue([]));

    await test.controller.selectProject(repo);

    expect(test.state().isLoadingWorkspaces).toBe(false);
    expect(test.updateUrl).toHaveBeenCalledOnce();
  });

  it("reports selected project and workspace loading failures", async () => {
    const repo = project("p1", "/repo");
    const selected = workspace(repo.id, repo.path);
    const projectFailure = harness({ selectedMachine: machine("local"), projects: [repo] }, vi.fn().mockRejectedValue(new Error("workspace list failed")));

    await projectFailure.controller.selectProject(repo);
    expect(projectFailure.state().error).toContain("workspace list failed");
    expect(projectFailure.state().isLoadingWorkspaces).toBe(false);

    const workspaceFailure = harness({ selectedMachine: machine("local"), projects: [repo], selectedProject: repo }, vi.fn());
    const failingSessions = vi.fn<typeof defaultApi.sessions>().mockRejectedValue(new Error("session list failed"));
    const controller = new WorkspaceController(
      workspaceFailure.state,
      workspaceFailure.setState,
      (options) => { workspaceFailure.updateUrl(options); },
      {
        clearActiveSession: workspaceFailure.clearActiveSession,
        mergeCreationFailedSessionStarts: (_cwd, listed) => listed,
        preferredSession: workspaceFailure.preferredSession,
        selectSession: workspaceFailure.selectSession,
      },
      undefined,
      { api: { workspaces: vi.fn<typeof defaultApi.workspaces>(), sessions: failingSessions } },
    );

    await controller.selectWorkspace(selected);
    expect(workspaceFailure.state().error).toContain("session list failed");
  });

  it("refreshes after deletion using main, first, or no fallback workspace", async () => {
    const repo = project("p1", "/repo");
    const removed = workspace(repo.id, "/removed");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const test = harness({ selectedMachine: machine("local"), projects: [repo], selectedProject: repo, selectedWorkspace: removed }, vi.fn().mockResolvedValue([main]));
    const select = vi.spyOn(test.controller, "selectWorkspace").mockResolvedValue();

    await test.controller.refreshAfterWorkspaceDeleted(repo.id, removed.id);
    expect(select).toHaveBeenCalledWith(main);

    select.mockClear();
    test.setState({ selectedWorkspace: removed });
    const first = workspace(repo.id, "/first");
    const load = vi.fn().mockResolvedValue([first]);
    const firstFallback = harness({ selectedMachine: machine("local"), projects: [repo], selectedProject: repo, selectedWorkspace: removed }, load);
    const selectFirst = vi.spyOn(firstFallback.controller, "selectWorkspace").mockResolvedValue();
    await firstFallback.controller.refreshAfterWorkspaceDeleted(repo.id, removed.id);
    expect(selectFirst).toHaveBeenCalledWith(first);

    const none = harness({ selectedMachine: machine("local"), projects: [repo], selectedProject: repo, selectedWorkspace: removed }, vi.fn().mockResolvedValue([]));
    const clear = vi.spyOn(none.controller, "clearSelection");
    await none.controller.refreshAfterWorkspaceDeleted(repo.id, removed.id);
    expect(clear).toHaveBeenCalledOnce();
  });

  it("rejects missing projects and identifies deletable worktrees", async () => {
    const test = harness({ projects: [] }, vi.fn());

    await expect(test.controller.refreshProjectWorkspaces("missing")).rejects.toThrow("Project not found");
    expect(canDeleteWorkspace(undefined)).toBe(false);
    expect(canDeleteWorkspace(workspace("p1", "/main", { isMain: true }))).toBe(false);
    expect(canDeleteWorkspace(workspace("p1", "/feature"))).toBe(true);
  });
});
