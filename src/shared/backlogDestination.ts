import type { Project } from "./apiTypes.js";
import type { BacklogItem, BacklogItemOwner, Destination } from "./backlog.js";
/** Resolver input includes settings; the wire owner stays an identity, not a second settings record. */
export type BacklogOwner = Extract<BacklogItemOwner, { kind: "project" }> | (Extract<BacklogItemOwner, { kind: "source" }> & { destinationProjectId?: string });
export function resolveDestination(owner: BacklogOwner, _item: BacklogItem | undefined, projects: readonly Project[]): Destination {
  if (owner.kind === "project") return { kind: "routed", projectId: owner.projectId, reason: "project-owned" };
  if (owner.destinationProjectId === undefined) return { kind: "not-routed", reason: "unset" };
  if (!projects.some((project) => project.id === owner.destinationProjectId)) return { kind: "not-routed", reason: "missing-project" };
  return { kind: "routed", projectId: owner.destinationProjectId, reason: "source-destination" };
}
