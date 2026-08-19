import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerWorkspaceActivityRoutes } from "./workspaceActivityRoutes.js";

describe("workspace activity routes", () => {
  it("serves the current snapshot under the configured prefix", async () => {
    const app = Fastify({ logger: false });
    registerWorkspaceActivityRoutes(app, {
      snapshot: () => ({ generatedAt: "2026-08-19T00:00:00.000Z", workspaces: [] }),
    }, "/api/machines/local");

    try {
      const response = await app.inject({ method: "GET", url: "/api/machines/local/activity" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ generatedAt: "2026-08-19T00:00:00.000Z", workspaces: [] });
    } finally {
      await app.close();
    }
  });
});
