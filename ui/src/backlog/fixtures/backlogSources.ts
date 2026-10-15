/**
 * Fixtures for the backlog source screens: three registered projects, and Azure DevOps sources in each state the
 * screens show. Names are made up; no fixture names a real board or repository.
 */
import type { BacklogProjectSettings } from "@shared/backlogSettings";
import type { BacklogSourceSettings } from "@shared/backlogSources";
import type { BacklogSettingsCatalog } from "../backlogSettingsApi";

export const projects = [
  { id: "0b6f2c4e-1d1a-4c55-9a0e-0d4c1e7a2b11", name: "storefront", path: "/code/storefront" },
  { id: "6a3e9d20-58c4-4f0f-8b7e-3f1a2c9d4e22", name: "billing-service", path: "/code/billing-service" },
  { id: "c4d1e8f3-2b7a-4e69-a5c0-7e9b1d3f6a33", name: "design-system", path: "/code/design-system" },
];
const [storefront] = projects;
const source = (extra: Partial<BacklogSourceSettings>): BacklogSourceSettings => ({
  id: "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f", provider: "azure-devops", organization: "contoso", project: "Fabrikam Web",
  revision: 4, updatedAt: "2026-10-13T09:00:00.000Z", warnings: [], ...extra,
});
/** A board whose sessions start in a project. */
export const routedSource = source({ destinationProjectId: storefront!.id });
/** A board with no destination: each start asks for a project. */
export const notRoutedSource = source({ id: "7b8c9d0e-1f2a-4b3c-8d4e-5f6a7b8c9d0e", project: "Support Desk", organization: "contoso" });
/** A board whose destination project is no longer registered. */
export const missingDestinationSource = source({ destinationProjectId: "9e8d7c6b-5a49-4382-9170-6f5e4d3c2b1a" });
/** Two sources on one board, kept apart only by Area Path, and the pair that migration left overlapping. */
export const webArea = source({ id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", areaPath: "Fabrikam Web\\Checkout", destinationProjectId: storefront!.id });
export const overlapMessage = "Overlaps contoso / Fabrikam Web (no Area Path). Give both sources Area Paths that do not overlap.";
export const overlapping = [
  source({ destinationProjectId: storefront!.id, warnings: ["Overlaps contoso / Fabrikam Web (Fabrikam Web\\Checkout). Give both sources Area Paths that do not overlap."] }),
  { ...webArea, warnings: [overlapMessage] },
];

const markdownProject: BacklogProjectSettings = { projectId: projects[0]!.id, source: "default", backlog: { providers: ["markdown"] } };
const githubProject: BacklogProjectSettings = { projectId: projects[1]!.id, source: "forgerie", revision: 2, backlog: { providers: ["markdown", "github"], github: { authors: "trusted" } } };
/** A GitHub project that lists trusted authors only, and three review bots whose text still reaches the agent. */
export const trustedBotsProject: BacklogProjectSettings = { projectId: projects[1]!.id, source: "forgerie", revision: 3,
  backlog: { providers: ["markdown", "github"], github: { authors: "trusted", trustedBots: ["coderabbitai[bot]", "sourcery-ai[bot]", "copilot-pull-request-reviewer[bot]"] } } };
/** A project whose repo file still has an Azure DevOps section, which Forgerie no longer reads. */
export const retiredAzureProject: BacklogProjectSettings = { projectId: projects[2]!.id, source: "repo-file", backlog: { providers: ["markdown"] },
  warnings: ["This repository's .forgerie/config.json has an Azure DevOps section. Forgerie now reads Azure boards from Settings → Backlog → Sources."] };

export const catalogWith = (sources: BacklogSourceSettings[]): BacklogSettingsCatalog => ({
  settings: { githubLogin: "octocat", sources, projects: [markdownProject, githubProject, retiredAzureProject] }, projects,
});
