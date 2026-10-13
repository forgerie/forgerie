import { join } from "node:path";
import type { Project } from "../../shared/apiTypes.js";
import type { BacklogProjectSettings } from "../../shared/backlogSettings.js";
import { loadProjectPiWebConfig } from "../workspaces/projectPiWebConfig.js";
import type { BacklogSettingsStore } from "./backlogSettingsStore.js";
import { assertContainedFile } from "./markdownBacklog.js";
/** One whole section wins. A stored override must not read or depend on the repo file. */
export async function resolveBacklogConfig(project: Pick<Project, "id">, repo: string | (() => Promise<string>), settings?: Pick<BacklogSettingsStore, "read">): Promise<BacklogProjectSettings> {
  const file = await settings?.read();
  const entry = file !== undefined && Object.hasOwn(file.projects, project.id) ? file.projects[project.id] : undefined;
  if (entry !== undefined) return { projectId: project.id, source: "forgerie", backlog: entry.backlog, revision: entry.revision };
  // Lazy discovery lets Settings show stored overrides even for inaccessible project folders.
  const root = typeof repo === "string" ? repo : await repo();
  await assertContainedFile(root, join(root, ".forgerie/config.json"));
  const loaded = await loadProjectPiWebConfig(root).catch((error: unknown) => {
    // JSON parser messages quote input. A malformed repo file must not reflect its contents.
    if (error instanceof SyntaxError) throw new Error("Invalid JSON in .forgerie/config.json.");
    throw error;
  });
  if (loaded.backlogError !== undefined) throw new Error(loaded.backlogError);
  return { projectId: project.id, source: loaded.config.backlog === undefined ? "default" : "repo-file", backlog: loaded.config.backlog ?? { providers: ["markdown"] } };
}
