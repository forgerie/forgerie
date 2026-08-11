import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { ProjectService } from "../projects/projectService.js";
import { ProjectStore } from "../storage/projectStore.js";
import type { Project, WorkspaceListing } from "../types.js";
import { WorkspaceService } from "../workspaces/workspaceService.js";
import { registerPromptResourceCatalogProxyRoutes, registerPromptResourceRoutes } from "./promptResourceRoutes.js";

const project: Project = { id: "p1", name: "Project", path: "/repo", createdAt: "2026-01-01T00:00:00.000Z" };
const workspace: WorkspaceListing = { id: "w1", projectId: "p1", path: "/repo", label: "main", isMain: true, isGitRepo: true, isGitWorktree: false };

describe("prompt-resource sessiond routes", () => {
  it("serves the internal catalog by canonical cwd", async () => {
    const app = Fastify({ logger: false });
    const seen: string[] = [];
    registerPromptResourceRoutes(app, {
      catalog(cwd) {
        seen.push(cwd);
        return Promise.resolve({ available: true, commands: [], diagnostics: [`cwd:${cwd}`] });
      },
    });

    try {
      const response = await app.inject({ method: "GET", url: "/prompt-resource-catalog?cwd=%2Frepo%2Fchild%2F.." });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ available: true, commands: [], diagnostics: ["cwd:/repo"] });
      expect(seen).toEqual(["/repo"]);
    } finally {
      await app.close();
    }
  });

  it("rejects requests without a cwd before resource loading", async () => {
    const app = Fastify({ logger: false });
    let calls = 0;
    registerPromptResourceRoutes(app, {
      catalog() {
        calls += 1;
        return Promise.resolve({ available: true, commands: [], diagnostics: [] });
      },
    });

    try {
      const response = await app.inject({ method: "GET", url: "/prompt-resource-catalog" });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "cwd query is required" });
      expect(calls).toBe(0);
    } finally {
      await app.close();
    }
  });

  it("resolves a workspace before proxying to sessiond", async () => {
    const requests: { method: string; path: string }[] = [];
    const app = Fastify({ logger: false });
    registerPromptResourceCatalogProxyRoutes(app, inMemoryProjects(project), inMemoryWorkspaces([workspace]), {
      request: (method, path) => {
        requests.push({ method, path });
        return Promise.resolve({ statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ available: true, commands: [], diagnostics: [] }) });
      },
    }, "/api");

    try {
      const response = await app.inject({ method: "GET", url: "/api/projects/p1/workspaces/w1/prompt-resource-catalog" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ available: true, commands: [], diagnostics: [] });
      expect(requests).toEqual([{ method: "GET", path: "/prompt-resource-catalog?cwd=%2Frepo" }]);
    } finally {
      await app.close();
    }
  });

  it("maps sessiond failures to a bounded gateway response", async () => {
    const app = Fastify({ logger: false });
    registerPromptResourceCatalogProxyRoutes(app, inMemoryProjects(project), inMemoryWorkspaces([workspace]), {
      request: () => Promise.reject(new Error("socket unavailable")),
    }, "/api");

    try {
      const response = await app.inject({ method: "GET", url: "/api/projects/p1/workspaces/w1/prompt-resource-catalog" });

      expect(response.statusCode).toBe(502);
      expect(response.json()).toEqual({ error: "Session daemon unavailable" });
    } finally {
      await app.close();
    }
  });

  it("times out when sessiond does not settle the catalog request", async () => {
    vi.useFakeTimers();
    const app = Fastify({ logger: false });
    registerPromptResourceCatalogProxyRoutes(app, inMemoryProjects(project), inMemoryWorkspaces([workspace]), {
      request: () => new Promise(() => undefined),
    }, "/api");

    try {
      const pendingResponse = app.inject({ method: "GET", url: "/api/projects/p1/workspaces/w1/prompt-resource-catalog" });
      await vi.advanceTimersByTimeAsync(15_000);
      const response = await pendingResponse;

      expect(response.statusCode).toBe(504);
      expect(response.json()).toEqual({ error: "Prompt-resource catalog request timed out" });
    } finally {
      vi.useRealTimers();
      await app.close();
    }
  });

  it("rejects caller-supplied cwd targets before sessiond access", async () => {
    const requests: { method: string; path: string }[] = [];
    const app = Fastify({ logger: false });
    registerPromptResourceCatalogProxyRoutes(app, inMemoryProjects(project), inMemoryWorkspaces([workspace]), {
      request: (method, path) => {
        requests.push({ method, path });
        return Promise.resolve({ statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ available: true, commands: [], diagnostics: [] }) });
      },
    }, "/api");

    try {
      const response = await app.inject({ method: "GET", url: "/api/projects/p1/workspaces/w1/prompt-resource-catalog?cwd=%2Fetc" });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "Prompt-resource catalog cwd is resolved from the registered workspace" });
      expect(requests).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("rejects unknown registered destinations before sessiond access", async () => {
    const app = Fastify({ logger: false });
    let calls = 0;
    registerPromptResourceCatalogProxyRoutes(app, inMemoryProjects(project), inMemoryWorkspaces([workspace]), {
      request: () => {
        calls += 1;
        return Promise.resolve({ statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ available: true, commands: [], diagnostics: [] }) });
      },
    }, "/api");

    try {
      const response = await app.inject({ method: "GET", url: "/api/projects/p1/workspaces/missing/prompt-resource-catalog" });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "Workspace not found" });
      expect(calls).toBe(0);
    } finally {
      await app.close();
    }
  });
});

function inMemoryProjects(input: Project): ProjectService {
  return new InMemoryProjectService(input);
}

function inMemoryWorkspaces(input: WorkspaceListing[]): WorkspaceService {
  return new InMemoryWorkspaceService(input);
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
