#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 -c npx tsx
// Opt-in acceptance for temporary workflow proposals with a real model. Owns only a temporary profile, Git workspace, and loopback server.
// WORKFLOW_REAL=1 ./scripts/workflow-proposal-real.ts
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
import { registerWorkflowRoutes } from "../src/server/sessions/workflowRoutes.js";
import { registerSessionRoutes } from "../src/server/sessions/sessionRoutes.js";
import { WorkflowProposalSchema, type WorkflowProposal } from "../src/shared/workflowProposals.js";
import { WorkflowRunSchema, type WorkflowRun } from "../src/shared/workflowRuns.js";
import { execFileSync } from "node:child_process";
import { sanitizedGitEnv } from "../src/server/git/gitEnv.js";

if (process.env.WORKFLOW_REAL !== "1") throw new Error("Set WORKFLOW_REAL=1 to authorize real-model acceptance");
const source: unknown = JSON.parse(await readFile(`${process.env.HOME}/.local/share/forgerie/agent/cliproxyapi.json`, "utf8"));
if (!Check(Type.Object({ baseUrl: Type.String(), apiKey: Type.String() }), source)) throw new Error("The live CLIProxyAPI config is unavailable");
const root = await mkdtemp(join(tmpdir(), "forgerie-workflow-proposal-real-"));
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
const git = (...args: string[]) => execFileSync("git", args, { cwd, env: sanitizedGitEnv(), encoding: "utf8" });
git("init", "-b", "main"); git("config", "user.email", "acceptance@example.invalid"); git("config", "user.name", "Workflow acceptance");
await writeFile(join(cwd, "README.md"), "Acceptance workspace\n"); git("add", "README.md"); git("commit", "-qm", "Initial workspace");
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
const ref = { id: (await service.start(cwd)).id, cwd };
let closing = false;
async function close() {
  if (closing) return; closing = true;
  await service.dispose(); await server.close(); await records.stop();
  await rm(join(agentDir, "models.json"), { force: true });
}
process.once("SIGTERM", () => { void close(); }); process.once("SIGINT", () => { void close(); });
const marker = "WORKFLOW-PROPOSAL-REAL";
const baseline = git("status", "--porcelain");
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
async function proposals(): Promise<WorkflowProposal[]> {
  const response = await server.inject({ url: `/api/sessions/${ref.id}/workflow-proposals?cwd=${encodeURIComponent(cwd)}` });
  assert.equal(response.statusCode, 200, response.body);
  const value: unknown = response.json();
  assert.ok(Check(Type.Array(WorkflowProposalSchema), value));
  return value;
}
try {
  const text = `---\nworkflow:\n  version: 1\n  inputs:\n    marker: { type: string }\n  stages:\n    - { id: plan, name: Plan, stop: approve }\n    - id: build\n      name: Build and review\n      workers: [{ name: writer, agent: build }, { name: reviewer, agent: review }]\n---\nFirst ask the user to approve a one-sentence plan with workflow_stop for the plan stage. Include the marker input in the summary. End your turn and wait. Do not write any files or start children before approval.\n`;
  await service.prompt(ref, `This task needs a builder, a reviewer, and my plan approval. Propose its temporary workflow now using propose_workflow with name task-plan, summary "Build and review after plan approval", inputs {"marker":"${marker}"}, and this exact complete text:\n${text}\nDo not write a workflow file or any other file. After proposing, end your turn. Do not start the workflow yourself.`);
  const deadline = Date.now() + 300000;
  let proposal: WorkflowProposal | undefined;
  while (proposal === undefined) {
    proposal = (await proposals()).find((item) => item.state.kind === "open");
    if (proposal !== undefined && !(await service.status(ref)).isStreaming) break;
    proposal = undefined;
    if (Date.now() > deadline) throw new Error("Timed out waiting for a proposal");
    await sleep(500);
  }
  // The model may omit the prompt template's final newline. Start must still keep its actual proposed bytes.
  assert.equal(proposal.text.trim(), text.trim());
  assert.equal(git("status", "--porcelain"), baseline, "proposing must not change the workspace");
  const response = await server.inject({ method: "POST", url: `/api/sessions/${ref.id}/workflow-proposals/${proposal.id}/start`, payload: { cwd, inputs: proposal.inputs, requestId: "real-proposal" } });
  assert.equal(response.statusCode, 200, response.body);
  const accepted: unknown = response.json();
  assert.ok(Check(WorkflowRunSchema, accepted));
  assert.deepEqual(accepted.definition, { name: proposal.name, path: `proposal:${proposal.id}`, text: proposal.text, sha256: proposal.sha256 });
  const planned = await until("the first stop", (run) => run.stops?.["plan"]?.state === "waiting");
  assert.deepEqual(planned.children, []);
  assert.equal((await proposals())[0]?.state.kind, "started");
  assert.equal(git("status", "--porcelain"), baseline, "the proposal and its first stop must not change the workspace");
  await writeFile(join(root, "results.json"), JSON.stringify({ model, ref, proposal, planned, baseline }, null, 2));
  console.log(JSON.stringify({ root, model, checks: "agent proposed without a file, route started frozen instructions, first stop waits with no children, git status --porcelain unchanged" }));
  await close();
} catch (error) { await close(); throw error; }
