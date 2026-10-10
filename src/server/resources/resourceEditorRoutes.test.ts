import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Check } from "typebox/value";
import { ResourceEditorDeleteSchema, ResourceEditorErrorSchema, ResourceEditorFileSchema, ResourceEditorInventorySchema, ResourceEditorSaveSchema, RESOURCE_EDITOR_MAX_BYTES, type ResourceEditorInventory } from "../../shared/resourceEditor.js";
import { ResourceEditorService } from "./resourceEditorService.js";
import { ResourceEditorError } from "./resourceEditorFiles.js";
import { registerResourceEditorRoutes } from "./resourceEditorRoutes.js";
import { registerSessionProxyRoutes } from "../sessiond/sessionProxyRoutes.js";

let root: string;
let profile: string;
let project: string;
const servers: FastifyInstance[] = [];
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected a listed resource.");
  return value;
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "forgerie-resource-routes-")); profile = join(root, "profile"); project = join(root, "project");
  vi.stubEnv("HOME", root);
  await mkdir(join(profile, "prompts"), { recursive: true }); await mkdir(project);
  await writeFile(join(profile, "settings.json"), "{}");
  await writeFile(join(profile, "prompts/example.md"), "Before\n");
  await writeFile(join(project, "AGENTS.md"), "Project context.\n");
});
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.close())); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });
function daemon() {
  const app = Fastify(); servers.push(app);
  registerResourceEditorRoutes(app, new ResourceEditorService({ agentDir: profile, bundledPaths: [], session: (id) => {
    if (id !== "known") throw new ResourceEditorError("not-found", "Session not found.");
    return Promise.resolve({ cwd: project });
  } }));
  return app;
}

