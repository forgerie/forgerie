import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerGitRoutes } from "./gitRoutes";
import type { WorkspaceContextProjectService, WorkspaceContextWorkspaceService } from "./workspaces/workspaceContext";

const exec = promisify(execFile);
const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Git routes", () => {
  it("returns repository status and working differences", async () => {
    const root = await gitRepository();
    await writeFile(join(root, "file.txt"), "changed\n");
    const app = Fastify();
    registerGitRoutes(app, projects(), workspaces(root));

    try {
      const status = await app.inject({ method: "GET", url: "/api/projects/project-1/workspaces/workspace-1/git/status" });
      expect(status.statusCode).toBe(200);
      expect(status.json()).toMatchObject({ isGitRepo: true, branch: "main" });

      const diff = await app.inject({ method: "GET", url: "/api/projects/project-1/workspaces/workspace-1/git/diff?path=file.txt&staged=false" });
      expect(diff.statusCode).toBe(200);
      const diffBody: unknown = diff.json();
      if (!isRecord(diffBody)) throw new Error("Expected Git difference response");
      expect(diffBody["path"]).toBe("file.txt");
      expect(diffBody["staged"]).toBe(false);
      expect(diffBody["diff"]).toEqual(expect.stringContaining("+changed"));
    } finally {
      await app.close();
    }
  });

  it("maps workspace and unsafe-path failures to 400 responses", async () => {
    const root = await gitRepository();
    const app = Fastify();
    registerGitRoutes(app, projects(), workspaces(root));

    try {
      const missing = await app.inject({ method: "GET", url: "/api/projects/project-1/workspaces/missing/git/status" });
      expect(missing.statusCode).toBe(400);
      expect(missing.json()).toEqual({ error: "Workspace not found" });

      const unsafe = await app.inject({ method: "GET", url: "/api/projects/project-1/workspaces/workspace-1/git/diff?path=../secret" });
      expect(unsafe.statusCode).toBe(400);
      const unsafeBody: unknown = unsafe.json();
      if (!isRecord(unsafeBody)) throw new Error("Expected Git error response");
      expect(unsafeBody["error"]).toEqual(expect.stringContaining("Path traversal is not allowed"));
    } finally {
      await app.close();
    }
  });
});

async function gitRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "forgerie-git-routes-"));
  cleanup.push(root);
  await exec("git", ["init", "-b", "main"], { cwd: root });
  await exec("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await exec("git", ["config", "user.name", "Test"], { cwd: root });
  await writeFile(join(root, "file.txt"), "initial\n");
  await exec("git", ["add", "file.txt"], { cwd: root });
  await exec("git", ["commit", "-m", "initial"], { cwd: root });
  return root;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function projects(): WorkspaceContextProjectService {
  return {
    requireProject: () => Promise.resolve({ id: "project-1", name: "Project", path: "/repo", createdAt: "now" }),
  };
}

function workspaces(root: string): WorkspaceContextWorkspaceService {
  return {
    list: () => Promise.resolve([{ id: "workspace-1", projectId: "project-1", path: root, label: "main", isMain: true, isGitRepo: true, isGitWorktree: false }]),
  };
}
