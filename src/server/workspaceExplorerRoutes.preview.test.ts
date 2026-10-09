import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { DOCUMENT_PREVIEW_SANDBOX } from "../shared/workspaceFiles.js";
import { ProjectService } from "./projects/projectService.js";
import { ProjectStore } from "./storage/projectStore.js";
import type { Project, WorkspaceListing } from "./types.js";
import { registerWorkspaceExplorerRoutes } from "./workspaceExplorerRoutes.js";
import { cleanupTempWorkspaces, createTempWorkspace } from "./workspaces/fileContentService.testSupport.js";
import { WorkspaceService } from "./workspaces/workspaceService.js";

afterEach(async () => {
  await cleanupTempWorkspaces();
});

describe("workspace document preview route", () => {
  it("serves html with the sandbox policy and nested relative subresources without it", async () => {
    const root = await createTempWorkspace();
    await mkdir(join(root, "lessons", "assets"), { recursive: true });
    await writeFile(join(root, "lessons", "0001-intro.html"), "<!doctype html><h1>Intro</h1>");
    await writeFile(join(root, "lessons", "assets", "course.css"), "h1 { margin: 0 }");
    const app = appFor(root);

    try {
      const page = await app.inject({ method: "GET", url: "/api/projects/p1/workspaces/w1/preview/lessons/0001-intro.html" });
      const asset = await app.inject({ method: "GET", url: "/api/projects/p1/workspaces/w1/preview/lessons/assets/course.css" });

      expect(page.statusCode).toBe(200);
      expect(page.headers["content-type"]).toContain("text/html");
      expect(page.headers["content-security-policy"]).toBe(`sandbox ${DOCUMENT_PREVIEW_SANDBOX}`);
      expect(page.headers["x-content-type-options"]).toBe("nosniff");
      expect(page.headers["cache-control"]).toBe("private, no-cache");
      expect(page.body).toBe("<!doctype html><h1>Intro</h1>");

      expect(asset.statusCode).toBe(200);
      expect(asset.headers["content-type"]).toContain("text/css");
      expect(asset.headers["content-security-policy"]).toBeUndefined();
      expect(asset.body).toBe("h1 { margin: 0 }");
    } finally {
      await app.close();
    }
  });

  it("refuses non-document types and unknown workspaces with route errors", async () => {
    const root = await createTempWorkspace();
    await writeFile(join(root, "run.sh"), "#!/bin/sh\n");
    const app = appFor(root);

    try {
      const script = await app.inject({ method: "GET", url: "/api/projects/p1/workspaces/w1/preview/run.sh" });
      const missing = await app.inject({ method: "GET", url: "/api/projects/p1/workspaces/nope/preview/run.html" });

      expect(script.statusCode).toBe(400);
      expect(script.json()).toEqual({ error: "Document preview is not supported for this file type" });
      expect(missing.statusCode).toBe(400);
      expect(missing.json()).toEqual({ error: "Workspace not found" });
    } finally {
      await app.close();
    }
  });
});

describe("workspace file write route", () => {
  it("writes against an expected version and answers a stale one with a 409 conflict", async () => {
    const root = await createTempWorkspace();
    await writeFile(join(root, "notes.md"), "first\n");
    const app = appFor(root);
    const url = (query: string) => `/api/projects/p1/workspaces/w1/file?path=notes.md${query}`;
    const put = (payload: Buffer, query: string) => app.inject({ method: "PUT", url: url(query), payload, headers: { "content-type": "application/octet-stream" } });

    try {
      const read = await app.inject({ method: "GET", url: url("") });
      const opened = read.json<{ version: string }>().version;
      const saved = await put(Buffer.from("second\n"), `&expectedVersion=${opened}`);
      const stale = await put(Buffer.from("third\n"), `&expectedVersion=${opened}`);
      const emptied = await put(Buffer.alloc(0), `&expectedVersion=${saved.json<{ version: string }>().version}`);
      const after = await app.inject({ method: "GET", url: url("") });

      expect(saved.statusCode).toBe(200);
      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toEqual({ error: "notes.md changed after it was read", code: "conflict", version: saved.json<{ version: string }>().version });
      expect(emptied.statusCode).toBe(200);
      expect(after.json()).toMatchObject({ content: "", size: 0, version: emptied.json<{ version: string }>().version });
    } finally {
      await app.close();
    }
  });
});

function appFor(root: string): FastifyInstance {
  const project: Project = { id: "p1", name: "Project", path: root, createdAt: "2026-01-01T00:00:00.000Z" };
  const workspace: WorkspaceListing = { id: "w1", projectId: "p1", path: root, label: "main", isMain: true, isGitRepo: false, isGitWorktree: false };
  const app = Fastify({ logger: false });
  registerWorkspaceExplorerRoutes(app, new InMemoryProjectService(project), new InMemoryWorkspaceService([workspace]), "/api");
  return app;
}

class InMemoryProjectService extends ProjectService {
  constructor(private readonly input: Project) {
    super(new ProjectStore("/dev/null"));
  }

  override requireProject(projectId: string): Promise<Project> {
    return projectId === this.input.id ? Promise.resolve(this.input) : Promise.reject(new Error("Project not found"));
  }
}

class InMemoryWorkspaceService extends WorkspaceService {
  constructor(private readonly input: WorkspaceListing[]) {
    super();
  }

  override list(): Promise<WorkspaceListing[]> {
    return Promise.resolve(this.input);
  }
}
