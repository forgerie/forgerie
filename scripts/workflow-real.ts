#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 -c npx tsx
// Opt-in acceptance. Owns only a temporary profile, workspace, and loopback server.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { PiSessionService } from "../src/server/sessions/piSessionService.js";
import { emptyArchiveStore } from "../src/server/sessions/piSessionService.testSupport.js";
import { SessionEventHub } from "../src/server/realtime/sessionEventHub.js";
import { createPiSessionManagerGateway } from "../src/server/sessions/piSessionManagerGateway.js";
import { createDurableChildHost, LiveChildSessionIndex } from "../src/server/sessions/durableChildHost.js";
import { ChildRunStore } from "../src/server/sessions/childRunStore.js";
import { AgentDirPromptLibrary } from "../src/server/resources/promptLibrary.js";
import { registerWorkflowRoutes } from "../src/server/sessions/workflowRoutes.js";
import { registerSessionRoutes } from "../src/server/sessions/sessionRoutes.js";
import { registerDurableChildRoutes } from "../src/server/sessions/durableChildRoutes.js";
import { registerPromptLibraryRoutes } from "../src/server/resources/promptLibraryRoutes.js";
import { registerChildRunRoutes } from "../src/server/sessions/childRunRoutes.js";
import { WorkflowRunSchema } from "../src/shared/workflowRuns.js";

if (process.env.WORKFLOW_REAL !== "1") throw new Error("Set WORKFLOW_REAL=1 to authorize real-model acceptance");
const source: unknown = JSON.parse(await readFile(`${process.env.HOME}/.local/share/forgerie/agent/cliproxyapi.json`, "utf8"));
if (!Check(Type.Object({ baseUrl: Type.String(), apiKey: Type.String() }), source)) throw new Error("The live CLIProxyAPI config is unavailable");
const root = await mkdtemp(join(tmpdir(), "forgerie-workflow-real-"));
const agentDir = join(root, "agent");
const cwd = join(root, "workspace");
await mkdir(agentDir, { mode: 0o700 }); await mkdir(cwd);
process.once("exit", () => { rmSync(join(agentDir, "models.json"), { force: true }); });
const model = process.env.WORKFLOW_MODEL ?? "deepseek-v4.1-flash";
await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { "workflow-acceptance": {
  baseUrl: source.baseUrl.replace(/\/$/u, "").replace(/\/v1$/u, "") + "/v1", apiKey: source.apiKey, api: "openai-completions",
  models: [{ id: model, name: "Workflow acceptance", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 8192 }],
} } }), { mode: 0o600 });
await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "workflow-acceptance", defaultModel: model, defaultThinkingLevel: "off", packages: [], compaction: { enabled: false } }));
await mkdir(join(agentDir, "agents"));
await writeFile(join(agentDir, "agents", "acceptance.md"), "---\nname: acceptance\ndescription: Writes exactly the requested acceptance file.\ntools: write\n---\nOnly write the requested file with the exact requested content. Do not inspect other directories. Reply with the marker you wrote.\n");
const models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
const records = new ChildRunStore(join(root, "child-runs.json"));
const hub = new SessionEventHub();
const service = new PiSessionService(hub, { agentDir, modelRuntime: models, archiveStore: emptyArchiveStore(),
  sessionManager: createPiSessionManagerGateway({ agentDir, env: { HOME: root }, sessionDirEnvKeys: [] }),
  durableChildAgents: createDurableChildHost({ runRecords: records, index: new LiveChildSessionIndex(join(root, "live.json")) }),
});
const server = Fastify();
await server.register(websocket);
registerWorkflowRoutes(server, service, "/api"); registerSessionRoutes(server, service, hub, "/api");
registerDurableChildRoutes(server, service, "/api"); registerPromptLibraryRoutes(server, new AgentDirPromptLibrary(agentDir), "/api");
registerChildRunRoutes(server, records, "/api");
const ref = { id: (await service.start(cwd)).id, cwd };
let closing = false;
async function close() {
  if (closing) return; closing = true;
  await service.dispose(); await server.close(); await records.stop();
  await rm(join(agentDir, "models.json"), { force: true });
}
process.once("SIGTERM", () => { void close(); }); process.once("SIGINT", () => { void close(); });
try {
  const body = `---\ndescription: Real workflow acceptance\nworkflow:\n  version: 1\n  inputs:\n    filename:\n      type: string\n    marker:\n      type: string\n---\nUse child_agent to spawn exactly one child, agent acceptance, shared isolation. Give it a unique name for this run. Its only task is to write the filename input containing exactly the marker input. The parent must not write files. After the child's report, call workflow_finish with this run's ID, outcome completed, and result equal to the marker input. Then reply with only Recorded. Do not call end_turn before workflow_finish.\n`;
  assert.equal((await server.inject({ method: "POST", url: "/api/prompts", payload: { name: "acceptance", body } })).statusCode, 200);
  const launches = [];
  for (const [name, filename, marker] of [["acceptance", "baseline.txt", "WORKFLOW-BASELINE"], ["variation", "variation.txt", "WORKFLOW-VARIATION"]]) {
    if (name === "variation") assert.equal((await service.runCommand(ref, "/workflow-copy acceptance variation")).type, "done");
    const response = await server.inject({ method: "POST", url: `/api/sessions/${ref.id}/workflow-runs`, payload: { cwd, name, inputs: { filename, marker }, requestId: `real-${name}` } });
    assert.equal(response.statusCode, 200, response.body);
    const accepted: unknown = response.json();
    assert.ok(Check(WorkflowRunSchema, accepted));
    const deadline = Date.now() + 240000;
    for (;;) {
      if (closing) throw new Error("Acceptance stopped");
      const current = (await service.workflowRuns(ref)).find((run) => run.id === accepted.id);
      if (current?.state.kind === "finished" && !(await service.status(ref)).isStreaming) {
        assert.equal(current.state.outcome, "completed");
        assert.equal(current.state.result, marker);
        assert.equal(current.children.length, 1);
        assert.equal(await readFile(join(cwd, filename), "utf8"), marker);
        launches.push(current); break;
      }
      if (Date.now() > deadline) throw new Error(`Timed out waiting for workflow ${name}`);
      await sleep(300);
    }
  }
  const runs = await records.list({ session: ref.id });
  assert.equal(runs.length, 2);
  assert.deepEqual(runs.map((run) => run.workflowRunId).sort(), launches.map((run) => run.id).sort());
  await writeFile(join(root, "results.json"), JSON.stringify({ model, ref, launches, childRuns: runs }, null, 2));
  console.log(JSON.stringify({ root, ref, model, checks: "two real-model workflows, child file effects, explicit completion, copying, and run links passed" }));
  if (process.env.WORKFLOW_SERVE === "1") {
    const port = Number(process.env.WORKFLOW_PORT ?? "8544");
    await server.listen({ host: "127.0.0.1", port });
    console.log(`WORKFLOW_READY http://127.0.0.1:${String(port)}/ session=${ref.id}`);
  } else await close();
} catch (error) { await close(); throw error; }
