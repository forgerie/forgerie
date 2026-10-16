import type { SavedWorkflow } from "./workflowsModel";

/**
 * Where a saved workflow file lives. The server reads `<project>/.pi/prompts/` and then the profile's `prompts/`
 * (src/server/resources/workflowLibrary.ts), so a path through `.pi/prompts/` is the project's.
 */
export function workflowSource(path: string): "project" | "profile" {
  return /(?:^|[\\/])\.pi[\\/]prompts[\\/]/u.test(path) ? "project" : "profile";
}

/** One stage of a route as the picker draws it: a block per agent it starts, a ring where the reader decides. */
export interface RouteStage { name: string; agents: number; stop: boolean }

export function routeOf(workflow: SavedWorkflow): RouteStage[] {
  return (workflow.definition.stages ?? []).map((stage) => ({ name: stage.name, agents: stage.workers?.length ?? 0, stop: stage.stop !== undefined }));
}

/** "4 stages, 4 agents", "Prose only". */
export function routeSummary(route: readonly RouteStage[]): string {
  if (route.length === 0) return "Prose only, no stages";
  const agents = route.reduce((sum, stage) => sum + stage.agents, 0);
  const stops = route.filter((stage) => stage.stop).length;
  return [`${String(route.length)} ${route.length === 1 ? "stage" : "stages"}`, ...(agents > 0 ? [`${String(agents)} ${agents === 1 ? "agent" : "agents"}`] : []),
    ...(stops > 0 ? [`you decide at ${String(stops)}`] : [])].join(", ");
}

/** The filter matches a workflow's name, its description, or a stage's name, ignoring case. */
export function matchesWorkflow(workflow: SavedWorkflow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return [workflow.name, workflow.description ?? "", ...routeOf(workflow).map((stage) => stage.name)].some((text) => text.toLowerCase().includes(needle));
}
