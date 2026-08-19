import type { ProjectService } from "../projects/projectService.js";
import type { Project, WorkspaceListing } from "../types.js";
import type { WorkspaceService } from "./workspaceService.js";

export type WorkspaceContextProjectService = Pick<ProjectService, "requireProject">;
export type WorkspaceContextWorkspaceService = Pick<WorkspaceService, "list">;

export interface WorkspaceContext {
  project: Project;
  workspace: WorkspaceListing;
  root: string;
}

export async function resolveWorkspaceContext(projects: WorkspaceContextProjectService, workspaces: WorkspaceContextWorkspaceService, projectId: string, workspaceId: string): Promise<WorkspaceContext> {
  const project = await projects.requireProject(projectId);
  const workspace = (await workspaces.list(project)).find((candidate) => candidate.id === workspaceId);
  if (!workspace) throw new Error("Workspace not found");
  return { project, workspace, root: workspace.path };
}
