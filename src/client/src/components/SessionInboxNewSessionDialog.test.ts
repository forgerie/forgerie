// @vitest-environment happy-dom

/**
 * Tests for SessionInboxNewSessionDialog (U7).
 *
 * Covers:
 *   - project step: list rendering, project selection, cancel
 *   - workspace step: list rendering, Start session, Manage, Back, loading, error, empty
 *   - manage mode: correct primary action, no startSession
 *   - lazy loading: loading indicator shown while workspaces fetch
 *   - cancel: no side effects at project or workspace step
 *   - failure: error shown when workspace load fails
 *   - touch controls: action buttons ≥44px
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project, Workspace } from "../api";
import type { NewSessionDialogState } from "../appState";
import { SessionInboxNewSessionDialog } from "./SessionInboxNewSessionDialog";
import { settleRenderedDialog } from "./modalSurfaceTestSupport";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkProject(id: string, name: string, path = `/repos/${id}`): Project {
  return { id, name, path, createdAt: "2026-08-07T00:00:00.000Z" };
}

function mkWorkspace(id: string, projectId: string, path = `/repos/${id}`, label = "main"): Workspace {
  return {
    id,
    projectId,
    path,
    label,
    isMain: label === "main",
    isGitRepo: true,
    isGitWorktree: label !== "main",
    effectiveConfig: {},
  };
}

async function mountDialog(props: {
  dialogState?: NewSessionDialogState;
  projects?: Project[];
  onSelectProject?: (project: Project) => void;
  onConfirmStart?: (workspace: Workspace) => void;
  onConfirmManage?: (workspace: Workspace) => void;
  onBack?: () => void;
  onCancel?: () => void;
}): Promise<SessionInboxNewSessionDialog> {
  const dialog = new SessionInboxNewSessionDialog();
  if (props.dialogState !== undefined) dialog.dialogState = props.dialogState;
  if (props.projects !== undefined) dialog.projects = props.projects;
  if (props.onSelectProject !== undefined) dialog.onSelectProject = props.onSelectProject;
  if (props.onConfirmStart !== undefined) dialog.onConfirmStart = props.onConfirmStart;
  if (props.onConfirmManage !== undefined) dialog.onConfirmManage = props.onConfirmManage;
  if (props.onBack !== undefined) dialog.onBack = props.onBack;
  if (props.onCancel !== undefined) dialog.onCancel = props.onCancel;
  document.body.append(dialog);
  await settleRenderedDialog(dialog);
  return dialog;
}

function sr(dialog: SessionInboxNewSessionDialog): ShadowRoot {
  const root = dialog.shadowRoot;
  if (root === null) throw new Error("No shadow root");
  return root;
}

function click(el: Element | null | undefined): void {
  if (el instanceof HTMLElement) el.click();
}

// ---------------------------------------------------------------------------
// Not rendered when dialogState is undefined
// ---------------------------------------------------------------------------

describe("closed state", () => {
  it("renders nothing when dialogState is undefined", async () => {
    const dialog = new SessionInboxNewSessionDialog();
    dialog.projects = [];
    document.body.append(dialog);
    await dialog.updateComplete;

    const root = dialog.shadowRoot;
    // No modal-surface when closed.
    expect(root?.querySelector("modal-surface")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Project step — start mode
// ---------------------------------------------------------------------------

describe("project step (start mode)", () => {
  it("shows the dialog title 'Start a session'", async () => {
    const dialog = await mountDialog({
      dialogState: { step: "project", mode: "start" },
      projects: [mkProject("p1", "Repo Alpha")],
    });

    const header = sr(dialog).querySelector("[data-dialog-title]");
    expect((header?.textContent ?? "").trim()).toBe("Start a session");
  });

  it("renders one button per project", async () => {
    const dialog = await mountDialog({
      dialogState: { step: "project", mode: "start" },
      projects: [mkProject("p1", "Alpha"), mkProject("p2", "Beta")],
    });

    const projectBtns = sr(dialog).querySelectorAll("[data-project-id]");
    expect(projectBtns).toHaveLength(2);
    const ids = Array.from(projectBtns).map((b) => b.getAttribute("data-project-id"));
    expect(ids).toContain("p1");
    expect(ids).toContain("p2");
  });

  it("clicking a project fires onSelectProject with that project", async () => {
    const selected: Project[] = [];
    const dialog = await mountDialog({
      dialogState: { step: "project", mode: "start" },
      projects: [mkProject("p1", "Alpha"), mkProject("p2", "Beta")],
      onSelectProject: (p) => { selected.push(p); },
    });

    click(sr(dialog).querySelector("[data-project-id='p2']"));
    await dialog.updateComplete;

    expect(selected).toHaveLength(1);
    expect(selected[0]?.id).toBe("p2");
  });

  it("shows empty message when there are no projects", async () => {
    const dialog = await mountDialog({
      dialogState: { step: "project", mode: "start" },
      projects: [],
    });

    const empty = sr(dialog).querySelector("[data-empty-projects]");
    expect(empty).not.toBeNull();
  });

  it("cancel button fires onCancel", async () => {
    let cancelled = false;
    const dialog = await mountDialog({
      dialogState: { step: "project", mode: "start" },
      projects: [mkProject("p1", "Alpha")],
      onCancel: () => { cancelled = true; },
    });

    click(sr(dialog).querySelector("[data-action='cancel']"));
    await dialog.updateComplete;

    expect(cancelled).toBe(true);
  });

  it("cancel via Escape fires onCancel", async () => {
    let cancelled = false;
    const dialog = await mountDialog({
      dialogState: { step: "project", mode: "start" },
      projects: [mkProject("p1", "Alpha")],
      onCancel: () => { cancelled = true; },
    });

    const surface = sr(dialog).querySelector("modal-surface");
    if (surface === null) throw new Error("No modal-surface");
    surface.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, composed: true }));
    await dialog.updateComplete;

    expect(cancelled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Project step — manage mode
// ---------------------------------------------------------------------------

describe("project step (manage mode)", () => {
  it("shows the dialog title 'Manage workspace'", async () => {
    const dialog = await mountDialog({
      dialogState: { step: "project", mode: "manage" },
      projects: [mkProject("p1", "Repo")],
    });

    const header = sr(dialog).querySelector("[data-dialog-title]");
    expect((header?.textContent ?? "").trim()).toBe("Manage workspace");
  });
});

// ---------------------------------------------------------------------------
// Workspace step — start mode
// ---------------------------------------------------------------------------

describe("workspace step (start mode)", () => {
  const project = mkProject("p1", "Alpha");

  it("shows all workspaces as buttons", async () => {
    const ws1 = mkWorkspace("ws1", "p1", "/repos/p1", "main");
    const ws2 = mkWorkspace("ws2", "p1", "/repos/p1-feat", "feat/inbox");
    const dialog = await mountDialog({
      dialogState: { step: "workspace", project, mode: "start", workspaces: [ws1, ws2], loading: false, error: undefined },
      projects: [project],
    });

    const wsBtns = sr(dialog).querySelectorAll("[data-workspace-id]");
    expect(wsBtns).toHaveLength(2);
    const ids = Array.from(wsBtns).map((b) => b.getAttribute("data-workspace-id"));
    expect(ids).toContain("ws1");
    expect(ids).toContain("ws2");
  });

  it("clicking a workspace fires onConfirmStart with that workspace in start mode", async () => {
    const confirmed: Workspace[] = [];
    const ws = mkWorkspace("ws1", "p1", "/repos/p1");
    const dialog = await mountDialog({
      dialogState: { step: "workspace", project, mode: "start", workspaces: [ws], loading: false, error: undefined },
      projects: [project],
      onConfirmStart: (w) => { confirmed.push(w); },
    });

    click(sr(dialog).querySelector("[data-workspace-id='ws1']"));
    await dialog.updateComplete;

    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]?.id).toBe("ws1");
  });

  it("does NOT fire onConfirmManage when confirming in start mode", async () => {
    const manageCalled = vi.fn<() => void>();
    const ws = mkWorkspace("ws1", "p1", "/repos/p1");
    const dialog = await mountDialog({
      dialogState: { step: "workspace", project, mode: "start", workspaces: [ws], loading: false, error: undefined },
      projects: [project],
      onConfirmStart: () => undefined,
      onConfirmManage: manageCalled,
    });

    click(sr(dialog).querySelector("[data-workspace-id='ws1']"));
    await dialog.updateComplete;

    expect(manageCalled).not.toHaveBeenCalled();
  });

  it("Back button fires onBack", async () => {
    let backCalled = false;
    const ws = mkWorkspace("ws1", "p1", "/repos/p1");
    const dialog = await mountDialog({
      dialogState: { step: "workspace", project, mode: "start", workspaces: [ws], loading: false, error: undefined },
      projects: [project],
      onBack: () => { backCalled = true; },
    });

    click(sr(dialog).querySelector("[data-action='back']"));
    await dialog.updateComplete;

    expect(backCalled).toBe(true);
  });

  it("cancel button fires onCancel on workspace step", async () => {
    let cancelled = false;
    const ws = mkWorkspace("ws1", "p1", "/repos/p1");
    const dialog = await mountDialog({
      dialogState: { step: "workspace", project, mode: "start", workspaces: [ws], loading: false, error: undefined },
      projects: [project],
      onCancel: () => { cancelled = true; },
    });

    click(sr(dialog).querySelector("[data-action='cancel']"));
    await dialog.updateComplete;

    expect(cancelled).toBe(true);
  });

  it("shows loading indicator when workspaces are being fetched", async () => {
    const dialog = await mountDialog({
      dialogState: { step: "workspace", project, mode: "start", workspaces: [], loading: true, error: undefined },
      projects: [project],
    });

    const loading = sr(dialog).querySelector("[data-state='workspace-loading']");
    expect(loading).not.toBeNull();
  });

  it("does not show workspace buttons while loading", async () => {
    const dialog = await mountDialog({
      dialogState: { step: "workspace", project, mode: "start", workspaces: [], loading: true, error: undefined },
      projects: [project],
    });

    const wsBtns = sr(dialog).querySelectorAll("[data-workspace-id]");
    expect(wsBtns).toHaveLength(0);
  });

  it("shows error message when workspace load fails", async () => {
    const dialog = await mountDialog({
      dialogState: { step: "workspace", project, mode: "start", workspaces: [], loading: false, error: "Network error" },
      projects: [project],
    });

    const errEl = sr(dialog).querySelector("[data-state='workspace-error']");
    expect(errEl).not.toBeNull();
    expect(errEl?.textContent).toContain("Network error");
  });

  it("shows empty state when workspace list is empty (not loading, no error)", async () => {
    const dialog = await mountDialog({
      dialogState: { step: "workspace", project, mode: "start", workspaces: [], loading: false, error: undefined },
      projects: [project],
    });

    const empty = sr(dialog).querySelector("[data-empty-workspaces]");
    expect(empty).not.toBeNull();
  });

  it("empty workspace step: Start session cannot be triggered (no workspace buttons)", async () => {
    const startCalled = vi.fn<() => void>();
    const dialog = await mountDialog({
      dialogState: { step: "workspace", project, mode: "start", workspaces: [], loading: false, error: undefined },
      projects: [project],
      onConfirmStart: startCalled,
    });

    // No workspace buttons to click.
    const wsBtns = sr(dialog).querySelectorAll("[data-workspace-id]");
    expect(wsBtns).toHaveLength(0);
    expect(startCalled).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Workspace step — manage mode
// ---------------------------------------------------------------------------

describe("workspace step (manage mode)", () => {
  const project = mkProject("p1", "Alpha");

  it("clicking a workspace fires onConfirmManage with that workspace in manage mode", async () => {
    const confirmed: Workspace[] = [];
    const ws = mkWorkspace("ws1", "p1", "/repos/p1");
    const dialog = await mountDialog({
      dialogState: { step: "workspace", project, mode: "manage", workspaces: [ws], loading: false, error: undefined },
      projects: [project],
      onConfirmManage: (w) => { confirmed.push(w); },
    });

    click(sr(dialog).querySelector("[data-workspace-id='ws1']"));
    await dialog.updateComplete;

    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]?.id).toBe("ws1");
  });

  it("does NOT fire onConfirmStart when confirming in manage mode", async () => {
    const startCalled = vi.fn<() => void>();
    const ws = mkWorkspace("ws1", "p1", "/repos/p1");
    const dialog = await mountDialog({
      dialogState: { step: "workspace", project, mode: "manage", workspaces: [ws], loading: false, error: undefined },
      projects: [project],
      onConfirmStart: startCalled,
      onConfirmManage: () => undefined,
    });

    click(sr(dialog).querySelector("[data-workspace-id='ws1']"));
    await dialog.updateComplete;

    expect(startCalled).not.toHaveBeenCalled();
  });

  it("shows 'Manage' as the action label not 'Start session'", async () => {
    const ws = mkWorkspace("ws1", "p1", "/repos/p1");
    const dialog = await mountDialog({
      dialogState: { step: "workspace", project, mode: "manage", workspaces: [ws], loading: false, error: undefined },
      projects: [project],
    });

    const wsBtn = sr(dialog).querySelector("[data-workspace-id='ws1']");
    expect(wsBtn?.textContent).not.toContain("Start session");
    expect(wsBtn?.textContent).toContain("Manage");
  });
});

// ---------------------------------------------------------------------------
// Cancel: no selection changes (verify callbacks are independent)
// ---------------------------------------------------------------------------

describe("cancel leaves no side effects", () => {
  it("onCancel on project step does not call onSelectProject or onConfirmStart", async () => {
    const selectProjectCalled = vi.fn<() => void>();
    const confirmStartCalled = vi.fn<() => void>();
    const cancelCalled = vi.fn<() => void>();

    const dialog = await mountDialog({
      dialogState: { step: "project", mode: "start" },
      projects: [mkProject("p1", "Alpha")],
      onSelectProject: selectProjectCalled,
      onConfirmStart: confirmStartCalled,
      onCancel: cancelCalled,
    });

    click(sr(dialog).querySelector("[data-action='cancel']"));
    await dialog.updateComplete;

    expect(cancelCalled).toHaveBeenCalledOnce();
    expect(selectProjectCalled).not.toHaveBeenCalled();
    expect(confirmStartCalled).not.toHaveBeenCalled();
  });

  it("onCancel on workspace step does not call onConfirmStart or onConfirmManage", async () => {
    const project = mkProject("p1", "Alpha");
    const ws = mkWorkspace("ws1", "p1", "/repos/p1");
    const confirmStartCalled = vi.fn<() => void>();
    const confirmManageCalled = vi.fn<() => void>();
    const cancelCalled = vi.fn<() => void>();

    const dialog = await mountDialog({
      dialogState: { step: "workspace", project, mode: "start", workspaces: [ws], loading: false, error: undefined },
      projects: [project],
      onConfirmStart: confirmStartCalled,
      onConfirmManage: confirmManageCalled,
      onCancel: cancelCalled,
    });

    click(sr(dialog).querySelector("[data-action='cancel']"));
    await dialog.updateComplete;

    expect(cancelCalled).toHaveBeenCalledOnce();
    expect(confirmStartCalled).not.toHaveBeenCalled();
    expect(confirmManageCalled).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Lazy loading: dialogState drives what the UI shows
// ---------------------------------------------------------------------------

describe("lazy loading (dialog state is the source of truth)", () => {
  it("transitions from loading to populated workspaces when dialogState updates", async () => {
    const project = mkProject("p1", "Alpha");
    const ws = mkWorkspace("ws1", "p1", "/repos/p1");

    // Start with loading=true, no workspaces
    const dialog = await mountDialog({
      dialogState: { step: "workspace", project, mode: "start", workspaces: [], loading: true, error: undefined },
      projects: [project],
    });

    expect(sr(dialog).querySelector("[data-state='workspace-loading']")).not.toBeNull();
    expect(sr(dialog).querySelectorAll("[data-workspace-id]")).toHaveLength(0);

    // Simulate load completing: parent updates dialogState
    dialog.dialogState = { step: "workspace", project, mode: "start", workspaces: [ws], loading: false, error: undefined };
    await dialog.updateComplete;

    expect(sr(dialog).querySelector("[data-state='workspace-loading']")).toBeNull();
    expect(sr(dialog).querySelectorAll("[data-workspace-id]")).toHaveLength(1);
  });

  it("transitions from loading to error when workspace load fails", async () => {
    const project = mkProject("p1", "Alpha");

    const dialog = await mountDialog({
      dialogState: { step: "workspace", project, mode: "start", workspaces: [], loading: true, error: undefined },
      projects: [project],
    });

    dialog.dialogState = { step: "workspace", project, mode: "start", workspaces: [], loading: false, error: "Connection refused" };
    await dialog.updateComplete;

    const errEl = sr(dialog).querySelector("[data-state='workspace-error']");
    expect(errEl?.textContent).toContain("Connection refused");
  });
});

// ---------------------------------------------------------------------------
// Touch controls ≥ 44px (via data-action attribute contract)
// ---------------------------------------------------------------------------

describe("touch control size contract", () => {
  it("project buttons have data-project-id so CSS can apply ≥44px min-height", async () => {
    const dialog = await mountDialog({
      dialogState: { step: "project", mode: "start" },
      projects: [mkProject("p1", "Alpha")],
    });

    const btn = sr(dialog).querySelector("[data-project-id='p1']");
    expect(btn).not.toBeNull();
  });

  it("workspace buttons have data-workspace-id so CSS can apply ≥44px min-height", async () => {
    const project = mkProject("p1", "Alpha");
    const ws = mkWorkspace("ws1", "p1", "/repos/p1");
    const dialog = await mountDialog({
      dialogState: { step: "workspace", project, mode: "start", workspaces: [ws], loading: false, error: undefined },
      projects: [project],
    });

    const btn = sr(dialog).querySelector("[data-workspace-id='ws1']");
    expect(btn).not.toBeNull();
  });

  it("cancel button has data-action='cancel' so CSS can apply ≥44px min-height", async () => {
    const dialog = await mountDialog({
      dialogState: { step: "project", mode: "start" },
      projects: [mkProject("p1", "Alpha")],
    });

    const cancelBtn = sr(dialog).querySelector("[data-action='cancel']");
    expect(cancelBtn).not.toBeNull();
  });

  it("back button has data-action='back' so CSS can apply ≥44px min-height", async () => {
    const project = mkProject("p1", "Alpha");
    const ws = mkWorkspace("ws1", "p1", "/repos/p1");
    const dialog = await mountDialog({
      dialogState: { step: "workspace", project, mode: "start", workspaces: [ws], loading: false, error: undefined },
      projects: [project],
    });

    const backBtn = sr(dialog).querySelector("[data-action='back']");
    expect(backBtn).not.toBeNull();
  });
});

afterEach(() => {
  document.body.replaceChildren();
});
