// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type GitStatusResponse } from "../api";
import { initialAppState, type AppState } from "../appState";
import { GitController } from "./gitController";

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("GitController", () => {
  it("does nothing without a complete workspace selection", async () => {
    const fixture = controllerFixture();
    const status = vi.spyOn(api, "gitStatus");
    const diff = vi.spyOn(api, "gitDiff");

    await fixture.controller.refreshGit();
    await fixture.controller.refreshDiff("src/app.ts");

    expect(status).not.toHaveBeenCalled();
    expect(diff).not.toHaveBeenCalled();
  });

  it("refreshes status and clears a selected file that disappeared", async () => {
    const fixture = controllerFixture(selectedState({ selectedDiffPath: "removed.ts" }));
    vi.spyOn(api, "gitStatus").mockResolvedValue(gitStatus([]));

    await fixture.controller.refreshGit();

    expect(fixture.state().gitStatus).toEqual(gitStatus([]));
    expect(fixture.state().gitStale).toBe(false);
    expect(fixture.state().selectedDiffPath).toBeUndefined();
    expect(window.location.search).toBe("");
  });

  it("refreshes the selected working and staged differences", async () => {
    const fixture = controllerFixture(selectedState());
    const gitDiff = vi.spyOn(api, "gitDiff")
      .mockResolvedValueOnce({ path: "src/app.ts", staged: false, hash: "working", diff: "+working", truncated: false })
      .mockResolvedValueOnce({ path: "src/app.ts", staged: true, hash: "staged", diff: "+staged", truncated: false });

    await fixture.controller.selectDiff("src/app.ts");

    expect(fixture.state().selectedDiffPath).toBe("src/app.ts");
    expect(fixture.state().workspaceTool).toBe("core:workspace.git");
    expect(fixture.state().selectedDiff?.hash).toBe("working");
    expect(fixture.state().selectedStagedDiff?.hash).toBe("staged");
    expect(gitDiff).toHaveBeenNthCalledWith(1, "project-1", "workspace-1", { path: "src/app.ts" }, "local");
    expect(gitDiff).toHaveBeenNthCalledWith(2, "project-1", "workspace-1", { path: "src/app.ts", staged: true }, "local");
    expect(fixture.updateUrl).toHaveBeenCalledWith({ replace: true });
    expect(window.location.search).toContain("core.workspace.git--diff=src%2Fapp.ts");
  });

  it("refreshes an existing selected difference after status", async () => {
    const fixture = controllerFixture(selectedState({ selectedDiffPath: "src/app.ts" }));
    vi.spyOn(api, "gitStatus").mockResolvedValue(gitStatus([{ path: "src/app.ts", index: "modified", workingTree: "modified" }]));
    const gitDiff = vi.spyOn(api, "gitDiff").mockResolvedValue({ path: "src/app.ts", staged: false, hash: "hash", diff: "", truncated: false });

    await fixture.controller.refreshGit();

    expect(gitDiff).toHaveBeenCalledTimes(2);
  });

  it("reports status and difference errors", async () => {
    const fixture = controllerFixture(selectedState());
    vi.spyOn(api, "gitStatus").mockRejectedValueOnce(new Error("status failed"));

    await fixture.controller.refreshGit();
    expect(fixture.state().error).toContain("status failed");

    vi.spyOn(api, "gitDiff").mockRejectedValue(new Error("diff failed"));
    await fixture.controller.restoreDiff("src/app.ts");
    expect(fixture.state().error).toContain("diff failed");
  });

  it("starts and disposes polling only while Git is visible", () => {
    vi.useFakeTimers();
    try {
      const fixture = controllerFixture(selectedState({ workspaceTool: "core:workspace.git" }));
      const refresh = vi.spyOn(fixture.controller, "refreshGit").mockResolvedValue();

      fixture.controller.updatePolling();
      vi.advanceTimersByTime(8_000);
      expect(refresh).toHaveBeenCalledOnce();

      fixture.controller.dispose();
      vi.advanceTimersByTime(8_000);
      expect(refresh).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});

function controllerFixture(initial: AppState = initialAppState()) {
  let state = initial;
  const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
  const updateUrl = vi.fn();
  return {
    controller: new GitController(() => state, setState, updateUrl),
    state: () => state,
    updateUrl,
  };
}

function selectedState(patch: Partial<AppState> = {}): AppState {
  return {
    ...initialAppState(),
    selectedMachine: { id: "local", name: "Local", kind: "local", createdAt: "now", updatedAt: "now" },
    selectedProject: { id: "project-1", name: "Project", path: "/repo", createdAt: "now" },
    selectedWorkspace: { id: "workspace-1", projectId: "project-1", path: "/repo", label: "repo", isMain: true, isGitRepo: true, isGitWorktree: false, effectiveConfig: {} },
    mainView: "chat",
    ...patch,
  };
}

function gitStatus(files: GitStatusResponse["files"]): GitStatusResponse {
  return { isGitRepo: true, hash: "status", branch: "main", files, submodules: [] };
}
