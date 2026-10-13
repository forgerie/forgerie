import type { BacklogClaim, BacklogItem } from "./backlog.js";
export interface BacklogItemKey { repo?: string; provider: string; itemId: string }
/** The sole builder of backlog identity. Source and destination never affect Azure identity. */
export function claimKeyOf(value: BacklogClaim | BacklogItem | BacklogItemKey): string {
  const id = "itemId" in value ? value.itemId : value.id;
  if (value.provider === "azure-devops") return JSON.stringify([value.provider, id]);
  if (value.repo === undefined) throw new Error("Project-owned backlog identity requires a repository");
  return JSON.stringify([value.repo, value.provider, id]);
}
