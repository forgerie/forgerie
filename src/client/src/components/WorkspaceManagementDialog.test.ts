// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project, Workspace } from "../api";
import type { WorkspaceManagementDialogState } from "../appState";
import { WorkspaceManagementDialog } from "./WorkspaceManagementDialog";
import type { ProjectList } from "./ProjectList";
import { settleRenderedDialog } from "./modalSurfaceTestSupport";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("WorkspaceManagementDialog workspace management", () => {
  it("renders no session-start mode and opens the selected workspace for management", async () => {
    const onConfirmManage = vi.fn();
    const dialog = await mount({
      dialogState: { step: "workspace", project, workspaces: [workspace], loading: false, error: undefined },
      onConfirmManage,
    });

    const root = required(dialog.shadowRoot, "shadow root");
    expect(root.textContent).toContain("Manage projects and workspaces");
    expect(root.textContent).not.toContain("Start session");
    required(root.querySelector<HTMLButtonElement>("[data-workspace-id='workspace']"), "workspace button").click();
    expect(onConfirmManage).toHaveBeenCalledWith(workspace);
  });

  it("offers project selection, creation, and close actions from the project step", async () => {
    const onSelectProject = vi.fn();
    const onCloseProject = vi.fn();
    const onAddProject = vi.fn();
    vi.stubGlobal("confirm", vi.fn(() => true));
    const dialog = await mount({ dialogState: { step: "project" }, onSelectProject, onCloseProject, onAddProject });
    const root = required(dialog.shadowRoot, "shadow root");
    const list = await projectList(dialog);
    const row = projectRow(list);

    required(root.querySelector<HTMLButtonElement>("[data-action='add-project']"), "add project button").click();
    expect(onAddProject).toHaveBeenCalledOnce();

    row.click();
    required(row.querySelector<HTMLButtonElement>(".action-menu-toggle"), "project actions button").click();
    await list.updateComplete;
    required(list.shadowRoot?.querySelector<HTMLButtonElement>(".action-menu-panel button"), "close project button").click();

    expect(onSelectProject).toHaveBeenCalledWith(project);
    expect(confirm).toHaveBeenCalledWith("Close Forgerie?\n\nThis only removes it from Forgerie; it will not change the project folder.");
    expect(onCloseProject).toHaveBeenCalledWith(project);
  });

  it("offers project creation from the empty state when no projects exist", async () => {
    const onAddProject = vi.fn();
    const dialog = await mount({ dialogState: { step: "project" }, projects: [], onAddProject });
    const root = required(dialog.shadowRoot, "shadow root");

    expect(root.querySelector("[data-empty-projects]")?.textContent).toContain("No projects found. Add a project first.");
    expect(root.querySelectorAll("[data-action='add-project']")).toHaveLength(1);
    required(root.querySelector<HTMLButtonElement>("[data-empty-projects] [data-action='add-project']"), "empty state add project button").click();
    expect(onAddProject).toHaveBeenCalledOnce();
  });

  it("preserves loading, error, back, and cancel contracts", async () => {
    const onCancel = vi.fn();
    const dialog = await mount({ dialogState: { step: "project" }, onCancel });
    const root = required(dialog.shadowRoot, "shadow root");

    required(root.querySelector<HTMLButtonElement>("[data-action='cancel']"), "cancel button").click();
    expect(onCancel).toHaveBeenCalledOnce();

    dialog.dialogState = { step: "workspace", project, workspaces: [], loading: true, error: undefined };
    await dialog.updateComplete;
    expect(root.querySelector("[data-state='workspace-loading']")).not.toBeNull();

    const onBack = vi.fn();
    dialog.onBack = onBack;
    dialog.dialogState = { step: "workspace", project, workspaces: [], loading: false, error: "Unavailable" };
    await dialog.updateComplete;
    expect(root.querySelector("[data-state='workspace-error']")?.textContent).toContain("Unavailable");
    required(root.querySelector<HTMLButtonElement>("[data-action='back']"), "back button").click();
    expect(onBack).toHaveBeenCalledOnce();
  });
});

const project: Project = { id: "project", name: "Forgerie", path: "/repo", createdAt: "2026-08-10T00:00:00.000Z" };
const workspace: Workspace = { id: "workspace", projectId: project.id, path: project.path, label: "main", isMain: true, isGitRepo: true, isGitWorktree: false, effectiveConfig: {} };

async function mount(properties: {
  dialogState: WorkspaceManagementDialogState;
  projects?: Project[];
  onSelectProject?: (project: Project) => void;
  onCloseProject?: (project: Project) => void;
  onAddProject?: () => void;
  onConfirmManage?: (workspace: Workspace) => void;
  onBack?: () => void;
  onCancel?: () => void;
}): Promise<WorkspaceManagementDialog> {
  const dialog = new WorkspaceManagementDialog();
  dialog.dialogState = properties.dialogState;
  dialog.projects = properties.projects ?? [project];
  if (properties.onSelectProject !== undefined) dialog.onSelectProject = properties.onSelectProject;
  if (properties.onCloseProject !== undefined) dialog.onCloseProject = properties.onCloseProject;
  if (properties.onAddProject !== undefined) dialog.onAddProject = properties.onAddProject;
  if (properties.onConfirmManage !== undefined) dialog.onConfirmManage = properties.onConfirmManage;
  if (properties.onBack !== undefined) dialog.onBack = properties.onBack;
  if (properties.onCancel !== undefined) dialog.onCancel = properties.onCancel;
  document.body.append(dialog);
  await settleRenderedDialog(dialog);
  return dialog;
}

async function projectList(dialog: WorkspaceManagementDialog): Promise<ProjectList> {
  const list = required(dialog.shadowRoot?.querySelector<ProjectList>("project-list"), "project list");
  await list.updateComplete;
  return list;
}

function projectRow(list: ProjectList): HTMLElement {
  return required(list.shadowRoot?.querySelector<HTMLElement>(".action-row"), "project row");
}

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${label}`);
  return value;
}
