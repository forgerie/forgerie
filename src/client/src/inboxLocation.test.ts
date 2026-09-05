// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createInboxLocationResolver, inboxLocationChip } from "./inboxLocation";
import type { Project, Workspace } from "./api";

function project(id: string, name: string, path: string): Project {
  return { id, name, path, createdAt: "2026-01-01T00:00:00.000Z" };
}

function workspace(projectId: string, path: string, label: string, isMain: boolean): Workspace {
  return { id: `${projectId}:${label}`, projectId, path, label, isMain, isGitRepo: true, isGitWorktree: !isMain, effectiveConfig: {} };
}

describe("createInboxLocationResolver", () => {
  it("prefers a cached workspace's server-provided label and main flag", () => {
    const resolve = createInboxLocationResolver(
      [project("p1", "forgerie", "/code/forgerie")],
      { p1: [workspace("p1", "/code/forgerie/.worktrees/feat/session-inbox", "feat/session-inbox", false)] },
    );

    expect(resolve("/code/forgerie/.worktrees/feat/session-inbox")).toMatchObject({
      projectName: "forgerie",
      workspaceLabel: "feat/session-inbox",
      isMain: false,
    });
  });

  it("names the project for an uncached workspace inside its tree", () => {
    const resolve = createInboxLocationResolver([project("p1", "forgerie", "/code/forgerie")], {});

    expect(resolve("/code/forgerie/.worktrees/feat/session-inbox")).toMatchObject({
      projectId: "p1",
      projectName: "forgerie",
      workspaceLabel: "session-inbox",
      isMain: false,
    });
  });

  it("marks the project root itself as the main workspace", () => {
    const resolve = createInboxLocationResolver([project("p1", "forgerie", "/code/forgerie")], {});

    expect(resolve("/code/forgerie/")).toMatchObject({ workspaceLabel: "forgerie", isMain: true });
  });

  it("does not match a sibling directory that merely shares a prefix", () => {
    const resolve = createInboxLocationResolver([project("p1", "forgerie", "/code/forge")], {});

    expect(resolve("/code/forgerie")).toBeUndefined();
  });

  it("resolves the deepest matching project when projects nest", () => {
    const resolve = createInboxLocationResolver(
      [project("outer", "code", "/code"), project("inner", "forgerie", "/code/forgerie")],
      {},
    );

    expect(resolve("/code/forgerie/src")).toMatchObject({ projectId: "inner" });
  });

  it("returns undefined for a cwd outside every known project", () => {
    const resolve = createInboxLocationResolver([project("p1", "forgerie", "/code/forgerie")], {});

    expect(resolve("/somewhere/else")).toBeUndefined();
  });
});

describe("inboxLocationChip", () => {
  const main = { projectId: "p1", projectName: "forgerie", projectPath: "/code/forgerie", workspaceLabel: "main", isMain: true };
  const branch = { ...main, workspaceLabel: "feat/session-inbox", isMain: false };

  it("names the project, and the branch off main, when the groups do not", () => {
    expect(inboxLocationChip(main, "state")).toEqual({ kind: "project", project: "forgerie" });
    expect(inboxLocationChip(branch, "state")).toEqual({ kind: "project", project: "forgerie", branch: "feat/session-inbox" });
  });

  // Grouped by project, the header names the project; the chip repeating it
  // spent a third of every row on a word the line above already said.
  it("says nothing on a main checkout when the group header names the project", () => {
    expect(inboxLocationChip(main, "project")).toEqual({ kind: "none" });
  });

  it("keeps only the branch on a worktree when the group header names the project", () => {
    expect(inboxLocationChip(branch, "project")).toEqual({ kind: "branch", branch: "feat/session-inbox" });
  });
});
