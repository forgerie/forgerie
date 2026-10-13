#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 -c npx tsx
// CHILD_RETRY_REAL=1 ./scripts/child-retry-real.ts
// Real parent and child models; a configured provider returns overloaded once, then calls the real model.
// Owns only a temporary profile, workspace and server. Model calls incur costs. No live daemon is opened.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import Fastify from "fastify";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { PiSessionService } from "../src/server/sessions/piSessionService.js";
import { emptyArchiveStore } from "../src/server/sessions/piSessionService.testSupport.js";
import { SessionEventHub } from "../src/server/realtime/sessionEventHub.js";
import { createPiSessionManagerGateway } from "../src/server/sessions/piSessionManagerGateway.js";
import { createDurableChildHost, LiveChildSessionIndex } from "../src/server/sessions/durableChildHost.js";
import { registerDurableChildRoutes } from "../src/server/sessions/durableChildRoutes.js";
import { ChildRetrySchema, type ChildRetry } from "../src/shared/childRetry.js";

if (process.env.CHILD_RETRY_REAL !== "1") throw new Error("Set CHILD_RETRY_REAL=1 to authorize real-model acceptance");
const source: unknown = JSON.parse(await readFile(`${process.env.HOME}/.local/share/forgerie/agent/cliproxyapi.json`, "utf8"));
if (!Check(Type.Object({ baseUrl: Type.String(), apiKey: Type.String() }), source)) throw new Error("The live CLIProxyAPI config is unavailable");
const upstream = source.baseUrl.replace(/\/$/u, "").replace(/\/v1$/u, "") + "/v1";
const root = await mkdtemp(join(tmpdir(), "forgerie-child-retry-real-"));
const agentDir = join(root, "agent"); const cwd = join(root, "workspace");
await mkdir(join(agentDir, "agents"), { recursive: true, mode: 0o700 }); await mkdir(cwd);
process.once("exit", () => { rmSync(join(agentDir, "models.json"), { force: true }); });
const model = process.env.CHILD_RETRY_MODEL ?? "deepseek-v4.1-flash";
let calls = 0; const calledAt: number[] = [];
const definition = { id: model, name: model, reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 8192 };
await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: {
  "retry-parent-acceptance": { baseUrl: upstream, apiKey: source.apiKey, api: "openai-completions", models: [definition] },
} }), { mode: 0o600 });
// Disable Durable's inner retry, so the test exercises Forgerie's reporter backoff.
await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "retry-parent-acceptance", defaultModel: model, defaultThinkingLevel: "off", packages: [], compaction: { enabled: false }, retry: { enabled: false, provider: { maxRetries: 0 } } }));
await writeFile(join(agentDir, "agents", "retry.md"), `---\nname: retry\ntools: read\nmodel: retry-child-acceptance/${model}\n---\nReply with exactly CHILD-RETRY-REAL-ANSWER. Do not call tools or ask questions.\n`);
const models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
const realModel = models.getModel("retry-parent-acceptance", model);
if (realModel === undefined) throw new Error("The real acceptance model is unavailable");
const controlled = fauxProvider({ provider: "retry-child-acceptance", models: [{ id: model }], tokensPerSecond: 100000 });
controlled.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded: child retry acceptance" })]);
models.registerNativeProvider({ ...controlled.provider,
  stream: (_model, request, options) => {
    calls++; calledAt.push(Date.now());
    return calls === 1 ? controlled.provider.streamSimple(controlled.getModel(), request) : models.stream(realModel, request, options);
  },
  streamSimple: (_model, request, options) => {
    calls++; calledAt.push(Date.now());
    return calls === 1 ? controlled.provider.streamSimple(controlled.getModel(), request, options) : models.streamSimple(realModel, request, options);
  },
});
const service = new PiSessionService(new SessionEventHub(), { agentDir, modelRuntime: models, archiveStore: emptyArchiveStore(),
  sessionManager: createPiSessionManagerGateway({ agentDir, env: { HOME: root }, sessionDirEnvKeys: [] }),
  durableChildAgents: createDurableChildHost({ index: new LiveChildSessionIndex(join(root, "live.json")) }),
});
const server = Fastify();
registerDurableChildRoutes(server, service, "/api");
let closing = false;
async function close() {
  if (closing) return; closing = true;
  try { await service.dispose(); await server.close(); }
  finally { await rm(join(agentDir, "models.json"), { force: true }); }
}
process.once("SIGTERM", () => { void close(); }); process.once("SIGINT", () => { void close(); });
try {
  const ref = { id: (await service.start(cwd)).id, cwd };
  await service.prompt(ref, 'Use child_agent once to spawn name retry, agent retry, isolation shared, message "Reply with exactly CHILD-RETRY-REAL-ANSWER". Do not do its task yourself. After spawn reply Waiting. When its report arrives reply Recorded. Do not spawn again.');
  const deadline = Date.now() + 300000;
  let retry: ChildRetry | undefined; let report: string | undefined;
  while (report === undefined) {
    if (closing) throw new Error("Acceptance stopped");
    const response = await server.inject({ url: `/api/sessions/${ref.id}/children?cwd=${encodeURIComponent(cwd)}` });
    assert.equal(response.statusCode, 200, response.body);
    const value: unknown = response.json();
    assert.ok(Check(Type.Array(Type.Object({ name: Type.String(), retry: Type.Optional(ChildRetrySchema) })), value));
    retry ??= value.find((child) => child.name === "retry")?.retry;
    const messages = (await service.messages(ref, { limit: 200 })).messages;
    for (const message of messages) {
      if (typeof message === "object" && message !== null && "role" in message && message.role === "user" && "content" in message && typeof message.content === "string" && message.content.startsWith("[subagent retry")) report = message.content;
    }
    if (Date.now() > deadline) throw new Error(`Timed out: calls=${calls}, retry=${JSON.stringify(retry)}`);
    await sleep(250);
  }
  assert.equal(retry?.attempt, 1); assert.equal(retry.max, 3); assert.match(retry.error, /overloaded/i);
  assert.match(report, /answered.*CHILD-RETRY-REAL-ANSWER/s); assert.equal(calls, 2);
  assert.ok((calledAt[1] ?? 0) - (calledAt[0] ?? 0) >= 30000, "The reporter must wait 30 seconds");
  assert.ok(Math.abs(retry.until - (calledAt[0] ?? 0) - 30000) < 10000);
  console.log(JSON.stringify({ root, model, calls, waitMs: (calledAt[1] ?? 0) - (calledAt[0] ?? 0), retry, report }));
} finally { await close(); }
