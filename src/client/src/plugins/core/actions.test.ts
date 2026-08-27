import { afterEach, describe, expect, it, vi } from "vitest";
import { initialAppState, type AppState } from "../../appState";
import type { PluginRuntimeContext } from "../types";
import { createCoreActions } from "./actions";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("core actions", () => {
  it("routes every action through the runtime public contract", async () => {
    const context = runtimeContext();

    for (const action of createCoreActions()) await action.run(context);

    expect(context.openActionPalette).toHaveBeenCalledOnce();
    expect(context.focusPrompt).toHaveBeenCalledOnce();
    expect(context.addMachine).toHaveBeenCalledOnce();
    expect(context.refreshSelectedMachine).toHaveBeenCalledOnce();
    expect(context.openSelectedMachine).toHaveBeenCalledOnce();
    expect(context.removeSelectedMachine).toHaveBeenCalledOnce();
    expect(context.addProject).toHaveBeenCalledOnce();
    expect(context.openPromptDialog).toHaveBeenCalledOnce();
    expect(context.configureAuth).toHaveBeenCalledOnce();
    expect(context.logoutAuth).toHaveBeenCalledOnce();
    expect(context.openThemePicker).toHaveBeenCalledOnce();
    expect(context.piWebUnstable?.openSettings).toHaveBeenCalledTimes(2);
    expect(context.piWebUnstable?.openSettings).toHaveBeenNthCalledWith(1);
    expect(context.piWebUnstable?.openSettings).toHaveBeenNthCalledWith(2, "shortcuts");
    expect(context.reloadPage).toHaveBeenCalledOnce();
    expect(context.selectMainView).toHaveBeenCalledWith("chat");
    expect(context.selectMainView).toHaveBeenCalledWith("core:workspace.files");
    expect(context.selectMainView).toHaveBeenCalledWith("core:workspace.git");
    expect(context.selectMainView).toHaveBeenCalledWith("core:workspace.terminal");
    expect(context.refreshFiles).toHaveBeenCalledTimes(2);
    expect(context.refreshGit).toHaveBeenCalledOnce();
    expect(context.deleteWorkspace).toHaveBeenCalledOnce();
    expect(context.openNewSessionComposer).toHaveBeenCalledTimes(2);
    expect(context.openNewSessionComposer).toHaveBeenNthCalledWith(1);
    expect(context.openNewSessionComposer).toHaveBeenNthCalledWith(2, "rapidfire");
    expect(context.openModelPicker).toHaveBeenCalledOnce();
    expect(context.cycleModel).toHaveBeenCalledOnce();
    expect(context.openThinkingLevelPicker).toHaveBeenCalledOnce();
    expect(context.archiveSession).toHaveBeenCalledOnce();
    expect(context.reloadSession).toHaveBeenCalledOnce();
    expect(context.deleteCachedNewSession).toHaveBeenCalledOnce();
    expect(context.stopActiveWork).toHaveBeenCalledOnce();
  });

  it("enables machine and workspace actions only for compatible selections", () => {
    const actions = actionMap();
    const empty = runtimeContext({ selectedMachine: undefined, selectedWorkspace: undefined });
    const local = runtimeContext({ selectedMachine: { id: "local", name: "Local", kind: "local", createdAt: "now", updatedAt: "now" } });
    const remote = runtimeContext({ selectedMachine: { id: "remote", name: "Remote", kind: "remote", baseUrl: "https://remote.test", createdAt: "now", updatedAt: "now" } });
    const plainWorkspace = runtimeContext({ selectedWorkspace: workspace({ isGitRepo: false, isGitWorktree: false }) });
    const gitWorkspace = runtimeContext({ selectedWorkspace: workspace({ isGitRepo: true, isGitWorktree: true }) });

    expect(actions.get("machine.open")?.enabled?.(empty)).toBe(false);
    expect(actions.get("machine.open")?.enabled?.(local)).toBe(false);
    expect(actions.get("machine.open")?.enabled?.(remote)).toBe(true);
    expect(actions.get("machine.remove")?.enabled?.(remote)).toBe(true);
    expect(actions.get("view.files")?.enabled?.(empty)).toBe(false);
    expect(actions.get("view.files")?.enabled?.(plainWorkspace)).toBe(true);
    expect(actions.get("view.git")?.enabled?.(plainWorkspace)).toBe(false);
    expect(actions.get("view.git")?.enabled?.(gitWorkspace)).toBe(true);
    expect(actions.get("workspace.delete")?.enabled?.(gitWorkspace)).toBe(true);
  });

  it("refreshes Git only when the Git panel owns a Git workspace", async () => {
    const action = actionMap().get("workspace.refresh-current");
    if (action === undefined) throw new Error("Expected current workspace refresh action");
    const git = runtimeContext({ selectedWorkspace: workspace({ isGitRepo: true }), workspaceTool: "core:workspace.git" });
    const files = runtimeContext({ selectedWorkspace: workspace({ isGitRepo: false }), workspaceTool: "core:workspace.git" });

    await action.run(git);
    await action.run(files);

    expect(git.refreshGit).toHaveBeenCalledOnce();
    expect(git.refreshFiles).not.toHaveBeenCalled();
    expect(files.refreshFiles).toHaveBeenCalledOnce();
  });
});

function actionMap() {
  return new Map(createCoreActions().map((action) => [action.id, action]));
}

function runtimeContext(statePatch: Partial<AppState> = {}): PluginRuntimeContext {
  const callback = () => vi.fn();
  return {
    state: { ...initialAppState(), ...statePatch },
    prompt: { insertText: vi.fn(() => true), getText: vi.fn(() => ""), getSelection: vi.fn(() => null) },
    piWebUnstable: {
      openSettings: callback(),
      terminalCommandRuns: {
        runCommand: vi.fn(() => Promise.reject(new Error("unused"))),
        listCommandRuns: vi.fn(() => Promise.resolve([])),
        getCommandRun: vi.fn(() => Promise.resolve(undefined)),
        open: callback(),
      },
    },
    openActionPalette: callback(),
    focusPrompt: callback(),
    addProject: callback(),
    openPromptDialog: callback(),
    addMachine: callback(),
    refreshSelectedMachine: callback(),
    removeSelectedMachine: callback(),
    openSelectedMachine: callback(),
    configureAuth: callback(),
    logoutAuth: callback(),
    openThemePicker: callback(),
    openModelPicker: callback(),
    cycleModel: callback(),
    openThinkingLevelPicker: callback(),
    selectMainView: callback(),
    selectWorkspaceTool: callback(),
    openTerminal: callback(),
    refreshFiles: callback(),
    refreshGit: callback(),
    refreshAppData: callback(),
    reloadPage: callback(),
    deleteWorkspace: callback(),
    startSession: callback(),
    openNewSessionComposer: callback(),
    archiveSession: callback(),
    reloadSession: callback(),
    deleteCachedNewSession: callback(),
    stopActiveWork: callback(),
  };
}

function workspace(patch: Partial<NonNullable<AppState["selectedWorkspace"]>> = {}): NonNullable<AppState["selectedWorkspace"]> {
  return {
    id: "workspace-1",
    projectId: "project-1",
    path: "/repo",
    label: "repo",
    isMain: false,
    isGitRepo: true,
    isGitWorktree: true,
    effectiveConfig: {},
    ...patch,
  };
}
