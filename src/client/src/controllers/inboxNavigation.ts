/**
 * Pure helper: navigate to an inbox session row.
 *
 * Encapsulates the guarded, multi-step workspace-resolution logic so it can
 * be tested without mounting PiWebApp. The composition root wires the deps
 * from its controller instances; the helper is stateless.
 *
 * Precedence:
 *   1. Token already stale at entry → "discarded".
 *   2. Same workspace → `selectSession` directly → "selected".
 *   3. Known workspace in any loaded project → `selectWorkspace` with target
 *      sessionId → "workspace-switch".
 *   4. Workspace belongs to a different loaded project → `selectProject` with
 *      target workspaceId + sessionId → "project-switch".
 *   5a. cwd not in cached workspaces → lazily call `loadProjectWorkspaces` for
 *      each project whose workspaces are not yet cached, checking the token
 *      after every await. If a workspace is found, falls back to step 3/4.
 *   5b. After all projects are checked and no workspace matches → "unavailable".
 */

import type { Project, SessionInfo, Workspace } from "../api";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type InboxNavigationResult =
  | "selected"
  | "workspace-switch"
  | "project-switch"
  | "unavailable"
  | "discarded";

/** Injectable boundary for the navigation helper. */
export interface InboxNavigationDeps {
  /** Path of the currently selected workspace, or undefined if none. */
  getSelectedWorkspacePath: () => string | undefined;
  /** Id of the currently selected project, or undefined if none. */
  getSelectedProjectId: () => string | undefined;
  /** All workspaces known to the client across all loaded projects. */
  allWorkspaces: () => readonly Workspace[];
  /** All loaded projects. */
  allProjects: () => readonly Project[];
  /**
   * Optional: lazily load and cache workspaces for a project whose workspaces
   * are not yet in the local cache. Uses a non-teardown refresh (e.g.
   * WorkspaceController.refreshProjectWorkspaces) so it never clears the
   * selection. When omitted, unknown cwds immediately resolve to "unavailable".
   */
  loadProjectWorkspaces?: (project: Project) => Promise<Workspace[]>;
  selectSession: (session: SessionInfo) => Promise<void>;
  selectWorkspace: (
    workspace: Workspace,
    opts?: { sessionId?: string; isCurrent?: () => boolean },
  ) => Promise<void>;
  selectProject: (
    project: Project,
    opts?: { workspaceId?: string; sessionId?: string; isCurrent?: () => boolean },
  ) => Promise<void>;
}

export interface InboxNavigationToken {
  /** The token value captured when this navigation was initiated. */
  token: number;
  /** Returns true when this navigation is still the latest one. */
  isCurrentToken: () => boolean;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Navigate to an inbox session, routing through the existing controller cascade.
 *
 * Guards:
 * - Token check at entry: stale at arrival → "discarded" immediately.
 * - Token check after each async step: stale after workspace load → caller's
 *   guard (isCurrentToken) prevents the result from being applied to UI state.
 *
 * Never calls selectWorkspace or selectProject when workspace is unavailable.
 */
export async function navigateToInboxSession(
  session: SessionInfo,
  deps: InboxNavigationDeps,
  token: InboxNavigationToken,
): Promise<InboxNavigationResult> {
  // Fast-path: token already stale before we start.
  if (!token.isCurrentToken()) return "discarded";

  const selectedWorkspacePath = deps.getSelectedWorkspacePath();
  const selectedProjectId = deps.getSelectedProjectId();

  // 1. Same workspace: select directly.
  if (selectedWorkspacePath !== undefined && session.cwd === selectedWorkspacePath) {
    await deps.selectSession(session);
    if (!token.isCurrentToken()) return "discarded";
    return "selected";
  }

  // Resolve target workspace from all known workspaces.
  let targetWorkspace = deps.allWorkspaces().find((ws) => ws.path === session.cwd);

  if (targetWorkspace === undefined && deps.loadProjectWorkspaces !== undefined) {
    // 5a. Lazily load workspaces for projects that are not yet cached.
    const loadProjectWorkspaces = deps.loadProjectWorkspaces;
    const cachedProjectIds = new Set(deps.allWorkspaces().map((ws) => ws.projectId));

    for (const project of deps.allProjects()) {
      if (cachedProjectIds.has(project.id)) continue; // Already loaded.
      if (!token.isCurrentToken()) return "discarded";

      await loadProjectWorkspaces(project);
      if (!token.isCurrentToken()) return "discarded";

      // Re-check the now-expanded workspace cache.
      targetWorkspace = deps.allWorkspaces().find((ws) => ws.path === session.cwd);
      if (targetWorkspace !== undefined) break;
    }
  }

  if (targetWorkspace === undefined) {
    // 5b. Unknown cwd — confirmed deleted/missing after exhaustive check.
    return "unavailable";
  }

  // 3. Known workspace in any loaded project.
  if (targetWorkspace.projectId === selectedProjectId) {
    // Same project, different workspace.
    await deps.selectWorkspace(targetWorkspace, { sessionId: session.id, isCurrent: token.isCurrentToken });
    if (!token.isCurrentToken()) return "discarded";
    return "workspace-switch";
  }

  // 4. Different project.
  const targetProject = deps.allProjects().find((p) => p.id === targetWorkspace.projectId);
  if (targetProject === undefined) {
    // Project not loaded — treat as unavailable for now.
    return "unavailable";
  }

  await deps.selectProject(targetProject, {
    workspaceId: targetWorkspace.id,
    sessionId: session.id,
    isCurrent: token.isCurrentToken,
  });
  if (!token.isCurrentToken()) return "discarded";
  return "project-switch";
}
