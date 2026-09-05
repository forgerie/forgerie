/**
 * Resolve a session's `cwd` to the inbox row's location metadata.
 *
 * The inbox is machine-global, but workspace listings are lazy: only the
 * selected project's workspaces are cached. Without a fallback, most rows would
 * fall back to their raw absolute cwd, which reintroduces exactly the
 * path-shaped hierarchy the inbox demotes.
 *
 * Registered projects are always known machine-wide, so a cwd inside a project
 * tree can name its project without listing workspaces. The workspace segment
 * is then the cwd's own last path segment — which is what worktree layouts
 * (`<project>/.worktrees/<...>/<branch-ish>`) already encode.
 *
 * Cached workspaces stay authoritative: their server-provided label and
 * `isMain` flag win over anything derived here.
 */

import type { Project, Workspace } from "./api";
import type { SessionBoardLocation } from "./sessionBoard";
import { normalizeSessionPath } from "./sessionPaths";

export interface InboxLocation extends SessionBoardLocation {
  readonly workspaceLabel: string;
  readonly isMain: boolean;
}

export type InboxLocationResolver = (cwd: string) => InboxLocation | undefined;

/** How the board's rows are grouped; the chip says only what the group header does not. */
export type InboxGrouping = "state" | "project";

/**
 * What a row's location chip says.
 *
 * `none` is a real answer: the row draws no chip and the board's location
 * column closes up on that row, so the title takes the width.
 */
export type InboxLocationChip =
  | { readonly kind: "none" }
  | { readonly kind: "branch"; readonly branch: string }
  | { readonly kind: "project"; readonly project: string; readonly branch?: string };

/**
 * The chip never repeats the group header (intrinsic design: never duplicate
 * what the container already shows). Grouped by state, the header says
 * nothing about where the session is, so the chip names the project and, off
 * main, the branch. Grouped by project, the header already names the project,
 * so a main checkout says nothing and a worktree says only its branch.
 */
export function inboxLocationChip(location: InboxLocation, grouping: InboxGrouping): InboxLocationChip {
  if (grouping === "project") {
    return location.isMain ? { kind: "none" } : { kind: "branch", branch: location.workspaceLabel };
  }
  return location.isMain
    ? { kind: "project", project: location.projectName }
    : { kind: "project", project: location.projectName, branch: location.workspaceLabel };
}

/**
 * Build a memoized resolver over the currently known projects and cached
 * workspaces. Cheap to rebuild per render: the memo exists so repeated rows in
 * one frame (and repeated frames over a stable topology) do not re-scan.
 */
export function createInboxLocationResolver(
  projects: readonly Project[],
  workspacesByProjectId: Readonly<Record<string, readonly Workspace[]>>,
): InboxLocationResolver {
  const byWorkspacePath = new Map<string, InboxLocation>();
  for (const project of projects) {
    for (const workspace of workspacesByProjectId[project.id] ?? []) {
      byWorkspacePath.set(normalizeSessionPath(workspace.path), {
        projectId: project.id,
        projectName: project.name,
        projectPath: project.path,
        workspaceLabel: workspace.label,
        isMain: workspace.isMain,
      });
    }
  }

  // Longest project path first: a nested project must win over its ancestor.
  const projectsByDepth = [...projects].sort(
    (a, b) => normalizeSessionPath(b.path).length - normalizeSessionPath(a.path).length,
  );

  const memo = new Map<string, InboxLocation | undefined>();
  return (cwd: string): InboxLocation | undefined => {
    const normalized = normalizeSessionPath(cwd);
    if (memo.has(normalized)) return memo.get(normalized);
    const resolved = byWorkspacePath.get(normalized) ?? deriveFromProjects(normalized, projectsByDepth);
    memo.set(normalized, resolved);
    return resolved;
  };
}

function deriveFromProjects(cwd: string, projectsByDepth: readonly Project[]): InboxLocation | undefined {
  for (const project of projectsByDepth) {
    const projectPath = normalizeSessionPath(project.path);
    if (!containsPath(projectPath, cwd)) continue;
    const isMain = projectPath === cwd;
    return {
      projectId: project.id,
      projectName: project.name,
      projectPath: project.path,
      workspaceLabel: lastPathSegment(isMain ? projectPath : cwd),
      isMain,
    };
  }
  return undefined;
}

/** Whether `cwd` is `projectPath` itself or lives beneath it, on a segment boundary. */
function containsPath(projectPath: string, cwd: string): boolean {
  if (projectPath === "" || cwd === projectPath) return cwd === projectPath;
  if (!cwd.startsWith(projectPath)) return false;
  const next = cwd.charAt(projectPath.length);
  return next === "/" || next === "\\";
}

function lastPathSegment(path: string): string {
  const segments = path.split(/[/\\]/u).filter((segment) => segment !== "");
  return segments[segments.length - 1] ?? path;
}
