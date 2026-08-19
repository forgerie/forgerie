// @vitest-environment happy-dom

import { html, render, svg } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PiWebComponentStatus, PiWebStatusResponse, PluginRuntimeContext, PluginRuntimeState, WorkspacePanelContext } from "forgerie/plugin-api";
import plugin from "./pi-web-plugin.js";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Updates plugin actions", () => {
  it("forces an update check through the host runtime context", async () => {
    const action = plugin.activate({ apiVersion: 1, pluginId: "updates", html, svg }).contributions.actions?.find((candidate) => candidate.id === "check");
    if (action === undefined) throw new Error("Expected update check action");
    const checkForPiWebUpdates = vi.fn(() => Promise.resolve());
    const context = runtimeContext({ checkForPiWebUpdates });

    expect(action.enabled?.(context)).toBe(true);
    await action.run(context);

    expect(checkForPiWebUpdates).toHaveBeenCalledOnce();
  });

  it("disables the action on older hosts without the update-check helper", () => {
    const action = plugin.activate({ apiVersion: 1, pluginId: "updates", html, svg }).contributions.actions?.find((candidate) => candidate.id === "check");
    if (action === undefined) throw new Error("Expected update check action");
    const context = runtimeContext();

    expect(action.enabled?.(context)).toBe(false);
    expect(action.disabledReason?.(context)).toContain("newer Forgerie gateway");
  });

  it("renders loading and detailed update states", async () => {
    const panel = workspacePanel();
    const loading = document.createElement("div");
    render(panel.render(panelContext()), loading);
    expect(loading.textContent).toContain("Checking Forgerie update status");

    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const runCommand = vi.fn<WorkspacePanelContext["terminal"]["runCommand"]>(() => Promise.resolve(terminalCommandHandle()));
    const detailed = document.createElement("div");
    const value = status({
      components: {
        web: component({ stale: true, installation: { kind: "local", path: "/srv/forgerie" } }),
        sessiond: component({ component: "sessiond", label: "Session daemon", available: false }),
      },
      release: { packageName: "forgerie", updateAvailable: true, latestVersion: "2.0.0", checkedAt: "later" },
      commands: { update: "forgerie update", restart: "forgerie restart", status: "forgerie status" },
      messages: [{ id: "update", severity: "warning", title: "Update ready", body: "Install it", command: "forgerie update" }],
    });
    const context = panelContext({ piWebStatus: value }, runCommand);
    render(panel.render(context), detailed);

    expect(panel.visible?.(context)).toBe(true);
    expect(panel.badge?.(context)).toBe(1);
    expect(detailed.textContent).toContain("Update ready");
    expect(detailed.textContent).toContain("restart needed");
    expect(detailed.textContent).toContain("unavailable");
    expect(detailed.textContent).toContain("Latest npm release 2.0.0");

    const buttons = Array.from(detailed.querySelectorAll<HTMLButtonElement>("button"));
    buttons.find((button) => button.textContent === "Copy")?.click();
    buttons.find((button) => button.textContent === "Run")?.click();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith("forgerie update");
    expect(runCommand).toHaveBeenCalledWith({ title: "Update ready", command: "forgerie update", open: true, metadata: { "pi.plugin": "updates" } });
  });

  it("reports terminal command failures without rejecting the click", async () => {
    const panel = workspacePanel();
    const target = document.createElement("div");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const runCommand = vi.fn<WorkspacePanelContext["terminal"]["runCommand"]>(() => Promise.reject(new Error("terminal unavailable")));
    const value = status({
      components: { web: component({ stale: true }), sessiond: component({ component: "sessiond", label: "Session daemon" }) },
      commands: { restart: "forgerie restart" },
    });
    render(panel.render(panelContext({ piWebStatus: value }, runCommand)), target);

    Array.from(target.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Run")?.click();
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    expect(error).toHaveBeenCalledWith('Updates plugin failed to run "Restart everything"', expect.any(Error));
  });

  it("renders current status and release-check diagnostics", () => {
    const panel = workspacePanel();
    const target = document.createElement("div");
    const value = status({
      release: { packageName: "forgerie", updateAvailable: false, skipped: true, error: "offline" },
      messages: [],
      commands: {},
    });
    const context = panelContext({ piWebStatus: value });
    render(panel.render(context), target);

    expect(panel.badge?.(context)).toBeUndefined();
    expect(target.textContent).toContain("No Forgerie update or restart messages");
    expect(target.textContent).toContain("Remote version check skipped");
    expect(target.textContent).toContain("Remote version check failed: offline");
  });
});

function workspacePanel() {
  const panel = plugin.activate({ apiVersion: 1, pluginId: "updates", html, svg }).contributions.workspacePanels?.[0];
  if (panel === undefined) throw new Error("Expected updates workspace panel");
  return panel;
}

function component(overrides: Partial<PiWebComponentStatus> = {}): PiWebComponentStatus {
  return {
    component: "web",
    label: "Web/UI",
    runtimeVersion: "1.0.0",
    installedVersion: "1.0.0",
    stale: false,
    available: true,
    ...overrides,
  };
}

function status(overrides: Partial<PiWebStatusResponse> = {}): PiWebStatusResponse {
  return {
    packageName: "forgerie",
    generatedAt: "now",
    components: {
      web: component(),
      sessiond: component({ component: "sessiond", label: "Session daemon" }),
    },
    release: { packageName: "forgerie", updateAvailable: false },
    commands: {},
    messages: [],
    ...overrides,
  };
}

function panelContext(
  state: PluginRuntimeState = {},
  runCommand: WorkspacePanelContext["terminal"]["runCommand"] = vi.fn(() => Promise.resolve(terminalCommandHandle())),
): WorkspacePanelContext {
  const unavailable = () => Promise.reject(new Error("unused test capability"));
  return {
    machine: { id: "local", name: "Local", kind: "local" },
    workspace: { id: "workspace-1", projectId: "project-1", path: "/repo", label: "repo", isMain: true, isGitRepo: true, isGitWorktree: false },
    state,
    files: { readFile: unavailable, listFiles: unavailable, writeFile: unavailable, deleteFile: unavailable, moveFile: unavailable },
    host: { requestRender: () => undefined },
    prompt: { insertText: () => true, getText: () => "", getSelection: () => null },
    terminal: { open: () => undefined, runCommand },
  };
}

function terminalCommandHandle(): Awaited<ReturnType<WorkspacePanelContext["terminal"]["runCommand"]>> {
  const run = {
    id: "run-1",
    origin: "updates",
    projectId: "project-1",
    terminalId: "terminal-1",
    workspaceId: "workspace-1",
    title: "Update",
    command: "forgerie update",
    status: "running" as const,
    createdAt: "now",
    startedAt: "now",
    metadata: {},
  };
  return { run, completed: Promise.resolve(run) };
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
