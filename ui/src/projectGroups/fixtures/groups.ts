import type { GroupCatalog, ProjectContext } from "../projectGroupApi";
export const catalog: GroupCatalog = {
  groups: [{ id: "kori", name: "KORI", projectIds: ["core", "plugins"], revision: 1, createdAt: "2026-10-09", updatedAt: "2026-10-09" }],
  projects: [{ id: "core", name: "korri", path: "/code/korri" }, { id: "plugins", name: "korri-plugins", path: "/code/korri-plugins" }],
};
/** Enough projects that the list offers a search field. */
export const manyProjects = [...catalog.projects, ...["coach", "forgerie", "irori", "caliper", "portal-source", "pyxis", "groceries", "maps", "proseql"]
  .map((name) => ({ id: name, name, path: `/home/reader/code/sandbox/${name}` }))];
export const related: ProjectContext = { ...catalog, home: catalog.projects[0], related: [{ id: "secondary", relatedSession: { id: "chat", cwd: "/code/korri", projectId: "plugins" }, owned: true,
  repo: "/code/korri-plugins", path: "/code/korri-plugins/.worktree/s-12345678", branch: "s-12345678", defaultBranch: "main",
  state: { kind: "active" }, setup: { phase: "done", log: "" }, cleanup: { kind: "pending" }, ahead: 2, behind: 0, dirtyFiles: 3,
}] };
/** Two groups that share a project, and two projects in no group, listed out of name order. */
export const filterCatalog: GroupCatalog = {
  groups: [
    { id: "kori", name: "KORI", projectIds: ["core", "plugins"], revision: 1, createdAt: "2026-10-09", updatedAt: "2026-10-09" },
    { id: "tools", name: "Tools", projectIds: ["plugins", "caliper"], revision: 1, createdAt: "2026-10-09", updatedAt: "2026-10-09" },
  ],
  projects: [...catalog.projects, { id: "caliper", name: "caliper", path: "/code/caliper" },
    { id: "pyxis", name: "pyxis", path: "/code/pyxis" }, { id: "irori", name: "Irori", path: "/code/irori" }],
};
