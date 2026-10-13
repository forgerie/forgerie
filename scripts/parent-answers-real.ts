#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 -c npx tsx
// PARENT_ANSWERS_REAL=1 ./scripts/parent-answers-real.ts
// Owns a temporary profile, workspace and HTTP server. No live daemon is opened. Model calls incur costs.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import Fastify from "fastify";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { PiSessionService } from "../src/server/sessions/piSessionService.js";
import { emptyArchiveStore } from "../src/server/sessions/piSessionService.testSupport.js";
import { SessionEventHub } from "../src/server/realtime/sessionEventHub.js";
import { createPiSessionManagerGateway } from "../src/server/sessions/piSessionManagerGateway.js";
import { createDurableChildHost, LiveChildSessionIndex } from "../src/server/sessions/durableChildHost.js";
import { registerDecisionRoutes } from "../src/server/sessions/decisionRoutes.js";
import { DecisionSchema } from "../src/shared/decisions.js";

if (process.env.PARENT_ANSWERS_REAL !== "1") throw new Error("Set PARENT_ANSWERS_REAL=1 to authorize real-model acceptance");
const source: unknown = JSON.parse(await readFile(`${process.env.HOME}/.local/share/forgerie/agent/cliproxyapi.json`, "utf8"));
if (!Check(Type.Object({ baseUrl: Type.String(), apiKey: Type.String() }), source)) throw new Error("The live CLIProxyAPI config is unavailable");
const upstream = source.baseUrl.replace(/\/$/u, "").replace(/\/v1$/u, "") + "/v1";
const root = await mkdtemp(join(tmpdir(), "forgerie-parent-answers-real-"));
const agentDir = join(root, "agent"); const cwd = join(root, "workspace");
await mkdir(join(agentDir, "agents"), { recursive: true, mode: 0o700 }); await mkdir(cwd);
process.once("exit", () => { rmSync(join(agentDir, "models.json"), { force: true }); });
const model = process.env.PARENT_ANSWERS_MODEL ?? "deepseek-v4.1-flash";
const definition = { id: model, name: model, reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 8192 };
await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: {
  "parent-answers-acceptance": { baseUrl: upstream, apiKey: source.apiKey, api: "openai-completions", models: [definition] },
} }), { mode: 0o600 });
await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "parent-answers-acceptance", defaultModel: model, defaultThinkingLevel: "off", packages: [], compaction: { enabled: false } }));
await writeFile(join(agentDir, "agents", "questioner.md"), `---\nname: questioner\ntools: read\nmodel: parent-answers-acceptance/${model}\n---\nYour first action must be ask_human with the question "Which exact token should I echo?". Ask once. After the answer arrives, reply with exactly the token from that answer. Do not call any other tools.\n`);
const models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
const service = new PiSessionService(new SessionEventHub(), { agentDir, modelRuntime: models, archiveStore: emptyArchiveStore(),
  sessionManager: createPiSessionManagerGateway({ agentDir, env: { HOME: root }, sessionDirEnvKeys: [] }),
  durableChildAgents: createDurableChildHost({ index: new LiveChildSessionIndex(join(root, "live.json")) }),
});
const server = Fastify(); registerDecisionRoutes(server, service, "/api");
let closing = false;
async function close() {
  if (closing) return; closing = true;
  try { await service.dispose(); await server.close(); }
  finally { await rm(root, { recursive: true, force: true }); }
}
process.once("SIGTERM", () => { void close(); }); process.once("SIGINT", () => { void close(); });
try {
  const ref = { id: (await service.start(cwd)).id, cwd };
  const startedAt = Date.now();
  await service.prompt(ref, 'The task specifies the token PARENT-ANSWERS-REAL-TOKEN. Spawn one child named questioner with agent questioner, isolation shared, message "Ask your parent which exact token to echo, then echo it." Do not put the token in the child task. After spawn, end your turn. When the child asks, answer using child_agent action answer with its name, questionId, answer from this task, and reason "The task specifies the token". Do not call ask_user. Do not escalate this answerable question. When the completion report arrives reply Recorded. Do not spawn again.');
  const deadline = Date.now() + 300000;
  for (;;) {
    if (closing) throw new Error("Acceptance stopped");
    const response = await server.inject({ url: `/api/sessions/${ref.id}/decisions?cwd=${encodeURIComponent(cwd)}` });
    assert.equal(response.statusCode, 200, response.body);
    const records: unknown = response.json(); assert.ok(Check(Type.Array(DecisionSchema), records));
    const children = await service.durableChildren(ref);
    const child = children.find((child) => child.name === "questioner");
    const messages = (await service.messages(ref, { limit: 200 })).messages;
    const transcript = JSON.stringify(messages);
    assert.ok(!transcript.includes('"customType":"forgerie.child-question"'), "No user question card");
    assert.equal((await service.status(ref)).waitingOnYou, undefined, "No user action is needed");
    if (records.length > 0 && child !== undefined && !child.busy && transcript.includes("[subagent questioner answered")) {
      assert.equal(records.length, 1); assert.equal(records[0]?.kind, "child-answer"); assert.equal(records[0]?.by, "parent");
      assert.equal(records[0]?.choice, "PARENT-ANSWERS-REAL-TOKEN"); assert.equal(records[0]?.flagged, false);
      const childTranscript = JSON.stringify(await service.durableChildMessages(ref, child.conversationId));
      assert.ok(childTranscript.includes("The parent answered: PARENT-ANSWERS-REAL-TOKEN"));
      assert.ok(transcript.includes("[child questioner asks q:"));
      console.log(JSON.stringify({ model, elapsedMs: Date.now() - startedAt, child: child.conversationId, decision: records[0], noUserAction: true }));
      break;
    }
    if (Date.now() > deadline) throw new Error(`Timed out: ${JSON.stringify({records, children, messages})}`);
    await sleep(250);
  }
} finally { await close(); }
