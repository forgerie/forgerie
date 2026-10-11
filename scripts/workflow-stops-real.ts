#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 -c npx tsx
// Opt-in acceptance for workflow stops with a real model. Owns only a temporary profile, Git workspace, and loopback server.
// WORKFLOW_REAL=1 ./scripts/workflow-stops-real.ts
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
import { WorkflowRunSchema, type WorkflowRun } from "../src/shared/workflowRuns.js";
import { execFileSync } from "node:child_process";
import { SessionWorktrees } from "../src/server/workspaces/sessionWorktrees.js";
import { SessionWorktreeStore } from "../src/server/workspaces/sessionWorktreeStore.js";
import { sanitizedGitEnv } from "../src/server/git/gitEnv.js";

if (process.env.WORKFLOW_REAL !== "1") throw new Error("Set WORKFLOW_REAL=1 to authorize real-model acceptance");
const source: unknown = JSON.parse(await readFile(`${process.env.HOME}/.local/share/forgerie/agent/cliproxyapi.json`, "utf8"));
if (!Check(Type.Object({ baseUrl: Type.String(), apiKey: Type.String() }), source)) throw new Error("The live CLIProxyAPI config is unavailable");
const root = await mkdtemp(join(tmpdir(), "forgerie-workflow-stops-real-"));
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
await writeFile(join(agentDir, "agents", "acceptance.md"), "---\nname: acceptance\ndescription: Writes and commits exactly the requested acceptance file.\ntools: write, bash\n---\nWrite the requested file with the exact requested content, then run: git add -A && git commit -qm 'Acceptance file'. Do not inspect other directories. Reply with the marker you wrote.\n");
const git = (...args: string[]) => execFileSync("git", args, { cwd, env: sanitizedGitEnv(), encoding: "utf8" });
git("init", "-b", "main"); git("config", "user.email", "acceptance@example.invalid"); git("config", "user.name", "Workflow acceptance");
await writeFile(join(cwd, "README.md"), "Acceptance workspace\n"); git("add", "README.md"); git("commit", "-qm", "Initial workspace");
const ownership = new SessionWorktreeStore(join(root, "ownership.json"));
await ownership.initialize();
const models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
const records = new ChildRunStore(join(root, "child-runs.json"));
const hub = new SessionEventHub();
const service = new PiSessionService(hub, { agentDir, modelRuntime: models, archiveStore: emptyArchiveStore(),
  sessionManager: createPiSessionManagerGateway({ agentDir, env: { HOME: root }, sessionDirEnvKeys: [] }),
  durableChildAgents: createDurableChildHost({ runRecords: records, index: new LiveChildSessionIndex(join(root, "live.json")),
    worktrees: new SessionWorktrees(ownership, { publish: () => undefined }) }),
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
const marker = "WORKFLOW-STOPS-REAL";
async function until(what: string, check: (run: WorkflowRun) => boolean): Promise<WorkflowRun> {
  const deadline = Date.now() + 300000;
  for (;;) {
    if (closing) throw new Error("Acceptance stopped");
    const run = (await service.workflowRuns(ref))[0];
    if (run !== undefined && check(run) && !(await service.status(ref)).isStreaming) return run;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}: ${JSON.stringify(run)}`);
    await sleep(500);
  }
}
try {
  const body = `---\ndescription: Real workflow stops acceptance\nworkflow:\n  version: 1\n  inputs:\n    marker: { type: string }\n  stages:\n    - { id: plan, name: Plan, does: "Write a one-sentence plan in your reply.", stop: approve }\n    - id: build\n      name: Build\n      workers: [{ name: writer, agent: acceptance }]\n    - { id: land, name: Land, stop: land }\n---\nFirst ask the user to approve a one-sentence plan with workflow_stop for the plan stage. After approval, spawn the child writer with child_agent, agent acceptance, isolation worktree. Its task: write result.txt containing exactly the marker input, then commit it. After its report, ask the user to land with workflow_stop for the land stage. After landing, call workflow_finish with outcome completed and result equal to the marker input. The parent must not write files.\n`;
  assert.equal((await server.inject({ method: "POST", url: "/api/prompts", payload: { name: "stops", body } })).statusCode, 200);
  const response = await server.inject({ method: "POST", url: `/api/sessions/${ref.id}/workflow-runs`, payload: { cwd, name: "stops", inputs: { marker }, requestId: "real-stops" } });
  assert.equal(response.statusCode, 200, response.body);
  const accepted: unknown = response.json();
  assert.ok(Check(WorkflowRunSchema, accepted));
  const stop = (stage: string, decision: string) => server.inject({ method: "POST", url: `/api/sessions/${ref.id}/workflow-runs/${accepted.id}/stops/${stage}`, payload: { cwd, decision } });
  const planned = await until("the plan stop", (run) => run.stops?.["plan"]?.state === "waiting");
  assert.deepEqual(planned.children, [], "no child may start before the plan stop");
  assert.equal((await stop("plan", "approve")).statusCode, 200);
  const landing = await until("the land stop", (run) => run.stops?.["land"]?.state === "waiting");
  assert.equal(landing.children.length, 1);
  assert.equal(landing.children[0]?.stage, "build");
  const early = await server.inject({ method: "POST", url: `/api/sessions/${ref.id}/workflow-runs/${accepted.id}/finish`, payload: { cwd, outcome: "completed", result: "skip" } });
  assert.equal(early.statusCode, 409);
  const landed = await stop("land", "land");
  assert.equal(landed.statusCode, 200, landed.body);
  // A model may end the file with a newline; the content is what matters.
  assert.equal((await readFile(join(cwd, "result.txt"), "utf8")).trim(), marker);
  const finished = await until("the finish", (run) => run.state.kind === "finished");
  assert.equal(finished.state.kind === "finished" ? finished.state.outcome : "", "completed");
  await writeFile(join(root, "results.json"), JSON.stringify({ model, ref, finished }, null, 2));
  console.log(JSON.stringify({ root, model, checks: "plan stop held the child, approval released it, land stop refused early completion, Land all landed the real branch, explicit completion" }));
  await close();
} catch (error) { await close(); throw error; }
