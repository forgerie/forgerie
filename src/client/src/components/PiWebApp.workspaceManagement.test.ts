// @vitest-environment happy-dom

import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../api";
import { initialAppState, type AppState } from "../appState";
import { PiWebApp } from "./PiWebApp";
import type { WorkspaceManagementDialog } from "./WorkspaceManagementDialog";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("PiWebApp project management", () => {
  it("closes the management dialog before closing a project", () => {
    const app = new PiWebApp();
    const closeProject = vi.fn(() => Promise.resolve());
    Reflect.set(app, "projects", { closeProject });
    Reflect.set(app, "state", {
      ...initialAppState(),
      projects: [project],
      workspaceManagementDialog: { step: "project" },
    } satisfies AppState);
    const container = document.createElement("div");
    document.body.append(container);
    render(app.render(), container);
    const dialog = required(container.querySelector<WorkspaceManagementDialog>("workspace-management-dialog"), "workspace management dialog");

    dialog.onCloseProject?.(project);

    expect(closeProject).toHaveBeenCalledWith(project.id);
    expect(appState(app).workspaceManagementDialog).toBeUndefined();
  });
});

const project: Project = { id: "project", name: "Forgerie", path: "/repo", createdAt: "2026-08-10T00:00:00.000Z" };

function appState(app: PiWebApp): AppState {
  const value: unknown = Reflect.get(app, "state");
  if (!isAppState(value)) throw new Error("Expected PiWebApp state");
  return value;
}

function isAppState(value: unknown): value is AppState {
  return typeof value === "object" && value !== null && "workspaceManagementDialog" in value && "projects" in value;
}

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${label}`);
  return value;
}
