import { join } from "node:path";
import type { Project } from "../../shared/apiTypes.js";
import type { BacklogProjectSettings } from "../../shared/backlogSettings.js";
import { loadProjectPiWebConfig } from "../workspaces/projectPiWebConfig.js";
import type { BacklogSettingsStore } from "./backlogSettingsStore.js";
import { assertContainedFile } from "./markdownBacklog.js";
/** One whole section wins. A stored override must not read or depend on the repo file. */
export async function resolveBacklogConfig(project: Pick<Project, "id">, repo: string, settings?: BacklogSettingsStore): Promise<BacklogProjectSettings> {
  const file = await settings?.read();
  const entry = file !== undefined && Object.hasOwn(file.projects, project.id) ? file.projects[project.id] : undefined;
  if (entry !== undefined) return { projectId: project.id, source: "forgerie", backlog: entry.backlog, revision: entry.revision };
  await assertContainedFile(repo, join(repo, ".forgerie/config.json"));
  const loaded = await loadProjectPiWebConfig(repo).catch((error: unknown) => {
    // JSON parser messages quote input. A malformed repo file must not reflect its contents.
    if (error instanceof SyntaxError) throw new Error("Invalid JSON in .forgerie/config.json.");
    throw error;
  });
  if (loaded.backlogError !== undefined) throw new Error(loaded.backlogError);
  return { projectId: project.id, source: loaded.config.backlog === undefined ? "default" : "repo-file", backlog: loaded.config.backlog ?? { providers: ["markdown"] } };
}
