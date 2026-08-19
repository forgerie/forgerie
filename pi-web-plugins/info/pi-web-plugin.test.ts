import { html, svg } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginRuntimeContext } from "forgerie/plugin-api";
import plugin from "./pi-web-plugin.js";

describe("Info plugin copy-diagnostics action", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts the v1 session method without requiring the additive composer alias", () => {
    const context = runtimeContext();

    expect(context.startSession).toBeTypeOf("function");
    expect(context.openNewSessionComposer).toBeUndefined();
  });

  it("contributes workspace labels and a renderable panel", () => {
    const contributions = plugin.activate({ apiVersion: 1, pluginId: "info", html, svg }).contributions;
    const label = contributions.workspaceLabels?.[0];
    const panel = contributions.workspacePanels?.[0];
    if (label === undefined || panel === undefined) throw new Error("Expected info workspace contributions");
    const gitContext = { ...panelContext(), workspace: workspace(true), state: {} };
    const folderContext = { ...panelContext(), workspace: workspace(false), state: {} };

    expect(label.items(gitContext)).toEqual([{ type: "text", text: "git", title: "/repo" }]);
    expect(label.items(folderContext)).toEqual([{ type: "text", text: "folder", title: "/repo" }]);
    expect(panel.render(panelContext())).toBeDefined();
  });

  it("copies a diagnostics summary to the clipboard", async () => {
    const writeText = vi.fn((text: string) => { void text; return Promise.resolve(); });
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const action = findCopyDiagnosticsAction();
    const context = runtimeContext({
      state: {
        selectedMachine: { id: "local", name: "devbox", kind: "local" },
        selectedWorkspace: {
          id: "ws-1",
          projectId: "proj-1",
          path: "/srv/dev/pi-web",
          label: "pi-web",
          branch: "main",
          isMain: true,
          isGitRepo: true,
          isGitWorktree: false,
        },
      },
    });

    await action.run(context);

    expect(writeText).toHaveBeenCalledOnce();
    const summary = writeText.mock.calls[0]?.[0];
    expect(summary).toContain("Forgerie diagnostics");
    expect(summary).toContain("Status: unavailable");
    expect(summary).toContain("Machine: devbox (local machine)");
    expect(summary).toContain("Workspace: pi-web — /srv/dev/pi-web (branch main, git repo, main workspace)");
  });
});

function findCopyDiagnosticsAction() {
  const action = plugin.activate({ apiVersion: 1, pluginId: "info", html, svg }).contributions.actions?.find((candidate) => candidate.id === "copy-diagnostics");
  if (action === undefined) throw new Error("Expected copy-diagnostics action");
  return action;
}

function workspace(isGitRepo: boolean) {
  return {
    id: "workspace-1",
    projectId: "project-1",
    path: "/repo",
    label: "repo",
    isMain: true,
    isGitRepo,
    isGitWorktree: false,
  };
}

function panelContext() {
  const unavailable = () => Promise.reject(new Error("unused test capability"));
  return {
    machine: { id: "local", name: "Local", kind: "local" as const },
    workspace: workspace(true),
    files: { readFile: unavailable, listFiles: unavailable, writeFile: unavailable, deleteFile: unavailable, moveFile: unavailable },
    host: { requestRender: () => undefined },
    prompt: { insertText: () => true, getText: () => "", getSelection: () => null },
    terminal: { open: () => undefined, runCommand: unavailable },
  };
}

function runtimeContext(patch: Partial<PluginRuntimeContext> = {}): PluginRuntimeContext {
  const noop = () => undefined;
  return {
    state: {},
    prompt: { insertText: () => true, getText: () => "", getSelection: () => null },
    openActionPalette: noop,
    focusPrompt: noop,
    addProject: noop,
    configureAuth: noop,
    logoutAuth: noop,
    openThemePicker: noop,
    selectMainView: noop,
    selectWorkspaceTool: noop,
    openTerminal: noop,
    refreshFiles: noop,
    refreshGit: noop,
    refreshAppData: noop,
    reloadPage: noop,
    startSession: noop,
    archiveSession: noop,
    stopActiveWork: noop,
    ...patch,
  };
}
