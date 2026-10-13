import { expect, it } from "vitest";
import { resolveDestination } from "./backlogDestination.js";
import { azureSourcesOverlap } from "./backlogSources.js";
const project = { id: "p", name: "Project", path: "/repo", createdAt: "today" };

it("resolves only explicit destinations and project ownership", () => {
  const source = { kind: "source" as const, sourceId: "s", label: "Board" };
  expect(resolveDestination(source, undefined, [project])).toEqual({ kind: "not-routed", reason: "unset" });
  expect(resolveDestination({ ...source, destinationProjectId: "p" }, undefined, [project])).toEqual({ kind: "routed", projectId: "p", reason: "source-destination" });
  expect(resolveDestination({ ...source, destinationProjectId: "gone" }, undefined, [project])).toEqual({ kind: "not-routed", reason: "missing-project" });
  expect(resolveDestination({ kind: "project", projectId: "p", projectName: "Project", repo: "/repo" }, undefined, [project])).toEqual({ kind: "routed", projectId: "p", reason: "project-owned" });
});
it("compares Azure areas by case-insensitive segments, not prefixes", () => {
  const source = { organization: "Org", project: "Board" };
  for (const [a, b] of [[undefined, "A"], ["A", "a"], ["A", "a\\B"]] as const) expect(azureSourcesOverlap({ ...source, ...(a === undefined ? {} : { areaPath: a }) }, { ...source, areaPath: b })).toBe(true);
  expect(azureSourcesOverlap({ ...source, areaPath: "A\\B" }, { ...source, areaPath: "A\\Bc" })).toBe(false);
  expect(azureSourcesOverlap(source, { ...source, organization: "other" })).toBe(false);
  expect(azureSourcesOverlap(source, { ...source, project: "other" })).toBe(false);
});
