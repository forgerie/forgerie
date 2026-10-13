import type { BacklogProjectSettings } from "@shared/backlogSettings";
export const backlogSettingsOrigin = (source: BacklogProjectSettings["source"]) => source === "forgerie" ? "Set in Forgerie" : source === "repo-file" ? "From the repo file" : "Default: Markdown";
