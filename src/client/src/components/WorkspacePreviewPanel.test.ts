// @vitest-environment happy-dom
// The frame's src points at the preview route; without this option happy-dom
// would try to fetch it over real HTTP during the test run.
// @vitest-environment-options { "settings": { "disableIframePageLoading": true } }

import { afterEach, describe, expect, it, vi } from "vitest";
import { DOCUMENT_PREVIEW_SANDBOX } from "../../../shared/workspaceFiles";
import { initialAppState } from "../appState";
import type { WorkspacePanelContext } from "../plugins/types";
import { WorkspacePreviewPanel, workspacePreviewModel } from "./WorkspacePreviewPanel";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("workspacePreviewModel", () => {
  it("is empty without an open document", () => {
    expect(workspacePreviewModel(modelContext(undefined), 0)).toEqual({ kind: "empty" });
  });

  it("addresses the document through the machine-scoped preview route with encoded segments", () => {
    const model = workspacePreviewModel(modelContext("lessons/0001 intro.html"), 0);

    if (model.kind !== "document") throw new Error("expected a document model");
    expect(model.path).toBe("lessons/0001 intro.html");
    expect(model.src).toContain("api/machines/local/projects/project-1/workspaces/workspace-1/preview/lessons/0001%20intro.html");
    expect(model.src).not.toContain("?v=");
  });

  it("appends the reload version once reloading starts", () => {
    const model = workspacePreviewModel(modelContext("index.html"), 2);

    if (model.kind !== "document") throw new Error("expected a document model");
    expect(model.src).toContain("/preview/index.html?v=2");
  });
});

describe("workspace-preview-panel", () => {
  it("renders the open document in a frame locked to the shared sandbox policy", async () => {
    const panel = new WorkspacePreviewPanel();
    panel.context = panelContext("lessons/0001-intro.html");
    document.body.append(panel);
    await panel.updateComplete;

    const frame = panel.shadowRoot?.querySelector("iframe");
    expect(frame?.getAttribute("sandbox")).toBe(DOCUMENT_PREVIEW_SANDBOX);
    expect(frame?.getAttribute("src")).toContain("/preview/lessons/0001-intro.html");
    expect(frame?.getAttribute("title")).toBe("lessons/0001-intro.html");
    expect(panel.shadowRoot?.textContent).toContain("lessons/0001-intro.html");
  });

  it("says so when no document is open instead of rendering a dead frame", async () => {
    const panel = new WorkspacePreviewPanel();
    panel.context = panelContext(undefined);
    document.body.append(panel);
    await panel.updateComplete;

    expect(panel.shadowRoot?.querySelector("iframe")).toBeNull();
    expect(panel.shadowRoot?.textContent).toContain("No document open");
  });

  it("reload refetches by changing the frame url", async () => {
    const panel = new WorkspacePreviewPanel();
    panel.context = panelContext("index.html");
    document.body.append(panel);
    await panel.updateComplete;

    reloadButton(panel).click();
    await panel.updateComplete;

    expect(panel.shadowRoot?.querySelector("iframe")?.getAttribute("src")).toContain("?v=1");
  });
});

function reloadButton(panel: WorkspacePreviewPanel): HTMLButtonElement {
  const button = [...(panel.shadowRoot?.querySelectorAll("button") ?? [])].find((candidate) => candidate.textContent.includes("Reload"));
  if (button === undefined) throw new Error("Reload button is not rendered");
  return button;
}

function modelContext(path: string | undefined): Parameters<typeof workspacePreviewModel>[0] {
  return {
    machine: { id: "local", name: "Local", kind: "local" },
    workspace: { id: "workspace-1", projectId: "project-1" },
    state: { previewDocument: path === undefined ? undefined : { path } },
  };
}

function panelContext(path: string | undefined): WorkspacePanelContext {
  return {
    machine: { id: "local", name: "Local", kind: "local" },
    workspace: { id: "workspace-1", projectId: "project-1", path: "/tmp/project", label: "main", isMain: true, isGitRepo: true, isGitWorktree: false, effectiveConfig: {} },
    state: { ...initialAppState(), previewDocument: path === undefined ? undefined : { path } },
    files: {
      readFile: vi.fn<WorkspacePanelContext["files"]["readFile"]>(() => Promise.reject(new Error("not implemented"))),
      listFiles: vi.fn<WorkspacePanelContext["files"]["listFiles"]>(() => Promise.reject(new Error("not implemented"))),
      writeFile: vi.fn<WorkspacePanelContext["files"]["writeFile"]>(() => Promise.reject(new Error("not implemented"))),
      deleteFile: vi.fn<WorkspacePanelContext["files"]["deleteFile"]>(() => Promise.reject(new Error("not implemented"))),
      moveFile: vi.fn<WorkspacePanelContext["files"]["moveFile"]>(() => Promise.reject(new Error("not implemented"))),
    },
    prompt: { insertText: vi.fn<WorkspacePanelContext["prompt"]["insertText"]>(), getText: vi.fn<WorkspacePanelContext["prompt"]["getText"]>(() => ""), getSelection: vi.fn<WorkspacePanelContext["prompt"]["getSelection"]>(() => null) },
    terminal: { open: vi.fn<WorkspacePanelContext["terminal"]["open"]>(), runCommand: vi.fn<WorkspacePanelContext["terminal"]["runCommand"]>(() => Promise.reject(new Error("not implemented"))) },
    host: { requestRender: vi.fn<WorkspacePanelContext["host"]["requestRender"]>() },
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
    onRefreshFiles: vi.fn<WorkspacePanelContext["onRefreshFiles"]>(),
    onExpandDir: vi.fn<WorkspacePanelContext["onExpandDir"]>(),
    onSelectFile: vi.fn<WorkspacePanelContext["onSelectFile"]>(),
    onStartWorkspaceUpload: vi.fn<WorkspacePanelContext["onStartWorkspaceUpload"]>(() => undefined),
    onCancelWorkspaceUpload: vi.fn<WorkspacePanelContext["onCancelWorkspaceUpload"]>(),
    onClearWorkspaceUpload: vi.fn<WorkspacePanelContext["onClearWorkspaceUpload"]>(),
    onRefreshGit: vi.fn<WorkspacePanelContext["onRefreshGit"]>(),
    onSelectDiff: vi.fn<WorkspacePanelContext["onSelectDiff"]>(),
    onSelectTerminal: vi.fn<WorkspacePanelContext["onSelectTerminal"]>(),
  };
}
