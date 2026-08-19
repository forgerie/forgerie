// @vitest-environment happy-dom

import { html, svg } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { PluginRuntimeContext, WorkspacePanelContext } from "forgerie/plugin-api";
import plugin from "./pi-web-plugin.js";

describe("managed processes plugin", () => {
  it("opens its qualified workspace panel only when a workspace is selected", async () => {
    const contributions = plugin.activate({ apiVersion: 1, pluginId: "processes", html, svg }).contributions;
    const action = contributions.actions?.[0];
    if (action === undefined) throw new Error("Expected the managed processes action");
    const selectWorkspaceTool = vi.fn();
    const withoutWorkspace = runtimeContext(selectWorkspaceTool);
    const withWorkspace = runtimeContext(selectWorkspaceTool, { id: "workspace-1" });

    expect(action.enabled?.(withoutWorkspace)).toBe(false);
    await action.run(withoutWorkspace);
    expect(selectWorkspaceTool).not.toHaveBeenCalled();

    expect(action.enabled?.(withWorkspace)).toBe(true);
    await action.run(withWorkspace);
    expect(selectWorkspaceTool).toHaveBeenCalledWith("processes:workspace.processes");
  });

  it("registers a renderable workspace panel", () => {
    const panel = plugin.activate({ apiVersion: 1, pluginId: "processes", html, svg }).contributions.workspacePanels?.[0];
    if (panel === undefined) throw new Error("Expected the managed processes panel");

    expect(panel.title).toBe("Processes");
    expect(panel.render(panelContext())).toBeDefined();
  });
});

function runtimeContext(
  selectWorkspaceTool: PluginRuntimeContext["selectWorkspaceTool"],
  selectedWorkspace?: { id: string },
): PluginRuntimeContext {
  const noop = () => undefined;
  return {
    state: { ...(selectedWorkspace === undefined ? {} : { selectedWorkspace: workspace }) },
    prompt: { insertText: () => true, getText: () => "", getSelection: () => null },
    openActionPalette: noop,
    focusPrompt: noop,
    addProject: noop,
    configureAuth: noop,
    logoutAuth: noop,
    openThemePicker: noop,
    selectMainView: noop,
    selectWorkspaceTool,
    openTerminal: noop,
    refreshFiles: noop,
    refreshGit: noop,
    refreshAppData: noop,
    reloadPage: noop,
    startSession: noop,
    archiveSession: noop,
    stopActiveWork: noop,
  };
}

const workspace = {
  id: "workspace-1",
  projectId: "project-1",
  path: "/repo",
  label: "repo",
  isMain: true,
  isGitRepo: true,
  isGitWorktree: false,
};

function panelContext(): WorkspacePanelContext {
  const unavailable = () => Promise.reject(new Error("unused test capability"));
  return {
    machine: { id: "local", name: "Local", kind: "local" },
    workspace,
    files: { readFile: unavailable, listFiles: unavailable, writeFile: unavailable, deleteFile: unavailable, moveFile: unavailable },
    host: { requestRender: () => undefined },
    prompt: { insertText: () => true, getText: () => "", getSelection: () => null },
    terminal: { open: () => undefined, runCommand: unavailable },
  };
}
