// @vitest-environment happy-dom

import { html } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import type { WorkspacePanelContext, QualifiedWorkspacePanelContribution } from "../plugins/types";
import { NEW_SESSION_LABEL } from "./shared";
import { WorkspacePanel } from "./WorkspacePanel";

afterEach(() => {
  document.body.replaceChildren();
});

describe("WorkspacePanel header", () => {
  it("keeps New session fixed outside the desktop tab scroller and preserves tab selection", async () => {
    const onNewSession = vi.fn();
    const onSelectTool = vi.fn();
    const panel = await mountPanel({ onNewSession, onSelectTool });
    const root = required(panel.shadowRoot, "workspace panel shadow root");
    const action = required(root.querySelector<HTMLButtonElement>("[data-action='new-session']"), "New session action");
    const strip = required(root.querySelector<HTMLElement>(".workspace-header-strip"), "workspace tab strip");
    const gitTab = required(root.querySelector<HTMLButtonElement>("button[aria-label='Git']"), "Git tab");

    expect(action.title).toBe(NEW_SESSION_LABEL);
    expect(action.getAttribute("aria-label")).toBe(NEW_SESSION_LABEL);
    expect(action.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(strip.contains(action)).toBe(false);
    expect(action.closest("header")).toBe(strip.closest("header"));

    action.click();
    gitTab.click();
    expect(onNewSession).toHaveBeenCalledOnce();
    expect(onSelectTool).toHaveBeenCalledExactlyOnceWith("core:workspace.git");
  });

  it("keeps the fixed action and plugin content when summoned chrome hides tool tabs", async () => {
    const renderPlugin = vi.fn(() => html`<div data-plugin-content>Plugin content</div>`);
    const panel = await mountPanel({
      hideToolTabs: true,
      onNewSession: vi.fn(),
      panels: [workspacePanel("plugin:workspace.processes", "Processes", renderPlugin)],
      tool: "plugin:workspace.processes",
    });
    const root = required(panel.shadowRoot, "workspace panel shadow root");

    expect(root.querySelector(".workspace-header-strip")).toBeNull();
    expect(root.querySelector("[data-action='new-session']")).not.toBeNull();
    expect(root.querySelector(".panel-content > [data-plugin-content]")?.textContent).toContain("Plugin content");
    expect(renderPlugin).toHaveBeenCalledOnce();
  });

  it("omits the New session action when the root does not provide it", async () => {
    const panel = await mountPanel();

    expect(panel.shadowRoot?.querySelector("[data-action='new-session']")).toBeNull();
  });

  it("leaves tabs horizontally scrollable while the fixed action owns no overlay", () => {
    const css = WorkspacePanel.styles.toString().replace(/\/\*[\s\S]*?\*\//gu, "");

    expect(css).toMatch(/\.workspace-header-strip\s*\{[^}]*overflow-x:\s*auto/u);
    expect(css).toMatch(/\.workspace-header-action\s*\{[^}]*flex:\s*0 0 auto/u);
    expect(css).not.toMatch(/\.workspace-header-action\s*\{[^}]*(?:position:\s*(?:absolute|fixed)|float:)/u);
    expect(css).not.toMatch(/@media\s*\([^)]*(?:499|739|789|979)px/u);
  });
});

interface MountPanelOptions {
  onNewSession?: () => void;
  onSelectTool?: (tool: QualifiedWorkspacePanelContribution["id"]) => void;
  hideToolTabs?: boolean;
  panels?: QualifiedWorkspacePanelContribution[];
  tool?: QualifiedWorkspacePanelContribution["id"];
}

async function mountPanel(options: MountPanelOptions = {}): Promise<WorkspacePanel> {
  const panel = new WorkspacePanel();
  panel.workspace = workspaceContext.workspace;
  panel.panelContext = workspaceContext;
  panel.panels = options.panels ?? [
    workspacePanel("core:workspace.files", "Files"),
    workspacePanel("core:workspace.git", "Git"),
  ];
  panel.tool = options.tool ?? "core:workspace.files";
  panel.hideToolTabs = options.hideToolTabs ?? false;
  if (options.onNewSession !== undefined) panel.onNewSession = options.onNewSession;
  panel.onSelectTool = options.onSelectTool ?? (() => undefined);
  document.body.append(panel);
  await panel.updateComplete;
  return panel;
}

function workspacePanel(
  id: QualifiedWorkspacePanelContribution["id"],
  title: string,
  render: QualifiedWorkspacePanelContribution["render"] = () => html`<div>${title} content</div>`,
): QualifiedWorkspacePanelContribution {
  const separator = id.indexOf(":");
  return {
    id,
    pluginId: id.slice(0, separator),
    localId: id.slice(separator + 1),
    title,
    render,
  };
}

const workspaceContext: WorkspacePanelContext = {
  machine: { id: "local", name: "Local", kind: "local" },
  workspace: { id: "workspace-1", projectId: "project-1", path: "/tmp/project", label: "main", isMain: true, isGitRepo: true, isGitWorktree: false, effectiveConfig: {} },
  state: initialAppState(),
  files: {
    readFile: () => Promise.reject(new Error("not implemented")),
    listFiles: () => Promise.reject(new Error("not implemented")),
    writeFile: () => Promise.reject(new Error("not implemented")),
    deleteFile: () => Promise.reject(new Error("not implemented")),
    moveFile: () => Promise.reject(new Error("not implemented")),
  },
  prompt: { insertText: () => true, getText: () => "", getSelection: () => null },
  terminal: { open: () => undefined, runCommand: () => Promise.reject(new Error("not implemented")) },
  host: { requestRender: () => undefined },
  fileTree: [],
  expandedDirs: {},
  selectedFilePath: undefined,
  selectedFileContent: undefined,
  fileTreeStale: false,
  gitStatus: undefined,
  selectedDiffPath: undefined,
  selectedDiff: undefined,
  selectedStagedDiff: undefined,
  gitStale: false,
  activeTerminalCount: 0,
  selectedTerminalId: undefined,
  terminalAutoStart: false,
  workspaceUploadDefaultFolder: ".forgerie/uploads",
  onRefreshFiles: () => undefined,
  onExpandDir: () => undefined,
  onSelectFile: () => undefined,
  onStartWorkspaceUpload: () => undefined,
  onCancelWorkspaceUpload: () => undefined,
  onClearWorkspaceUpload: () => undefined,
  onRefreshGit: () => undefined,
  onSelectDiff: () => undefined,
  onSelectTerminal: () => undefined,
};

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${label}`);
  return value;
}
