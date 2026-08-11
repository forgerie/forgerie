import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerPromptResourceRoutes } from "./promptResourceRoutes.js";

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
});
