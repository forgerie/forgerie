import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { AgentDirPromptLibrary } from "./promptLibrary.js";
import { registerPromptLibraryRoutes } from "./promptLibraryRoutes.js";

async function agentDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "forgerie-prompt-routes-"));
}

function errorMessage(body: unknown): string {
  if (typeof body !== "object" || body === null || !("error" in body)) throw new Error("Expected a prompt-library error response");
  const message: unknown = body.error;
  return typeof message === "string" ? message : JSON.stringify(message);
}

describe("prompt library routes", () => {
  it("saves a prompt and returns its name and path", async () => {
    const dir = await agentDir();
    const app = Fastify({ logger: false });
    registerPromptLibraryRoutes(app, new AgentDirPromptLibrary(dir));

    try {
      const response = await app.inject({ method: "POST", url: "/prompts", payload: { name: "tell", body: "Speak plainly." } });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ name: "tell", path: join(dir, "prompts", "tell.md") });
      await expect(readFile(join(dir, "prompts", "tell.md"), "utf8")).resolves.toBe("---\ndescription: Speak plainly.\n---\n\nSpeak plainly.\n");
    } finally {
      await app.close();
    }
  });

  it("answers 409 when the prompt name is already taken", async () => {
    const dir = await agentDir();
    const app = Fastify({ logger: false });
    registerPromptLibraryRoutes(app, new AgentDirPromptLibrary(dir));

    try {
      await app.inject({ method: "POST", url: "/prompts", payload: { name: "tell", body: "First." } });
      const response = await app.inject({ method: "POST", url: "/prompts", payload: { name: "tell", body: "Second." } });

      expect(response.statusCode).toBe(409);
      expect(errorMessage(response.json())).toContain("already exists");
    } finally {
      await app.close();
    }
  });

  it("answers 400 for a refused name, an empty body, and non-string fields", async () => {
    const dir = await agentDir();
    const app = Fastify({ logger: false });
    registerPromptLibraryRoutes(app, new AgentDirPromptLibrary(dir));

    try {
      const badName = await app.inject({ method: "POST", url: "/prompts", payload: { name: "../escape", body: "x" } });
      const emptyBody = await app.inject({ method: "POST", url: "/prompts", payload: { name: "tell", body: "  " } });
      const wrongTypes = await app.inject({ method: "POST", url: "/prompts", payload: { name: 7, body: null } });

      expect([badName.statusCode, emptyBody.statusCode, wrongTypes.statusCode]).toEqual([400, 400, 400]);
      expect(errorMessage(wrongTypes.json())).toContain("required strings");
    } finally {
      await app.close();
    }
  });
});
