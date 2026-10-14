import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, emptyArchiveStore } from "./piSessionService.testSupport.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import { createDurableChildHost } from "./durableChildHost.js";
import { registerGatedActionRoutes } from "./decisionRoutes.js";
import { GatedActionSchema } from "../../shared/gatedActions.js";
import { Check } from "typebox/value";
import { Type } from "typebox";
const run = promisify(execFile);
let root: string; let cwd: string; let service: PiSessionService; let server: FastifyInstance; let ref: {id: string; cwd: string}; let hub: CapturingSessionEventHub;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "forgerie-gate-routes-")); cwd = join(root, "repo"); await mkdir(cwd); const agentDir = join(root, "agent"); await mkdir(agentDir);
  for (const args of [["init", "-b", "main"], ["config", "user.name", "Test"], ["config", "user.email", "test@example.invalid"]]) await run("git", ["-C", cwd, ...args]);
  await writeFile(join(cwd, "base"), "base"); await run("git", ["-C", cwd, "add", "."]); await run("git", ["-C", cwd, "commit", "-m", "Base"]);
  const bare = join(root, "remote.git"); await run("git", ["init", "--bare", bare]); await run("git", ["-C", cwd, "remote", "add", "origin", bare]);
  await run("git", ["-C", cwd, "push", "origin", "main"]);
  const hook = join(cwd, ".git", "hooks", "pre-push"); await writeFile(hook, '#!/bin/sh\necho run >> "' + join(root, "push-count") + '"\n'); await chmod(hook, 0o700);
  const models = await ModelRuntime.create({authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json")});
  const provider = fauxProvider({tokensPerSecond: 100000}); models.registerNativeProvider(provider.provider); await models.refresh({ allowNetwork: false });
  provider.setResponses(Array.from({length: 100}, () => request => {
    const last = [...request.messages].reverse().find(m => m.role !== "system");
    const content = typeof last?.content === "string" ? last.content : JSON.stringify(last?.content);
    if (content === "Push") return fauxAssistantMessage([fauxToolCall("bash", {command: "git push --force origin main"})], {stopReason: "toolUse"});
    return fauxAssistantMessage("Result received: " + content);
  }));
  hub = new CapturingSessionEventHub(); service = new PiSessionService(hub, {agentDir, modelRuntime: models, archiveStore: emptyArchiveStore(), sessionManager: createPiSessionManagerGateway({agentDir, env: {HOME: root}, sessionDirEnvKeys: []}), durableChildAgents: createDurableChildHost()});
  server = Fastify(); registerGatedActionRoutes(server, service, "/api"); ref = {id: (await service.start(cwd)).id, cwd};
});
afterEach(async () => { await service.dispose(); await server.close(); await rm(root, {recursive: true, force: true}); });
const url = () => `/api/sessions/${ref.id}/gated-actions`;
async function gate() {
  await service.prompt(ref, "Push");
  await vi.waitFor(async () => { expect((await service.status(ref)).waitingOnYou).toBe(1); });
  const response = await server.inject({url: `${url()}?cwd=${encodeURIComponent(cwd)}`}); expect(response.statusCode).toBe(200);
  const records: unknown = response.json(); expect(Check(Type.Array(GatedActionSchema), records)).toBe(true);
  if (!Check(Type.Array(GatedActionSchema), records) || records[0] === undefined) throw new Error("Gate missing"); return records[0];
}
it("runs the exact blocked bash call through HTTP once and publishes the result and wait changes", async () => {
  const record = await gate();
  expect(await readFile(join(root, "push-count"), "utf8").catch(() => "")).toBe("");
  expect(JSON.stringify((await service.messages(ref, {limit: 200})).messages)).toContain('"customType":"forgerie.gated-action"');
  const response = await server.inject({method: "POST", url: `${url()}/${record.id}/approve`, payload: {cwd}});
  expect(response.statusCode).toBe(200); expect(response.json<unknown>()).toMatchObject({state: {kind: "approved"}});
  await vi.waitFor(async () => { expect((await service.gatedActions(ref))[0]?.state.kind).toBe("ran"); });
  await vi.waitFor(async () => { expect((await service.status(ref)).waitingOnYou).toBeUndefined(); });
  await vi.waitFor(async () => { expect(JSON.stringify((await service.messages(ref, {limit: 200})).messages)).toContain(`Gate ${record.id} ran:`); });
  expect(await readFile(join(root, "push-count"), "utf8")).toBe("run\n");
  expect((await server.inject({method: "POST", url: `${url()}/${record.id}/approve`, payload: {cwd}})).statusCode).toBe(409);
  expect(hub.sessionEvents.some(({event}) => JSON.stringify(event).includes("workflow_runs_changed"))).toBe(true);
  expect(await service.decisions(ref)).toMatchObject([{kind: "gated", choice: "approved", by: "user"}]);
});
it("returns 404 for missing gates and 409 for decided gates; refusal never pushes", async () => {
  const record = await gate();
  expect((await server.inject({method: "POST", url: `${url()}/foreign/approve`, payload: {cwd}})).statusCode).toBe(404);
  expect((await server.inject({method: "POST", url: `${url()}/${record.id}/refuse`, payload: {cwd}})).statusCode).toBe(200);
  expect((await server.inject({method: "POST", url: `${url()}/${record.id}/refuse`, payload: {cwd}})).statusCode).toBe(409);
  await vi.waitFor(async () => { expect(JSON.stringify((await service.messages(ref, {limit: 200})).messages)).toContain(`The user refused gate ${record.id}:`); });
  expect(await readFile(join(root, "push-count"), "utf8").catch(() => "")).toBe("");
});
it.each([{}, {cwd: ""}, {cwd: "/repo", extra: true}])("rejects malformed request %j", async payload => {
  expect((await server.inject({method: "POST", url: `${url()}/x/approve`, payload})).statusCode).toBe(400);
});
it("accepts only the cwd query and lists no gates before an action", async () => {
  expect((await server.inject({url: `${url()}?cwd=${encodeURIComponent(cwd)}`})).json()).toEqual([]);
  expect((await server.inject({url: url()})).statusCode).toBe(400);
  expect((await server.inject({url: `${url()}?cwd=${encodeURIComponent(cwd)}&extra=1`})).statusCode).toBe(400);
});
