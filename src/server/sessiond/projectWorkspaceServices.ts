import type { SessionRef } from "../../shared/apiTypes.js";
import { ProjectCatalogHome } from "../projects/projectCatalogHome.js";
import { ProjectWorkspaces } from "../projects/projectWorkspaces.js";
import type { ProjectGroups } from "../projects/projectGroups.js";
import type { ProjectService } from "../projects/projectService.js";
import { ProjectScopedSpawnTargetResolver } from "../sessions/spawnTargetResolver.js";
import { GitWorktreeDiscovery } from "../workspaces/gitWorktreeDiscovery.js";
import { RegisteredProjectWorkspaceCwds } from "../workspaces/projectWorkspaceCwds.js";
import type { SessionWorktrees } from "../workspaces/sessionWorktrees.js";
import { WorkspaceService } from "../workspaces/workspaceService.js";

const PROJECT_CATALOG_CACHE_MS = 10_000;

interface Dependencies {
  projects: Pick<ProjectService, "list" | "requireProject">;
  groups: Pick<ProjectGroups, "list">;
  worktrees: SessionWorktrees;
  agentDir: string;
  writable(ref: SessionRef): Promise<boolean>;
}

/** Compose separate display and authorization discovery at sessiond's trust boundary. */
export function createProjectWorkspaceServices(deps: Dependencies) {
  const discovery = new GitWorktreeDiscovery(undefined, { cacheMs: PROJECT_CATALOG_CACHE_MS });
  const workspaceDeps = { projects: deps.projects, workspaces: new WorkspaceService() };
  const catalogWorkspaces = new WorkspaceService(discovery);
  return {
    projectWorkspaces: new RegisteredProjectWorkspaceCwds(workspaceDeps),
    spawnTargets: new ProjectScopedSpawnTargetResolver(workspaceDeps),
    relatedWork: new ProjectWorkspaces({ ...deps, ...workspaceDeps, catalogWorkspaces, catalogHome: new ProjectCatalogHome(catalogWorkspaces) }),
    invalidateCatalog: () => { discovery.invalidate(); },
  };
}
