// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project, Workspace } from "../api";
import type { WorkspaceManagementDialogState } from "../appState";
import { WorkspaceManagementDialog } from "./WorkspaceManagementDialog";
import { settleRenderedDialog } from "./modalSurfaceTestSupport";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("WorkspaceManagementDialog workspace management", () => {
  it("renders no session-start mode and opens the selected workspace for management", async () => {
    const onConfirmManage = vi.fn();
    const dialog = await mount({
      dialogState: { step: "workspace", project, workspaces: [workspace], loading: false, error: undefined },
      onConfirmManage,
    });

    const root = required(dialog.shadowRoot, "shadow root");
    expect(root.textContent).toContain("Manage workspace");
    expect(root.textContent).not.toContain("Start session");
    required(root.querySelector<HTMLButtonElement>("[data-workspace-id='workspace']"), "workspace button").click();
    expect(onConfirmManage).toHaveBeenCalledWith(workspace);
  });

  it("preserves project selection, loading, error, back, and cancel contracts", async () => {
    const onSelectProject = vi.fn();
    const onCancel = vi.fn();
    const dialog = await mount({ dialogState: { step: "project" }, onSelectProject, onCancel });
    const root = required(dialog.shadowRoot, "shadow root");

    required(root.querySelector<HTMLButtonElement>("[data-project-id='project']"), "project button").click();
    required(root.querySelector<HTMLButtonElement>("[data-action='cancel']"), "cancel button").click();
    expect(onSelectProject).toHaveBeenCalledWith(project);
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
  onSelectProject?: (project: Project) => void;
  onConfirmManage?: (workspace: Workspace) => void;
  onBack?: () => void;
  onCancel?: () => void;
}): Promise<WorkspaceManagementDialog> {
  const dialog = new WorkspaceManagementDialog();
  dialog.dialogState = properties.dialogState;
  dialog.projects = [project];
  if (properties.onSelectProject !== undefined) dialog.onSelectProject = properties.onSelectProject;
  if (properties.onConfirmManage !== undefined) dialog.onConfirmManage = properties.onConfirmManage;
  if (properties.onBack !== undefined) dialog.onBack = properties.onBack;
  if (properties.onCancel !== undefined) dialog.onCancel = properties.onCancel;
  document.body.append(dialog);
  await settleRenderedDialog(dialog);
  return dialog;
}

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${label}`);
  return value;
}
