import { join } from "node:path";
import type { Project } from "../../shared/apiTypes.js";
import type { BacklogProjectSettings } from "../../shared/backlogSettings.js";
import { loadProjectPiWebConfig } from "../workspaces/projectPiWebConfig.js";
import { projectOwnedBacklog } from "../../shared/backlog.js";
import type { BacklogSettingsStore } from "./backlogSettingsStore.js";
import { assertContainedFile } from "./markdownBacklog.js";
export const RETIRED_REPO_AZURE_WARNING = "This repository's .forgerie/config.json has an Azure DevOps section. Forgerie now reads Azure boards from Settings → Backlog → Sources.";
/** One whole section wins. Repo retirement notes do not affect stored configuration. */
export async function resolveBacklogConfig(project: Pick<Project, "id">, repo: string | (() => Promise<string>), settings?: Pick<BacklogSettingsStore, "read">): Promise<BacklogProjectSettings> {
  const file = await settings?.read();
  const entry = file !== undefined && Object.hasOwn(file.projects, project.id) ? file.projects[project.id] : undefined;
  if (entry !== undefined) {
    let retired = false;
    try {
      const root = typeof repo === "string" ? repo : await repo();
      await assertContainedFile(root, join(root, ".forgerie/config.json"));
      retired = (await loadProjectPiWebConfig(root, { retireAzure: true })).retiredBacklogAzure === true;
    } catch { /* This informational note must not make a stored override depend on an inaccessible or broken repo file. */ }
    return { projectId: project.id, source: "forgerie", backlog: projectOwnedBacklog(entry.backlog), revision: entry.revision, ...(retired ? { warnings: [RETIRED_REPO_AZURE_WARNING] } : {}) };
  }
  // Lazy discovery lets Settings show stored overrides even for inaccessible project folders.
  const root = typeof repo === "string" ? repo : await repo();
  await assertContainedFile(root, join(root, ".forgerie/config.json"));
  const loaded = await loadProjectPiWebConfig(root, { retireAzure: true }).catch((error: unknown) => {
    // JSON parser messages quote input. A malformed repo file must not reflect its contents.
    if (error instanceof SyntaxError) throw new Error("Invalid JSON in .forgerie/config.json.");
    throw error;
  });
  if (loaded.backlogError !== undefined) throw new Error(loaded.backlogError);
  const backlog = loaded.config.backlog;
  const retired = loaded.retiredBacklogAzure === true;
  return { projectId: project.id, source: backlog === undefined ? "default" : "repo-file", backlog: projectOwnedBacklog(backlog ?? { providers: ["markdown"] }), ...(retired ? { warnings: [RETIRED_REPO_AZURE_WARNING] } : {}) };
}