describe("resource editor HTTP contract", () => {
  it("serves inventory, exact text and a conditional save with shared response schemas", async () => {
    const app = daemon();
    const listed = await app.inject({ method: "GET", url: "/resources" });
    expect(listed.statusCode).toBe(200); expect(Check(ResourceEditorInventorySchema, listed.json())).toBe(true);
    const entry = required(listed.json<ResourceEditorInventory>().resources[0]);
    const read = await app.inject({ method: "GET", url: `/resources/${entry.id}` });
    expect(read.statusCode).toBe(200); expect(Check(ResourceEditorFileSchema, read.json())).toBe(true);
    const saved = await app.inject({ method: "PUT", url: `/resources/${entry.id}`, payload: { text: "After\n", baseRevision: read.json<{ revision: string }>().revision } });
    expect(saved.statusCode).toBe(200); expect(Check(ResourceEditorSaveSchema, saved.json())).toBe(true);
    expect(await readFile(join(profile, "prompts/example.md"), "utf8")).toBe("After\n");
    const stale = await app.inject({ method: "PUT", url: `/resources/${entry.id}`, payload: { text: "Overwrite\n", baseRevision: read.json<{ revision: string }>().revision } });
    expect(stale.statusCode).toBe(409); expect(Check(ResourceEditorErrorSchema, stale.json())).toBe(true);
    expect(stale.json()).toMatchObject({ error: { kind: "conflict", savedToDisk: false } });
  });

  it("revision-checks prompt deletion through both browser prefixes and session scopes", async () => {
    const upstream = daemon(); const browser = Fastify(); servers.push(browser);
    const forward = { request: async (method: string, path: string, body?: unknown) => {
      if (method !== "GET" && method !== "DELETE") throw new Error("Unexpected proxy method.");
      const response = await upstream.inject({ method, url: path, ...(body === undefined ? {} : { payload: JSON.stringify(body), headers: { "content-type": "application/json" } }) });
      return { statusCode: response.statusCode, headers: { "content-type": "application/json" }, body: response.body };
    }, connectWebSocket: () => { throw new Error("Unused."); } };
    registerSessionProxyRoutes(browser, forward); registerSessionProxyRoutes(browser, forward, "/api/machines/local");
    for (const prefix of ["/api", "/api/machines/local"]) {
      for (const scope of ["/resources", "/sessions/known/resources"]) {
        await writeFile(join(profile, "prompts/example.md"), "Workflow.\n");
        const inventory = await browser.inject({ method: "GET", url: `${prefix}${scope}` });
        const entry = required(inventory.json<ResourceEditorInventory>().resources.find((resource) => resource.kind === "prompt"));
        const url = `${prefix}${scope}/${entry.id}`;
        const read = await browser.inject({ method: "GET", url }); const baseRevision = read.json<{ revision: string }>().revision;
        for (const payload of [{}, { baseRevision: "bad" }, { baseRevision, path: "/tmp/other.md" }, { baseRevision, cwd: "/tmp" }]) {
          const rejected = await browser.inject({ method: "DELETE", url, payload });
          expect(rejected.statusCode).toBe(400); expect(Check(ResourceEditorErrorSchema, rejected.json())).toBe(true);
        }
        await writeFile(join(profile, "prompts/example.md"), "External change.\n");
        expect((await browser.inject({ method: "DELETE", url, payload: { baseRevision } })).statusCode).toBe(409);
        expect(await readFile(join(profile, "prompts/example.md"), "utf8")).toBe("External change.\n");
        const current = await browser.inject({ method: "GET", url });
        const deleted = await browser.inject({ method: "DELETE", url, payload: { baseRevision: current.json<{ revision: string }>().revision } });
        expect(deleted.statusCode).toBe(200); expect(Check(ResourceEditorDeleteSchema, deleted.json())).toBe(true);
        expect(deleted.json()).toMatchObject({ resourceId: entry.id, effect: { kind: "file-only" }, reload: "explicit-session-reload" });
        expect((await browser.inject({ method: "GET", url })).statusCode).toBe(404);
      }
    }
  });

  it("accepts a full 1 MiB file after JSON escaping and rejects extra content bytes", async () => {
    const app = daemon(); const browser = Fastify(); servers.push(browser);
    registerSessionProxyRoutes(browser, { request: async (method, path, body) => {
      if (method !== "GET" && method !== "PUT") throw new Error("Unexpected proxy method.");
      const response = await app.inject({ method, url: path, ...(body === undefined ? {} : { payload: JSON.stringify(body), headers: { "content-type": "application/json" } }) });
      return { statusCode: response.statusCode, headers: { "content-type": "application/json" }, body: response.body };
    }, connectWebSocket: () => { throw new Error("Unused."); } });
    const listed = await browser.inject({ method: "GET", url: "/api/resources" });
    const id = required(listed.json<ResourceEditorInventory>().resources[0]).id;
    const current = await browser.inject({ method: "GET", url: `/api/resources/${id}` });
    const text = "\t".repeat(RESOURCE_EDITOR_MAX_BYTES);
    const saved = await browser.inject({ method: "PUT", url: `/api/resources/${id}`, payload: { text, baseRevision: current.json<{ revision: string }>().revision } });
    expect(saved.statusCode).toBe(200);
    expect(await readFile(join(profile, "prompts/example.md"), "utf8")).toBe(text);
    const oversized = await browser.inject({ method: "PUT", url: `/api/resources/${id}`, payload: { text: `${text}x`, baseRevision: saved.json<{ file: { revision: string } }>().file.revision } });
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json()).toMatchObject({ error: { kind: "over-limit", savedToDisk: false } });
  });

  it("resolves a session's cwd on the server and rejects paths, extra fields and unknown sessions", async () => {
    const app = daemon();
    const session = await app.inject({ method: "GET", url: "/sessions/known/resources" });
    expect(session.statusCode).toBe(200); expect(session.json()).toMatchObject({ scope: { kind: "session", cwd: project } });
    expect(session.json<ResourceEditorInventory>().resources.some((entry) => entry.path === join(project, "AGENTS.md"))).toBe(true);
    const unknown = await app.inject({ method: "GET", url: "/sessions/unknown/resources" });
    expect(unknown.statusCode).toBe(404); expect(Check(ResourceEditorErrorSchema, unknown.json())).toBe(true);
    expect((await app.inject({ method: "GET", url: "/sessions/known/resources?cwd=/tmp" })).statusCode).toBe(400);
    const id = required(session.json<ResourceEditorInventory>().resources[0]).id;
    for (const payload of [{ text: "No revision" }, { text: "Wrong revision", baseRevision: "bad" }, { text: "Path injection", baseRevision: "a".repeat(64), path: "/tmp/other.md" }, { text: "Cwd injection", baseRevision: "a".repeat(64), cwd: "/tmp" }]) {
      const response = await app.inject({ method: "PUT", url: `/sessions/known/resources/${id}`, payload });
      expect(response.statusCode).toBe(400); expect(Check(ResourceEditorErrorSchema, response.json())).toBe(true);
    }
    const forged = await app.inject({ method: "GET", url: `/resources/${"a".repeat(64)}` });
    expect(forged.statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/resources/not-an-id" })).statusCode).toBe(400);
  });

  it("proxies Settings and session endpoints through local and machine-local browser prefixes", async () => {
    const upstream = daemon(); const browser = Fastify(); servers.push(browser);
    const forward = { request: async (method: string, path: string, body?: unknown) => {
      if (method !== "GET" && method !== "PUT") throw new Error("Unexpected proxy method.");
      const response = await upstream.inject({ method, url: path, ...(body === undefined ? {} : { payload: JSON.stringify(body), headers: { "content-type": "application/json" } }) });
      return { statusCode: response.statusCode, headers: { "content-type": "application/json" }, body: response.body };
    }, connectWebSocket: () => { throw new Error("Unused in resource requests."); } };
    registerSessionProxyRoutes(browser, forward);
    registerSessionProxyRoutes(browser, forward, "/api/machines/local");
    for (const prefix of ["/api", "/api/machines/local"]) {
      for (const path of ["/resources", "/sessions/known/resources"]) {
        const inventory = await browser.inject({ method: "GET", url: `${prefix}${path}` });
        expect(inventory.statusCode).toBe(200);
        const entry = required(inventory.json<ResourceEditorInventory>().resources.find((resource) => resource.kind === "prompt"));
        const read = await browser.inject({ method: "GET", url: `${prefix}${path}/${entry.id}` });
        expect(read.statusCode).toBe(200);
        const saved = await browser.inject({ method: "PUT", url: `${prefix}${path}/${entry.id}`, payload: { text: `Saved from ${prefix}${path}\n`, baseRevision: read.json<{ revision: string }>().revision } });
        expect(saved.statusCode).toBe(200);
      }
    }
  });
});
