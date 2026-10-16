import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import Fastify from "fastify";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Type, type JsonObject } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type FauxResponseFactory } from "@earendil-works/pi-ai/providers/faux";
import { defineTool } from "@earendil-works/pi-durable";
import { Check } from "typebox/value";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, emptyArchiveStore } from "./piSessionService.testSupport.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import { createDurableChildHost, LiveChildSessionIndex } from "./durableChildHost.js";
import { ChildRunStore } from "./childRunStore.js";
import { registerDurableChildRoutes } from "./durableChildRoutes.js";
import { registerWorkflowRoutes } from "./workflowRoutes.js";
import { DurableChildWorktrees } from "./durableChildWorktrees.js";
import { SessionWorktrees } from "../workspaces/sessionWorktrees.js";
import { SessionWorktreeStore } from "../workspaces/sessionWorktreeStore.js";
import { sanitizedGitEnv } from "../git/gitEnv.js";
import { WorkflowLibrary } from "../resources/workflowLibrary.js";
import { AgentDirPromptLibrary } from "../resources/promptLibrary.js";
import { ResourceEditorService } from "../resources/resourceEditorService.js";
import { registerPromptLibraryRoutes } from "../resources/promptLibraryRoutes.js";
import { WorkflowProposalSchema, type WorkflowProposal } from "../../shared/workflowProposals.js";
import { WorkflowRunSchema, type WorkflowRun } from "../../shared/workflowRuns.js";
import { WAIT_FOR_USER, type WorkflowAutonomy } from "./workflowAutonomy.js";

const definition = `---
description: A reusable writing experiment
workflow:
  version: 1
  inputs:
    task:
      type: string
      default: baseline
---
WORKFLOW-TEST
Delegate the task, then inspect its result. Finish only when the experiment is complete.
`;
const staged = `---
description: A staged experiment
workflow:
  version: 1
  stages:
    - { id: contract, name: Contract, stop: approve }
    - id: build
      name: Build
      workers: [{ name: alpha, agent: nobody-checks-this, model: faux/faux-declared }]
    - { id: land, name: Land, stop: land }
---
WORKFLOW-STAGED
Write the contract, ask for approval, build it in a worktree, then ask the user to land.
`;
let root = "";
let agentDir = "";
let service: PiSessionService;
let models: ModelRuntime;
let hub: CapturingSessionEventHub;
let store: ChildRunStore;
let autoComplete = false;
let worktrees: SessionWorktrees | undefined;
let isolate = false;
let autonomy: WorkflowAutonomy | undefined;
let started = 0;
let sequence = 0;
let proposalText = staged;
let proposalChanges = 0;
let modelAgent: string | undefined;
let modelArgument: string | undefined;
const modelThinking: string[] = [];
let modelWork: (() => Promise<void>) | undefined;
const modelRequests: { name: string; model: string; phase: string }[] = [];
let proposalInputs: Record<string, string | boolean | number> = {};
let proposalName = "task-plan";
let proposalBasis: JsonObject = { kind: "new", reason: "No saved workflow fits." };
let proposalSummary = "Build and review this task.";
const proposalErrors: string[] = [];
const errors: unknown[] = [];
const app = () => {
  const server = Fastify();
  registerPromptLibraryRoutes(server, new AgentDirPromptLibrary(agentDir));
  registerWorkflowRoutes(server, service);
  registerDurableChildRoutes(server, service);
  return server;
};
const textOf = (value: unknown): string => typeof value === "string" ? value : Array.isArray(value) ? value.map((part: { text?: string }) => part.text ?? "").join("") : "";
const work = defineTool({ name: "work", description: "Do a bounded work step", parameters: Type.Object({}), replay: "safe", execute: async () => {
  started++;
  if (modelWork === undefined) await sleep(700);
  else await modelWork();
  return { content: [{ type: "text" as const, text: "WORK-DONE" }] };
} });
const route: FauxResponseFactory = (context, options, _state, model) => {
  const last = [...context.messages].reverse().find((message) => message.role !== "system");
  const said = textOf(last?.content);
  const call = (name: string, args: JsonObject) => fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
  const answer = (text: string) => fauxAssistantMessage([fauxText(text)]);
  const modelTask = context.messages.find((message) => message.role === "user" && textOf(message.content).startsWith("MODEL-TURN-"));
  if (modelTask !== undefined) {
    modelThinking.push(options?.reasoning ?? "off");
    modelRequests.push({ name: textOf(modelTask.content).slice("MODEL-TURN-".length), model: model.id, phase: last?.role ?? "unknown" });
    return last?.role === "user" && said !== "MODEL-STEER" ? call("work", {}) : answer("MODEL-DONE");
  }
  const modelAction = /^MODEL-(SPAWN|SEND)-(alpha|beta|gamma)$/u.exec(said);
  if (last?.role === "user" && modelAction !== null) return call("child_agent", {
    action: modelAction[1] === "SPAWN" ? "spawn" : "send", name: modelAction[2] ?? "alpha", message: `MODEL-TURN-${modelAction[2] ?? "alpha"}`,
    isolation: "shared", ...(modelArgument === undefined ? {} : { model: modelArgument }), ...(modelAgent === undefined ? {} : { agent: modelAgent }),
  });
  const workflow = [...context.messages].reverse().find((message) => message.role === "user" && textOf(message.content).startsWith("Workflow run "));
  const runId = /^Workflow run ([a-f0-9]+)/u.exec(textOf(workflow?.content))?.[1];
  const isStaged = textOf(workflow?.content).includes("WORKFLOW-STAGED");
  if (last?.role === "user" && (said === "PROPOSE" || said.includes("asked for changes to the proposal"))) {
    if (said.includes("asked for changes to the proposal")) proposalChanges++;
    return call("propose_workflow", { name: proposalName, summary: proposalSummary, text: proposalText, inputs: proposalInputs, basis: proposalBasis });
  }
  if (last?.role === "user" && said.startsWith("LIST-SAVED")) return call("saved_workflows", said === "LIST-SAVED" ? {} : { name: said.slice("LIST-SAVED ".length) });
  if (last?.role === "user" && said === "BUSY") return call("bash", { command: "sleep 1" });
  if (last?.role === "toolResult" && last.isError && context.messages.some((message) => Check(Type.Object({ role: Type.Literal("user"), content: Type.Unknown() }), message) && textOf(message.content) === "PROPOSE")) proposalErrors.push(said);
  const commits = context.messages.some((message) => Check(Type.Object({ role: Type.Literal("user"), content: Type.Unknown() }), message) && textOf(message.content).startsWith("CHILD-COMMIT"));
  const spawnAlpha = () => call("child_agent", { action: "spawn", name: "alpha", message: "CHILD-COMMIT", isolation: "worktree" });
  if (isStaged && runId !== undefined) {
    if (last?.role === "toolResult" && said.includes("is held at the stop")) return call("workflow_stop", { runId, stage: "contract", summary: "CONTRACT-SUMMARY" });
    if (last?.role === "toolResult" && said.startsWith("Waiting for the user")) return answer("Waiting for the user.");
    if (last?.role === "user" && said.includes("WORKFLOW-STAGED")) return spawnAlpha();
    if (last?.role === "user" && said.includes("asked for changes")) return call("workflow_stop", { runId, stage: "contract", summary: "CONTRACT-REVISED" });
    if (last?.role === "user" && said.includes('approved "Contract"')) return spawnAlpha();
    if (last?.role === "user" && said.startsWith("[subagent alpha")) return call("workflow_stop", { runId, stage: "land", summary: "LAND-SUMMARY" });
    if (last?.role === "user" && said.includes(" landed ") && said.includes("Every stop has passed")) return call("workflow_finish", { runId, outcome: "completed", result: "STAGED-DONE" });
  }
  if (last?.role === "toolResult") {
    if (said === "WORK-DONE") return call("write", { path: "result.txt", content: "CHILD-RESULT" });
    if (commits && said.startsWith("Successfully wrote")) return call("bash", { command: "git add -A && git commit -qm 'Child result'" });
    if (said.startsWith("Started")) return answer("Waiting for the child.");
    if (said.includes("Wait for")) return runId === undefined ? answer("Cannot finish") : call("workflow_finish", { runId, outcome: "completed", result: "REVIEWED-RESULT" });
    return answer("Done.");
  }
  if (said.startsWith("[subagent")) return autoComplete && runId !== undefined ? call("workflow_finish", { runId, outcome: "completed", result: "REVIEWED-RESULT" }) : answer("Reviewed. Await explicit finish.");
  if (said === "FAIL-CHILD") return fauxAssistantMessage("", { stopReason: "error", errorMessage: "Controlled workflow child failure" });
  if (said === "RETRY-CHILD") return fauxAssistantMessage("", { stopReason: "error", errorMessage: "529 overloaded" });
  if (said.startsWith("CHILD-TASK") || said.startsWith("CHILD-COMMIT")) return fauxAssistantMessage([fauxToolCall("work", {})], { stopReason: "toolUse" });
  if (said.includes("WORKFLOW-TEST")) {
    if (said.includes('"task":"parallel"')) return fauxAssistantMessage(["alpha", "beta", "gamma"].map((name) => fauxToolCall("child_agent", { action: "spawn", name, message: "CHILD-TASK", isolation: "worktree" })), { stopReason: "toolUse" });
    return call("child_agent", { action: "spawn", name: `writer${String(++sequence)}`, message: said.includes('"task":"failure"') ? "FAIL-CHILD" : said.includes('"task":"retry"') ? "RETRY-CHILD" : "CHILD-TASK", isolation: isolate ? "worktree" : "shared" });
  }
  return answer("Session title");
};
function openService(hostsWorkflows = true): PiSessionService {
  hub = new CapturingSessionEventHub();
  return new PiSessionService(hub, { agentDir, modelRuntime: models,
    sessionManager: createPiSessionManagerGateway({ agentDir, env: { HOME: root }, sessionDirEnvKeys: [] }), archiveStore: emptyArchiveStore(), heartbeatIntervalMs: 60000,
    ...(autonomy === undefined ? {} : { workflowAutonomy: () => autonomy ?? WAIT_FOR_USER }),
    ...(hostsWorkflows ? { durableChildAgents: createDurableChildHost({ extraTools: [work], index: new LiveChildSessionIndex(join(agentDir, "live.json")), runRecords: store, onRunRecordError: (error) => { errors.push(error); }, ...(worktrees === undefined ? {} : { worktrees }) }) } : {}),
  });
}
async function until<T>(check: () => Promise<T | false | undefined>): Promise<T> {
  const end = Date.now() + 15000;
  for (;;) {
    const result = await check();
    if (result !== false && result !== undefined) return result;
    if (Date.now() > end) throw new Error("Workflow condition timed out");
    await sleep(40);
  }
}
function runBody(value: unknown): WorkflowRun {
  if (!Check(WorkflowRunSchema, value)) throw new Error(`Invalid workflow response: ${JSON.stringify(value)}`);
  return value;
}
beforeEach(async () => {
  proposalText = staged; proposalChanges = 0; proposalErrors.length = 0; proposalInputs = {}; proposalName = "task-plan"; proposalSummary = "Build and review this task."; proposalBasis = { kind: "new", reason: "No saved workflow fits." };
  modelAgent = undefined; modelArgument = "faux/faux-1"; modelThinking.length = 0; modelWork = undefined; modelRequests.length = 0;
  errors.length = 0; started = 0; sequence = 0; autoComplete = false; worktrees = undefined; isolate = false; autonomy = undefined;
  root = await mkdtemp(join(tmpdir(), "forgerie-workflow-runs-"));
  agentDir = join(root, "agent");
  await mkdir(agentDir);
  store = new ChildRunStore(join(agentDir, "child-runs.json"));
  models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
  // A second model lets a test tell a declared worker model from the session default.
  const provider = fauxProvider({ tokensPerSecond: 600, models: [{ id: "faux-1", reasoning: true }, { id: "faux-declared", reasoning: true }] });
  models.registerNativeProvider(provider.provider); await models.refresh({ allowNetwork: false });
  provider.setResponses(Array.from({ length: 300 }, () => route));
  service = openService();
});
afterEach(async () => { vi.restoreAllMocks(); await service.dispose(); await rm(root, { recursive: true, force: true }); expect(errors).toEqual([]); });

describe("saved prose workflows through production Durable sessions and HTTP", () => {
  it("stops the whole run, keeps its files, rejects other sessions, and accepts cancellation retries", async () => {
    await new AgentDirPromptLibrary(agentDir).save({ name: "experiment", body: definition });
    const ref = { id: (await service.start(root)).id, cwd: root };
    const run = runBody(await service.runWorkflow(ref, "experiment", {}, "cancel-running"));
    await until(() => Promise.resolve(started > 0));
    const server = app();
    const url = `/sessions/${ref.id}/workflow-runs/${run.id}/cancel`;
    try {
      await writeFile(join(root, "keep.txt"), "Keep the user's work");
      const other = { id: (await service.start(root)).id, cwd: root };
      expect((await server.inject({ method: "POST", url: `/sessions/${other.id}/workflow-runs/${run.id}/cancel`, payload: { cwd: root } })).statusCode).toBe(404);
      expect((await server.inject({ method: "POST", url, payload: { cwd: root, extra: true } })).statusCode).toBe(400);
      const response = await server.inject({ method: "POST", url, payload: { cwd: root } });
      expect(response.statusCode).toBe(200);
      expect(runBody(response.json()).state).toEqual({ kind: "stopping" });
      await expect(service.finishWorkflow(ref, run.id, "completed", "Too late")).rejects.toThrow(/stopping|already finished/);
      const stopped = await until(async () => {
        const current = (await service.workflowRuns(ref))[0];
        return current?.state.kind === "finished" ? current : false;
      });
      expect(stopped.state).toMatchObject({ kind: "finished", outcome: "stopped" });
      expect(stopped.children.every((child) => child.state.kind === "settled")).toBe(true);
      expect((await service.status(ref)).isStreaming).toBe(false);
      expect((await server.inject({ method: "POST", url, payload: { cwd: root } })).json()).toMatchObject({ state: { kind: "finished", outcome: "stopped" } });
      expect(await readFile(join(root, "keep.txt"), "utf8")).toBe("Keep the user's work");
      await service.dispose();
      service = openService();
      expect((await service.workflowRuns(ref))[0]?.state).toMatchObject({ kind: "finished", outcome: "stopped" });
      // Cancellation released the active slot and left no delivery task to wake an old run.
      expect(runBody(await service.runWorkflow(ref, "experiment", {}, "after-cancel")).state.kind).toBe("running");
    } finally { await server.close(); }
  });

  it("cancels a child's background retry before marking the run stopped", async () => {
    // Exercise the child reporter's backoff, not the model transport's own retries first.
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ retry: { enabled: false } }));
    await new AgentDirPromptLibrary(agentDir).save({ name: "experiment", body: definition });
    const ref = { id: (await service.start(root)).id, cwd: root };
    const run = runBody(await service.runWorkflow(ref, "experiment", { task: "retry" }, "cancel-retry"));
    await until(async () => (await service.durableChildren(ref)).some((child) => child.retry !== undefined));
    await service.cancelWorkflow(ref, run.id);
    const stopped = await until(async () => {
      const current = (await service.workflowRuns(ref))[0];
      return current?.state.kind === "finished" ? current : false;
    });
    expect(stopped.children[0]?.state).toMatchObject({ kind: "settled", outcome: "stopped", delivered: "aborted" });
    expect((await service.durableChildren(ref))[0]?.retry).toBeUndefined();
  });

  it("stops a run waiting at a user gate without approving or landing it", async () => {
    await new AgentDirPromptLibrary(agentDir).save({ name: "staged", body: staged });
    const ref = { id: (await service.start(root)).id, cwd: root };
    const run = runBody(await service.runWorkflow(ref, "staged", {}, "cancel-gate"));
    await until(async () => (await service.workflowRuns(ref))[0]?.stops?.["contract"]?.state === "waiting");
    expect((await service.cancelWorkflow(ref, run.id)).state).toEqual({ kind: "stopping" });
    await service.dispose();
    service = openService();
    await until(async () => (await service.workflowRuns(ref))[0]?.state.kind === "finished");
    await expect(service.decideWorkflowStop(ref, run.id, "contract", "approve", undefined)).rejects.toThrow("finished");
    expect((await service.workflowRuns(ref))[0]?.stops?.["contract"]?.state).toBe("waiting");
  });
  it.each([
    { source: "saved", model: "faux/faux-1:high" }, { source: "proposal", model: "faux/faux-1:high" },
    { source: "saved", model: null }, { source: "proposal", model: null },
  ] as const)("starts a $source workflow with model $model, validates it, and preserves retry identity", async ({ source, model }) => {
    let server = app();
    try {
      const ref = { id: (await service.start(root)).id, cwd: root };
      let url = `/sessions/${ref.id}/workflow-runs`;
      if (source === "saved") await new AgentDirPromptLibrary(agentDir).save({ name: "staged", body: staged });
      else {
        await service.prompt(ref, "PROPOSE");
        const proposal = await until(async () => {
          const proposal = (await service.workflowProposals(ref))[0];
          return proposal !== undefined && !(await service.status(ref)).isStreaming ? proposal : false;
        });
        url = `/sessions/${ref.id}/workflow-proposals/${proposal.id}/start`;
      }
      const payload = { cwd: root, ...(source === "saved" ? { name: "staged" } : {}), inputs: {}, requestId: "models-start", models: { alpha: model } };
      for (const models of [{ missing: null }, { alpha: "bad" }, { alpha: "/id" }, { alpha: "provider/" }, { alpha: "provider/id:" }, { alpha: "provider/id:bogus" }, { alpha: "provider/id:HIGH" }, { alpha: "provider/id has spaces" }, { alpha: 1 }]) {
        expect((await server.inject({ method: "POST", url, payload: { ...payload, models } })).statusCode).toBe(400);
      }
      const response = await server.inject({ method: "POST", url, payload });
      expect(response.statusCode).toBe(200);
      const run = runBody(response.json());
      expect(run.stages?.[1]?.workers?.[0]?.model).toBe(model);
      expect((await server.inject({ method: "POST", url, payload })).json()).toMatchObject({ id: run.id });
      for (const models of [{ alpha: model === null ? "faux/faux-1:high" : null }, { alpha: "faux/faux-declared" }, {}]) {
        expect((await server.inject({ method: "POST", url, payload: { ...payload, models } })).statusCode).toBe(409);
      }
      await until(async () => (await service.workflowRuns(ref))[0]?.stops?.["contract"]?.state === "waiting" && !(await service.status(ref)).isStreaming);
      const messages = (await service.messages(ref)).messages;
      expect(messages.some((message) => Check(Type.Object({ role: Type.Literal("user"), content: Type.Unknown() }), message) && textOf(message.content).includes(`model ${model ?? "from its agent file"}`))).toBe(true);
      const modelUrl = `/sessions/${ref.id}/workflow-runs/${run.id}/workers/alpha/model`;
      for (const model of ["bad", "provider/", "provider/id:", "provider/id:bogus", "provider/id:HIGH", 1, {}]) {
        expect((await server.inject({ method: "POST", url: modelUrl, payload: { cwd: root, model } })).statusCode).toBe(400);
      }
      expect((await server.inject({ method: "POST", url: modelUrl, payload: { cwd: root } })).statusCode).toBe(400);
      expect((await server.inject({ method: "POST", url: modelUrl.replace("/alpha/", "/missing/"), payload: { cwd: root, model: null } })).statusCode).toBe(404);
      expect((await server.inject({ method: "POST", url: modelUrl.replace(run.id, "missing"), payload: { cwd: root, model: null } })).statusCode).toBe(404);
      hub.sessionEvents.length = 0;
      const runtimeModel = model === null ? "faux/faux-declared" : null;
      const changed = await server.inject({ method: "POST", url: modelUrl, payload: { cwd: root, model: runtimeModel } });
      expect(changed.statusCode).toBe(200);
      expect(runBody(changed.json()).stages?.[1]?.workers?.[0]?.model).toBe(runtimeModel);
      const history = await server.inject({ url: `/sessions/${ref.id}/workflow-runs?cwd=${encodeURIComponent(root)}` });
      expect(history.json<WorkflowRun[]>()[0]?.stages?.[1]?.workers?.[0]?.model).toBe(runtimeModel);
      await until(() => Promise.resolve(hub.sessionEvents.some(({ event }) => event.type === "pi.event" && event.eventType === "workflow_runs_changed")));
      // Runtime edits survive reopening and do not change which launch request was accepted.
      await server.close(); await service.dispose(); service = openService(); server = app();
      expect((await service.workflowRuns(ref))[0]?.stages?.[1]?.workers?.[0]?.model).toBe(runtimeModel);
      expect((await server.inject({ method: "POST", url, payload })).statusCode).toBe(200);
      await service.finishWorkflow(ref, run.id, "stopped", "End model test");
      expect((await server.inject({ method: "POST", url: modelUrl, payload: { cwd: root, model: null } })).statusCode).toBe(409);
    } finally { await server.close(); }
  });

  it.each(["session", "agent file"] as const)("applies runtime models at the next spawn/send, preserves a busy turn, and resets to the agent file's model, else the session's, with a %s profile", async (fallback) => {
    const reset = fallback === "agent file" ? { model: "faux-declared", thinking: "high" } : { model: "faux-1", thinking: "low" };
    if (fallback === "agent file") {
      await mkdir(join(agentDir, "agents"));
      await writeFile(join(agentDir, "agents/model-agent.md"), "---\nname: model-agent\ndescription: Model test\ntools: work\nmodel: faux/faux-declared\nthinking: high\n---\nDo the task.");
      modelAgent = "model-agent";
    }
    const server = app();
    let releaseWork: (() => void) | undefined;
    modelWork = () => new Promise<void>((resolve) => { releaseWork = resolve; });
    try {
      const ref = { id: (await service.start(root)).id, cwd: root };
      await service.setThinkingLevel(ref, "low");
      const body = "---\nworkflow:\n  version: 1\n  stages:\n    - id: build\n      name: Build\n      workers: [{ name: alpha }, { name: beta }, { name: gamma }]\n---\nWait for instructions.\n";
      await new AgentDirPromptLibrary(agentDir).save({ name: "models", body });
      const run = await service.runWorkflow(ref, "models", {}, "runtime-models");
      await until(async () => (await service.messages(ref)).messages.some((message) => Check(Type.Object({ role: Type.Literal("user"), content: Type.Unknown() }), message) && textOf(message.content).startsWith(`Workflow run ${run.id}`)) && !(await service.status(ref)).isStreaming);
      const change = async (name: string, model: string | null) => {
        const response = await server.inject({ method: "POST", url: `/sessions/${ref.id}/workflow-runs/${run.id}/workers/${name}/model`, payload: { cwd: root, model } });
        expect(response.statusCode).toBe(200);
        expect(runBody(response.json()).stages?.[0]?.workers?.find((worker) => worker.name === name)?.model).toBe(model);
      };
      const ask = async (message: string) => {
        await until(async () => !(await service.status(ref)).isStreaming);
        await service.prompt(ref, message);
      };
      const settled = async (count: number) => until(async () => {
        const children = (await service.workflowRuns(ref))[0]?.children;
        return children?.length === count && children.every((child) => child.state.kind === "settled" && child.state.delivered !== false);
      });
      await change("alpha", "faux/faux-declared");
      await ask("MODEL-SPAWN-alpha");
      await until(() => Promise.resolve(started === 1));
      expect(modelRequests).toEqual([{ name: "alpha", model: "faux-declared", phase: "user" }]);
      // An edit alone cannot affect the remaining generations of this turn.
      await change("alpha", "faux/faux-1:high");
      await ask("MODEL-SEND-alpha");
      await until(async () => (await service.workflowRuns(ref))[0]?.children.length === 2 && !(await service.status(ref)).isStreaming);
      expect(started).toBe(1);
      releaseWork?.();
      await until(() => Promise.resolve(started === 2));
      expect(modelRequests.slice(0, 3)).toEqual([
        { name: "alpha", model: "faux-declared", phase: "user" },
        { name: "alpha", model: "faux-declared", phase: "toolResult" },
        { name: "alpha", model: "faux-1", phase: "user" },
      ]);
      releaseWork?.();
      await settled(2);
      await change("alpha", null);
      await ask("MODEL-SEND-alpha");
      await until(() => Promise.resolve(started === 3));
      expect(modelRequests.at(-1)).toMatchObject({ name: "alpha", model: reset.model, phase: "user" });
      expect(modelThinking.at(-1)).toBe(reset.thinking);
      releaseWork?.();
      await settled(3);
      // Null at spawn ignores the coordinating agent's explicit model argument too.
      await change("beta", null);
      await ask("MODEL-SPAWN-beta");
      await until(() => Promise.resolve(started === 4));
      expect(modelRequests.at(-1)).toMatchObject({ name: "beta", model: reset.model });
      expect(modelThinking.at(-1)).toBe(reset.thinking);
      releaseWork?.();
      await settled(4);
      if (fallback === "agent file") {
        // No override preserves the agent file's model and thinking when the agent supplies no model argument.
        modelArgument = undefined;
        await ask("MODEL-SPAWN-gamma");
        await until(() => Promise.resolve(started === 5));
        expect(modelRequests.at(-1)).toMatchObject({ name: "gamma", model: "faux-declared" });
        expect(modelThinking.at(-1)).toBe("high");
        releaseWork?.();
        await settled(5);
      }
      await service.finishWorkflow(ref, run.id, "completed", "Models applied at turn boundaries");
    } finally { releaseWork?.(); await server.close(); }
  }, 20000);

  it("refuses a reviewer's next round once the run's review round limit is used", async () => {
    await mkdir(join(agentDir, "agents"));
    await writeFile(join(agentDir, "agents/reviewer.md"), "---\nname: reviewer\ndescription: Reviews\ntools: work\n---\nReview the work.");
    modelAgent = "reviewer";
    autonomy = { landStops: false, approveStops: false, reviewRounds: 1 };
    await service.dispose(); service = openService();
    const ref = { id: (await service.start(root)).id, cwd: root };
    await new AgentDirPromptLibrary(agentDir).save({ name: "review-limit", body: "---\nworkflow:\n  version: 1\n  stages:\n    - { id: review, name: Review, workers: [{ name: alpha }] }\n---\nWait for instructions.\n" });
    const run = await service.runWorkflow(ref, "review-limit", {}, "review-limit");
    expect(run.reviewRounds).toBe(1);
    const said = async (text: string) => JSON.stringify(await service.messages(ref)).includes(text);
    await until(async () => await said(`Workflow run ${run.id}`) && !(await service.status(ref)).isStreaming);
    expect(await said("Review rounds: Forgerie allows 1 per reviewer")).toBe(true);
    await service.prompt(ref, "MODEL-SPAWN-alpha");
    await until(() => Promise.resolve(started === 1));
    await until(async () => (await service.workflowRuns(ref))[0]?.children.every((child) => child.state.kind === "settled") === true && !(await service.status(ref)).isStreaming);
    await service.prompt(ref, "MODEL-SEND-alpha");
    await until(async () => await said("Review round limit reached: alpha has reviewed 1 times"));
    expect(started).toBe(1);
    expect((await service.workflowRuns(ref))[0]?.children).toHaveLength(1);
    await service.finishWorkflow(ref, run.id, "completed", "One review round");
  }, 20000);

  it.each([false, true])("applies workflow models through direct HTTP messages without changing a busy steer's model (agent file: %s)", async (agentFile) => {
    if (agentFile) {
      await mkdir(join(agentDir, "agents"));
      await writeFile(join(agentDir, "agents/model-agent.md"), "---\nname: model-agent\ndescription: Model test\ntools: work\nmodel: faux/faux-declared\nthinking: high\n---\nDo the task.");
      modelAgent = "model-agent";
    }
    const server = app();
    let releaseWork: (() => void) | undefined;
    modelWork = () => new Promise<void>((resolve) => { releaseWork = resolve; });
    try {
      const ref = { id: (await service.start(root)).id, cwd: root };
      await service.setThinkingLevel(ref, "low");
      await new AgentDirPromptLibrary(agentDir).save({ name: "direct-models", body: "---\nworkflow:\n  version: 1\n  stages:\n    - { id: build, name: Build, workers: [{ name: alpha }] }\n---\nWait for instructions.\n" });
      const run = await service.runWorkflow(ref, "direct-models", {}, "direct-models", { alpha: "faux/faux-declared:high" });
      await until(async () => (await service.messages(ref)).messages.some((message) => Check(Type.Object({ role: Type.Literal("user"), content: Type.Unknown() }), message) && textOf(message.content).startsWith(`Workflow run ${run.id}`)) && !(await service.status(ref)).isStreaming);
      await service.prompt(ref, "MODEL-SPAWN-alpha");
      await until(() => Promise.resolve(started === 1));
      const child = (await service.durableChildren(ref))[0];
      if (child === undefined) throw new Error("Expected alpha");
      const idle = () => until(async () => !(await service.durableChildMessages(ref, child.conversationId)).busy);
      const message = async (text: string) => {
        const response = await server.inject({ method: "POST", url: `/sessions/${ref.id}/children/${String(child.conversationId)}/message`, payload: { cwd: root, text } });
        expect(response.statusCode).toBe(200);
      };
      const change = async (model: string | null) => {
        const response = await server.inject({ method: "POST", url: `/sessions/${ref.id}/workflow-runs/${run.id}/workers/alpha/model`, payload: { cwd: root, model } });
        expect(response.statusCode).toBe(200);
      };
      releaseWork?.(); await idle();
      await change("faux/faux-1:low");
      await message("MODEL-TURN-alpha");
      await until(() => Promise.resolve(started === 2));
      expect(modelRequests.at(-1)?.model).toBe("faux-1");
      expect(modelThinking.at(-1)).toBe("low");
      releaseWork?.(); await idle();
      await change("faux/faux-declared:high");
      const busyTurnStart = modelRequests.length;
      await message("MODEL-TURN-alpha");
      await until(() => Promise.resolve(started === 3));
      await change("faux/faux-1:low");
      // Direct messages must still steer now, not wait for this tool to finish.
      await message("MODEL-STEER");
      expect(started).toBe(3);
      releaseWork?.(); await idle();
      expect(modelRequests.slice(busyTurnStart).map((request) => request.model)).toEqual(["faux-declared", "faux-declared"]);
      expect(modelThinking.slice(busyTurnStart)).toEqual(["high", "high"]);
      await message("MODEL-TURN-alpha");
      await until(() => Promise.resolve(started === 4));
      expect(modelRequests.at(-1)?.model).toBe("faux-1");
      expect(modelThinking.at(-1)).toBe("low");
      releaseWork?.(); await idle();
      await change(null);
      await message("MODEL-TURN-alpha");
      await until(() => Promise.resolve(started === 5));
      // Null restores the agent file's model, else the session's.
      expect(modelRequests.at(-1)?.model).toBe(agentFile ? "faux-declared" : "faux-1");
      expect(modelThinking.at(-1)).toBe(agentFile ? "high" : "low");
      releaseWork?.(); await idle();
    } finally { releaseWork?.(); await server.close(); }
  }, 20000);

  it("saves, launches, snapshots, recovers, links children, explicitly finishes, and copies a variation", async () => {
    let server = app();
    try {
      const ref = { id: (await service.start(root)).id, cwd: root };
      expect((await server.inject({ method: "POST", url: "/prompts", payload: { name: "experiment", body: definition } })).statusCode).toBe(200);
      const inventory = await server.inject({ url: `/sessions/${ref.id}/workflows?cwd=${encodeURIComponent(root)}` });
      expect(inventory.json()).toMatchObject({ workflows: [{ name: "experiment" }] });
      const url = `/sessions/${ref.id}/workflow-runs`;
      const payload = { cwd: root, name: "experiment", inputs: { task: "baseline" }, requestId: "launch-1" };
      const [response, concurrent] = await Promise.all([server.inject({ method: "POST", url, payload }), server.inject({ method: "POST", url, payload })]);
      expect(response.statusCode).toBe(200);
      expect(concurrent.statusCode).toBe(200);
      const first = runBody(response.json());
      expect(runBody(concurrent.json()).id).toBe(first.id);
      expect(first.definition.text).toBe(definition);
      expect(first.inputs).toEqual({ task: "baseline" });
      await until(() => Promise.resolve(started > 0));
      expect((await service.workflowRuns(ref))[0]?.state.kind).toBe("running");
      expect((await server.inject({ method: "POST", url: `${url}/${first.id}/finish`, payload: { cwd: root, outcome: "completed", result: "Too early" } })).statusCode).toBe(409);
      expect((await server.inject({ method: "POST", url, payload: { ...payload, requestId: "launch-2" } })).statusCode).toBe(409);
      // Accepted bytes remain authoritative when the author edits the file during work.
      await writeFile(join(agentDir, "prompts", "experiment.md"), definition.replace("baseline", "variation"));
      expect(runBody((await server.inject({ method: "POST", url, payload })).json()).id).toBe(first.id);
      expect((await server.inject({ method: "POST", url, payload: { ...payload, inputs: { task: "different" } } })).statusCode).toBe(409);
      await server.close();
      await service.dispose();
      service = openService();
      server = app();
      const recovery = await service.resumeDurableSessions();
      expect(recovery.resumed).toContain(ref.id);
      expect(recovery.failed).toEqual([]);
      expect(runBody((await server.inject({ method: "POST", url, payload })).json()).id).toBe(first.id);
      const completedChild = await until(async () => {
        const run = (await service.workflowRuns(ref))[0];
        return run?.children[0]?.state.kind === "settled" && run.children[0].state.delivered !== false ? run : false;
      });
      expect(completedChild.state.kind).toBe("running");
      expect(await new LiveChildSessionIndex(join(agentDir, "live.json")).list()).toContainEqual(ref);
      expect(completedChild.children[0]?.state).toMatchObject({ kind: "settled", outcome: "answered", result: "Done.", delivered: true });
      expect(await readFile(join(root, "result.txt"), "utf8")).toBe("CHILD-RESULT");
      await until(async () => !(await service.status(ref)).isStreaming);
      expect((await server.inject({ method: "POST", url: `${url}/${first.id}/finish`, payload: { cwd: root, outcome: "completed", result: "Reviewed baseline" } })).statusCode).toBe(200);
      expect((await service.workflowRuns(ref))[0]?.definition.text).toBe(definition);
      const records = await store.list({ session: ref.id });
      expect(records).toHaveLength(1);
      expect(records[0]?.workflowRunId).toBe(first.id);
      expect(records[0]?.state.kind).toBe("finished");
      expect(await service.runCommand(ref, "/workflow-copy experiment variation")).toMatchObject({ type: "done" });
      expect(await service.runCommand(ref, "/workflow-copy experiment variation")).toMatchObject({ type: "unsupported" });
      autoComplete = true;
      expect(await service.runCommand(ref, '/workflow-run variation {"task":"second experiment"}')).toMatchObject({ type: "done" });
      const second = await until(async () => (await service.workflowRuns(ref)).find((run) => run.definition.name === "variation" && run.state.kind === "finished"));
      expect(second.id).not.toBe(first.id);
      expect(second.definition.sha256).not.toBe(first.definition.sha256);
      expect(second.inputs).toEqual({ task: "second experiment" });
      expect(second.state).toMatchObject({ kind: "finished", outcome: "completed", result: "REVIEWED-RESULT" });
      expect((await store.list({ session: ref.id })).map((run) => run.workflowRunId).sort()).toEqual([first.id, second.id].sort());
      const summary = await service.runCommand(ref, "/workflow-runs");
      expect(summary.type).toBe("done");
      if (summary.type === "done") expect(summary.message).toContain("Reviewed baseline");
    } finally { await server.close(); }
  }, 30000);

  it("keeps an accepted launch and its result after revision-checked source deletion", async () => {
    const ref = { id: (await service.start(root)).id, cwd: root };
    await new AgentDirPromptLibrary(agentDir).save({ name: "experiment", body: definition });
    const run = await service.runWorkflow(ref, "experiment", {}, "delete-source");
    await until(() => Promise.resolve(started > 0));
    const editor = new ResourceEditorService({ agentDir, bundledPaths: [], session: () => Promise.resolve({ cwd: root }) });
    const entry = (await editor.inventory()).resources.find((resource) => resource.path === join(agentDir, "prompts/experiment.md"));
    if (entry === undefined) throw new Error("Expected workflow resource");
    const file = await editor.read(entry.id);
    await editor.delete(entry.id, { baseRevision: file.revision });
    expect((await service.runWorkflow(ref, "experiment", {}, "delete-source")).definition.text).toBe(definition);
    await until(async () => {
      const child = (await service.workflowRuns(ref))[0]?.children[0];
      return child?.state.kind === "settled" && child.state.delivered;
    });
    await service.finishWorkflow(ref, run.id, "completed", "The accepted snapshot still ran");
    expect((await service.workflowRuns(ref))[0]?.children[0]?.state).toMatchObject({ outcome: "answered", result: "Done." });
    expect(await readFile(join(root, "result.txt"), "utf8")).toBe("CHILD-RESULT");
  });

  it("rejects malformed inputs, scripts, foreign completions, and mutated completion results", async () => {
    const server = app();
    try {
      const ref = { id: (await service.start(root)).id, cwd: root };
      await new AgentDirPromptLibrary(agentDir).save({ name: "experiment", body: definition });
      const url = `/sessions/${ref.id}/workflow-runs`;
      const payload = { cwd: root, name: "experiment", inputs: {}, requestId: "launch" };
      for (const bad of [{ ...payload, inputs: { extra: 1 } }, { ...payload, inputs: { task: false } }, { ...payload, requestId: "" }, { ...payload, other: 1 }]) {
        expect((await server.inject({ method: "POST", url, payload: bad })).statusCode).toBe(400);
      }
      await new AgentDirPromptLibrary(agentDir).save({ name: "scripted", body: `${definition}\n\x60\x60\x60js workflow\nthrow new Error('not executed');\n\x60\x60\x60` });
      expect((await server.inject({ method: "POST", url, payload: { ...payload, name: "scripted" } })).statusCode).toBe(409);
      expect(await service.workflowRuns(ref)).toEqual([]);
      const launched = runBody((await server.inject({ method: "POST", url, payload })).json());
      const foreign = { id: (await service.start(root)).id, cwd: root };
      expect((await server.inject({ method: "POST", url: `/sessions/${foreign.id}/workflow-runs/${launched.id}/finish`, payload: { cwd: root, outcome: "completed", result: "foreign" } })).statusCode).toBe(404);
      await until(async () => {
        const child = (await service.workflowRuns(ref))[0]?.children[0];
        return child?.state.kind === "settled" && child.state.delivered;
      });
      await service.finishWorkflow(ref, launched.id, "completed", "Accepted result");
      await expect(service.finishWorkflow(ref, launched.id, "completed", "Accepted result")).resolves.toBeUndefined();
      await expect(service.finishWorkflow(ref, launched.id, "completed", "Other result")).rejects.toThrow("another result");
    } finally { await server.close(); }
  });

  it("records a failed completion reporter without permanently blocking explicit completion", async () => {
    const ref = { id: (await service.start(root)).id, cwd: root };
    await new AgentDirPromptLibrary(agentDir).save({ name: "experiment", body: definition });
    vi.spyOn(store, "save").mockRejectedValue(new Error("Child result store unavailable"));
    try {
      const run = await service.runWorkflow(ref, "experiment", {}, "reporter-failure");
      const failed = await until(async () => {
        const current = (await service.workflowRuns(ref))[0];
        return current?.children[0]?.state.kind === "settled" && current.children[0].state.deliveryError !== undefined ? current : false;
      });
      const state = failed.children[0]?.state;
      expect(state).toMatchObject({ kind: "settled", outcome: "answered", result: "Done.", delivered: false });
      if (state?.kind === "settled") expect(state.deliveryError).toContain("reporter");
      expect(errors.length).toBeGreaterThan(0);
      await until(async () => ((await service.status(ref)).workingAgents ?? 0) === 0);
      expect(await readFile(join(root, "result.txt"), "utf8")).toBe("CHILD-RESULT");
      await service.finishWorkflow(ref, run.id, "failed", "The child report could not be delivered");
      expect((await service.workflowRuns(ref))[0]?.state.kind).toBe("finished");
    } finally {
      vi.restoreAllMocks();
      await expect(service.dispose()).rejects.toThrow("Child result store unavailable");
      errors.length = 0;
    }
  });

  it("keeps the child's answer when its worktree report fails", async () => {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, env: sanitizedGitEnv(), encoding: "utf8" });
    git("init", "-b", "main"); git("config", "user.email", "workflow@example.invalid"); git("config", "user.name", "Workflow tests");
    await writeFile(join(root, "base.txt"), "base");
    git("add", "base.txt"); git("commit", "-m", "Initial workspace");
    const ownership = new SessionWorktreeStore(join(agentDir, "ownership.json"));
    await ownership.initialize();
    worktrees = new SessionWorktrees(ownership, { publish: () => undefined });
    await service.dispose(); service = openService(); isolate = true;
    vi.spyOn(DurableChildWorktrees.prototype, "report").mockRejectedValue(new Error("Worktree report unavailable"));
    const ref = { id: (await service.start(root)).id, cwd: root };
    await new AgentDirPromptLibrary(agentDir).save({ name: "experiment", body: definition });
    const run = await service.runWorkflow(ref, "experiment", {}, "worktree-report-failure");
    const recovered = await until(async () => {
      const current = (await service.workflowRuns(ref))[0];
      return current?.children[0]?.state.kind === "settled" && current.children[0].state.deliveryError !== undefined ? current : false;
    });
    expect(recovered.children[0]?.state).toMatchObject({ kind: "settled", outcome: "answered", result: "Done.", delivered: false });
    const child = (await service.durableChildren(ref))[0];
    if (child?.worktree === undefined) throw new Error("Expected isolated child");
    expect(await readFile(join(child.worktree.path, "result.txt"), "utf8")).toBe("CHILD-RESULT");
    await service.finishWorkflow(ref, run.id, "completed", "Recovered the answer; the completion report failed");
  });

  it("holds the run at each stop, refuses later work, and lands the child branch only when the user decides", async () => {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, env: sanitizedGitEnv(), encoding: "utf8" });
    git("init", "-b", "main"); git("config", "user.email", "workflow@example.invalid"); git("config", "user.name", "Workflow tests");
    await writeFile(join(root, "base.txt"), "base");
    git("add", "base.txt"); git("commit", "-m", "Initial workspace");
    const ownership = new SessionWorktreeStore(join(agentDir, "ownership.json"));
    await ownership.initialize();
    worktrees = new SessionWorktrees(ownership, { publish: () => undefined });
    await service.dispose(); service = openService();
    const server = app();
    try {
      const ref = { id: (await service.start(root)).id, cwd: root };
      await new AgentDirPromptLibrary(agentDir).save({ name: "staged", body: staged });
      const run = await service.runWorkflow(ref, "staged", {}, "staged-1");
      expect(run.stages?.map((stage) => stage.id)).toEqual(["contract", "build", "land"]);
      expect(run.stops).toEqual({ contract: { state: "open", round: 0 }, land: { state: "open", round: 0 } });
      const stopUrl = (stage: string) => `/sessions/${ref.id}/workflow-runs/${run.id}/stops/${stage}`;
      const waitingAt = (stage: string, summary: string) => until(async () => {
        const current = (await service.workflowRuns(ref))[0];
        return current?.stops?.[stage]?.state === "waiting" && current.stops[stage].summary === summary ? current : false;
      });
      // The agent tried to start alpha before the contract stop; Forgerie refused, and the agent asked instead.
      const held = await waitingAt("contract", "CONTRACT-SUMMARY");
      await until(async () => (await service.status(ref)).waitingOnYou === 1);
      expect(held.children).toEqual([]);
      expect(started).toBe(0);
      expect((await server.inject({ method: "POST", url: stopUrl("land"), payload: { cwd: root, decision: "land" } })).statusCode).toBe(409);
      expect((await server.inject({ method: "POST", url: stopUrl("contract"), payload: { cwd: root, decision: "changes", note: " " } })).statusCode).toBe(400);
      const changes = await server.inject({ method: "POST", url: stopUrl("contract"), payload: { cwd: root, decision: "changes", note: "Name the columns." } });
      expect(changes.statusCode).toBe(200);
      const revised = await waitingAt("contract", "CONTRACT-REVISED");
      expect(revised.stops?.["contract"]?.round).toBe(1);
      const approved = await server.inject({ method: "POST", url: stopUrl("contract"), payload: { cwd: root, decision: "approve" } });
      expect(approved.statusCode).toBe(200);
      expect(runBody(approved.json()).stops?.["contract"]).toMatchObject({ state: "approved", summary: "CONTRACT-REVISED", round: 2 });
      // A repeated decision finds nothing waiting.
      expect((await server.inject({ method: "POST", url: stopUrl("contract"), payload: { cwd: root, decision: "approve" } })).statusCode).toBe(409);
      const landing = await waitingAt("land", "LAND-SUMMARY");
      expect(landing.children).toMatchObject([{ name: "alpha", stage: "build", state: { kind: "settled", outcome: "answered" } }]);
      const finish = `/sessions/${ref.id}/workflow-runs/${run.id}/finish`;
      const early = await server.inject({ method: "POST", url: finish, payload: { cwd: root, outcome: "completed", result: "Skip the land" } });
      expect(early.statusCode).toBe(409);
      expect(early.json<{ error: string }>().error).toContain('"Land"');
      // The agent passed no model; Forgerie applied the one the workflow declares for alpha.
      expect((await store.list({ session: ref.id })).find((record) => record.child.name === "alpha")?.model).toEqual({ provider: "faux", modelId: "faux-declared" });
      const alpha = (await service.durableChildren(ref)).find((child) => child.name === "alpha");
      expect(alpha?.worktree).toMatchObject({ state: "active", ahead: 1 });
      const landed = await server.inject({ method: "POST", url: stopUrl("land"), payload: { cwd: root, decision: "land" } });
      expect(landed.statusCode).toBe(200);
      expect(runBody(landed.json()).stops?.["land"]).toMatchObject({ state: "approved", landed: [alpha?.worktree?.branch] });
      expect(git("log", "-1", "--format=%s", "main").trim()).toBe("Child result");
      expect(await readFile(join(root, "result.txt"), "utf8")).toBe("CHILD-RESULT");
      const finished = await until(async () => {
        const current = (await service.workflowRuns(ref))[0];
        return current?.state.kind === "finished" ? current : false;
      });
      expect(finished.state).toMatchObject({ outcome: "completed", result: "STAGED-DONE" });
    } finally { await server.close(); }
  }, 30000);

  it("passes approve and land stops itself when Workflow autonomy says so, logs both, and still lands the real branch", async () => {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, env: sanitizedGitEnv(), encoding: "utf8" });
    git("init", "-b", "main"); git("config", "user.email", "workflow@example.invalid"); git("config", "user.name", "Workflow tests");
    await writeFile(join(root, "base.txt"), "base");
    git("add", "base.txt"); git("commit", "-m", "Initial workspace");
    const ownership = new SessionWorktreeStore(join(agentDir, "ownership.json"));
    await ownership.initialize();
    worktrees = new SessionWorktrees(ownership, { publish: () => undefined });
    autonomy = { landStops: true, approveStops: true, reviewRounds: 2 };
    await service.dispose(); service = openService();
    const ref = { id: (await service.start(root)).id, cwd: root };
    await new AgentDirPromptLibrary(agentDir).save({ name: "staged", body: staged });
    const run = await service.runWorkflow(ref, "staged", {}, "staged-auto");
    const finished = await until(async () => {
      const current = (await service.workflowRuns(ref))[0];
      return current?.state.kind === "finished" ? current : false;
    });
    expect(finished.state).toMatchObject({ outcome: "completed", result: "STAGED-DONE" });
    expect(finished.stops?.["contract"]).toMatchObject({ state: "approved", summary: "CONTRACT-SUMMARY", decidedBy: "forgerie" });
    expect(finished.stops?.["land"]).toMatchObject({ state: "approved", decidedBy: "forgerie", landed: [expect.any(String)] });
    expect(git("log", "-1", "--format=%s", "main").trim()).toBe("Child result");
    const logged = (await service.decisions(ref)).filter((decision) => decision.kind === "auto-stop");
    expect(logged.map((decision) => decision.question).sort()).toEqual(["Contract (staged)", "Land (staged)"]);
    expect(logged.every((decision) => decision.by === "forgerie" && decision.runId === run.id)).toBe(true);
  }, 30000);

  it("keeps the land stop waiting for the user when automatic landing conflicts, and tells the agent why", async () => {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, env: sanitizedGitEnv(), encoding: "utf8" });
    git("init", "-b", "main"); git("config", "user.email", "workflow@example.invalid"); git("config", "user.name", "Workflow tests");
    await writeFile(join(root, "base.txt"), "base");
    git("add", "base.txt"); git("commit", "-m", "Initial workspace");
    const ownership = new SessionWorktreeStore(join(agentDir, "ownership.json"));
    await ownership.initialize();
    worktrees = new SessionWorktrees(ownership, { publish: () => undefined });
    // While alpha works in its worktree, main gains a different result.txt, so alpha's branch conflicts at landing.
    modelWork = async () => { await writeFile(join(root, "result.txt"), "MAIN-RESULT"); git("add", "result.txt"); git("commit", "-m", "Main moved"); };
    autonomy = { landStops: true, approveStops: true, reviewRounds: 2 };
    await service.dispose(); service = openService();
    const ref = { id: (await service.start(root)).id, cwd: root };
    await new AgentDirPromptLibrary(agentDir).save({ name: "staged", body: staged });
    await service.runWorkflow(ref, "staged", {}, "staged-auto-conflict");
    const waiting = await until(async () => {
      const current = (await service.workflowRuns(ref))[0];
      return current?.stops?.["land"]?.state === "waiting" && JSON.stringify(await service.messages(ref)).includes("could not pass") ? current : false;
    });
    expect(waiting.state.kind).toBe("running");
    expect(waiting.stops?.["contract"]?.decidedBy).toBe("forgerie");
    expect(waiting.stops?.["land"]?.decidedBy).toBeUndefined();
    expect(git("log", "-1", "--format=%s", "main").trim()).toBe("Main moved");
    expect((await service.decisions(ref)).filter((decision) => decision.kind === "auto-stop")).toHaveLength(1);
    await service.cancelWorkflow(ref, waiting.id);
  }, 30000);

  it("recovers a workflow waiting at a user stop without the live index or starting later work", async () => {
    const ref = { id: (await service.start(root)).id, cwd: root };
    await new AgentDirPromptLibrary(agentDir).save({ name: "staged", body: staged });
    await service.runWorkflow(ref, "staged", {}, "recover-stop");
    const waiting = await until(async () => {
      const run = (await service.workflowRuns(ref))[0];
      return run?.stops?.["contract"]?.state === "waiting" && !(await service.status(ref)).isStreaming ? run : false;
    });
    await service.dispose();
    await rm(join(agentDir, "live.json"));
    service = openService();
    expect(service.activeCount()).toBe(0);
    expect(await service.resumeDurableSessions()).toEqual({ resumed: [ref.id], failed: [] });
    expect(service.activeCount()).toBe(1);
    expect((await service.workflowRuns(ref))[0]?.stops).toEqual(waiting.stops);
    expect((await service.status(ref)).waitingOnYou).toBe(1);
    expect(started).toBe(0);
    expect((await service.workflowRuns(ref))[0]?.children).toEqual([]);
  }, 20_000);

  it("rejects a route it cannot enforce", async () => {
    const ref = { id: (await service.start(root)).id, cwd: root };
    await new AgentDirPromptLibrary(agentDir).save({ name: "broken", body: staged.replace("{ id: land, name: Land, stop: land }", "{ id: land, name: Land, stop: land }\n    - { id: after, name: After }") });
    await expect(service.runWorkflow(ref, "broken", {}, "broken-1")).rejects.toThrow("Land stage land must be the last stage");
  });

  it("associates three parallel children, keeps stopped and failed results, and expires only completed records", async () => {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, env: sanitizedGitEnv(), encoding: "utf8" });
    git("init", "-b", "main"); git("config", "user.email", "workflow@example.invalid"); git("config", "user.name", "Workflow tests");
    await writeFile(join(root, "base.txt"), "base"); git("add", "base.txt"); git("commit", "-m", "Initial workspace");
    const ownership = new SessionWorktreeStore(join(agentDir, "ownership.json")); await ownership.initialize();
    worktrees = new SessionWorktrees(ownership, { publish: () => undefined });
    await service.dispose(); service = openService();
    const ref = { id: (await service.start(root)).id, cwd: root };
    await new AgentDirPromptLibrary(agentDir).save({ name: "experiment", body: definition });
    const first = await service.runWorkflow(ref, "experiment", { task: "parallel" }, "parallel-1");
    await until(() => Promise.resolve(started === 3));
    const beta = (await service.durableChildren(ref)).find((child) => child.name === "beta");
    if (beta === undefined) throw new Error("Missing parallel child");
    await service.stopDurableChild(ref, beta.conversationId);
    const settled = await until(async () => {
      const run = (await service.workflowRuns(ref))[0];
      return run?.children.length === 3 && run.children.every((child) => child.state.kind === "settled" && (child.state.delivered !== false || child.state.deliveryError !== undefined)) ? run : false;
    });
    expect(settled.children.map((child) => child.state.kind === "settled" ? child.state.outcome : "working").sort()).toEqual(["answered", "answered", "stopped"]);
    const stopped = settled.children.find((child) => child.name === "beta")?.state;
    expect(stopped).toMatchObject({ kind: "settled", outcome: "stopped", delivered: "aborted" });
    if (stopped?.kind === "settled") expect(stopped.deliveryError).toBeUndefined();
    await service.finishWorkflow(ref, first.id, "stopped", "Stopped this experiment");
    await until(async () => !(await service.status(ref)).isStreaming);
    const failed = await service.runWorkflow(ref, "experiment", { task: "failure" }, "failure-1");
    await until(async () => {
      const run = (await service.workflowRuns(ref)).find((run) => run.id === failed.id);
      return run?.children[0]?.state.kind === "settled" && run.children[0].state.delivered;
    });
    expect((await service.workflowRuns(ref)).find((run) => run.id === failed.id)?.children[0]?.state).toMatchObject({ outcome: "failed" });
    await service.finishWorkflow(ref, failed.id, "failed", "Child failed");
    await until(async () => !(await service.status(ref)).isStreaming);
    const current = await service.runWorkflow(ref, "experiment", {}, "pending-1");
    await until(async () => {
      const run = (await service.workflowRuns(ref)).find((run) => run.id === current.id);
      return run?.children[0]?.state.kind === "settled" && run.children[0].state.delivered;
    });
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 91 * 86400000);
    expect((await service.workflowRuns(ref)).map((run) => run.id)).toEqual([current.id]);
    await expect(service.runWorkflow(ref, "experiment", { task: "parallel" }, "parallel-1")).rejects.toThrow("receipt expired");
    clock.mockRestore();
    expect((await service.durableChildren(ref)).some((child) => child.name === "alpha")).toBe(true);
    await service.finishWorkflow(ref, current.id, "completed", "Final experiment");
  }, 30000);
});


describe("temporary workflow proposals through Durable sessions and HTTP", () => {
  const propose = async (ref: { id: string; cwd: string }): Promise<WorkflowProposal> => {
    const previous = new Set((await service.workflowProposals(ref)).map((item) => item.id));
    await service.prompt(ref, "PROPOSE");
    return until(async () => {
      const proposals = await service.workflowProposals(ref);
      const proposal = proposals.find((item) => item.state.kind === "open" && !previous.has(item.id));
      return proposal !== undefined && !(await service.status(ref)).isStreaming ? proposal : false;
    });
  };

  it("proposes, counts waiting, replaces, freezes a start, retries, and holds at the first stop without a file", async () => {
    const server = app();
    try {
      const ref = { id: (await service.start(root)).id, cwd: root };
      const first = await propose(ref);
      expect(Check(WorkflowProposalSchema, first)).toBe(true);
      expect(first).toMatchObject({ name: "task-plan", summary: "Build and review this task.", text: staged, inputs: {}, state: { kind: "open" } });
      await until(async () => (await service.status(ref)).waitingOnYou === 1);
      const entry = (await service.messages(ref)).messages.find((message) => Check(Type.Object({ customType: Type.Literal("forgerie.workflow-proposal") }), message));
      expect(entry).toMatchObject({ role: "custom", customType: "forgerie.workflow-proposal", details: { proposalId: first.id, name: first.name, summary: first.summary, stages: first.definition.stages } });
      expect(hub.sessionEvents.some(({ event }) => event.type === "pi.event" && event.eventType === "workflow_runs_changed")).toBe(true);
      const second = await propose(ref);
      const list = await server.inject({ url: `/sessions/${ref.id}/workflow-proposals?cwd=${encodeURIComponent(root)}` });
      expect(list.statusCode).toBe(200);
      expect(list.json()).toMatchObject([{ id: second.id }, { id: first.id, state: { kind: "replaced", by: second.id } }]);
      const url = `/sessions/${ref.id}/workflow-proposals/${second.id}/start`;
      const payload = { cwd: root, inputs: {}, requestId: "proposal-start" };
      const [response, retry] = await Promise.all([server.inject({ method: "POST", url, payload }), server.inject({ method: "POST", url, payload })]);
      expect(response.statusCode).toBe(200);
      expect(retry.statusCode).toBe(200);
      const run = runBody(response.json());
      expect(runBody(retry.json()).id).toBe(run.id);
      expect(run.definition).toMatchObject({ name: second.name, path: `proposal:${second.id}`, text: staged, sha256: second.sha256 });
      expect((await service.workflowProposals(ref))[0]?.state).toMatchObject({ kind: "started", runId: run.id });
      expect((await server.inject({ method: "POST", url, payload: { ...payload, requestId: "other" } })).statusCode).toBe(409);
      expect((await server.inject({ method: "POST", url, payload: { ...payload, inputs: { extra: 1 } } })).statusCode).toBe(409);
      expect((await server.inject({ method: "POST", url: `/sessions/${ref.id}/workflow-proposals/${first.id}/start`, payload })).statusCode).toBe(409);
      await until(async () => (await service.workflowRuns(ref))[0]?.stops?.["contract"]?.state === "waiting");
      await service.prompt(ref, "PROPOSE");
      await until(async () => !(await service.status(ref)).isStreaming && proposalErrors.some((error) => error.includes("active workflow")));
      expect(proposalErrors).toContainEqual(expect.stringContaining("active workflow"));
      expect((await new WorkflowLibrary(agentDir).list(root)).workflows).toEqual([]);
    } finally { await server.close(); }
  });

  it("delivers a changes note once, closes dismissal without waking, and validates decisions and session ownership", async () => {
    const server = app();
    try {
      const ref = { id: (await service.start(root)).id, cwd: root };
      const first = await propose(ref);
      const url = `/sessions/${ref.id}/workflow-proposals/${first.id}`;
      expect((await server.inject({ method: "POST", url: `${url}/changes`, payload: { cwd: root, note: " " } })).statusCode).toBe(400);
      expect((await server.inject({ method: "POST", url: `${url}/dismiss`, payload: { cwd: root, unexpected: true } })).statusCode).toBe(400);
      const foreign = { id: (await service.start(root)).id, cwd: root };
      expect((await server.inject({ method: "POST", url: `/sessions/${foreign.id}/workflow-proposals/${first.id}/dismiss`, payload: { cwd: root } })).statusCode).toBe(404);
      const changes = await server.inject({ method: "POST", url: `${url}/changes`, payload: { cwd: root, note: " Name the columns. " } });
      expect(changes.statusCode).toBe(200);
      expect(changes.json()).toMatchObject({ state: { kind: "changes", note: "Name the columns." } });
      expect((await server.inject({ method: "POST", url: `${url}/changes`, payload: { cwd: root, note: "Name the columns." } })).statusCode).toBe(409);
      const second = await until(async () => (await service.workflowProposals(ref)).find((item) => item.state.kind === "open"));
      await until(async () => !(await service.status(ref)).isStreaming);
      expect(proposalChanges).toBe(1);
      const messages = (await service.messages(ref)).messages;
      expect(messages.filter((message) => Check(Type.Object({ role: Type.Literal("user"), content: Type.Unknown() }), message) && textOf(message.content).includes("asked for changes to the proposal: Name the columns."))).toHaveLength(1);
      const dismissed = await server.inject({ method: "POST", url: `/sessions/${ref.id}/workflow-proposals/${second.id}/dismiss`, payload: { cwd: root } });
      expect(dismissed.statusCode).toBe(200);
      expect(dismissed.json()).toMatchObject({ state: { kind: "dismissed" } });
      await until(async () => ((await service.status(ref)).waitingOnYou ?? 0) === 0);
      expect((await service.status(ref)).isStreaming).toBe(false);
      expect(proposalChanges).toBe(1);
      expect((await server.inject({ method: "POST", url: `/sessions/${ref.id}/workflow-proposals/${second.id}/dismiss`, payload: { cwd: root } })).statusCode).toBe(409);
    } finally { await server.close(); }
  });

  it("has the agent do an open proposal here once, with the plan and inputs, and without a run", async () => {
    const server = app();
    try {
      const ref = { id: (await service.start(root)).id, cwd: root };
      const first = await propose(ref);
      const url = `/sessions/${ref.id}/workflow-proposals/${first.id}/here`;
      expect((await server.inject({ method: "POST", url, payload: { cwd: root } })).statusCode).toBe(400);
      expect((await server.inject({ method: "POST", url, payload: { cwd: root, inputs: { extra: 1 } } })).statusCode).toBe(400);
      const response = await server.inject({ method: "POST", url, payload: { cwd: root, inputs: {} } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ id: first.id, state: { kind: "here" } });
      expect((await server.inject({ method: "POST", url, payload: { cwd: root, inputs: {} } })).statusCode).toBe(409);
      await until(async () => !(await service.status(ref)).isStreaming && ((await service.status(ref)).waitingOnYou ?? 0) === 0);
      const delivered = (await service.messages(ref)).messages.flatMap((message) => Check(Type.Object({ role: Type.Literal("user"), content: Type.Unknown() }), message)
        && textOf(message.content).includes("chose to do this plan here") ? [textOf(message.content)] : []);
      expect(delivered).toHaveLength(1);
      const text = delivered[0] ?? "";
      expect(text).toContain("Do not start or message child agents");
      expect(text).toContain("At each stop (Contract, Land), ask the user in your reply");
      expect(text).toContain("WORKFLOW-STAGED");
      // The route carries the order and each stage's own instructions.
      expect(text).toContain("Route (stages in order):\n1. Contract (id contract) [stop: the user approves]\n2. Build (id build) Workers: alpha (agent nobody-checks-this, model faux/faux-declared).\n3. Land (id land) [stop: the user lands the branches]");
      expect(await service.workflowRuns(ref)).toEqual([]);
    } finally { await server.close(); }
  });

  it("shows the agent the saved workflows and refuses a basis that names none of them", async () => {
    const ref = { id: (await service.start(root)).id, cwd: root };
    await new AgentDirPromptLibrary(agentDir).save({ name: "staged", body: staged });
    const results = async () => (await service.messages(ref)).messages.filter((message) => Check(Type.Object({ role: Type.Literal("toolResult"), toolName: Type.Literal("saved_workflows"), content: Type.Unknown() }), message));
    const toolText = async (prompt: string) => {
      const before = (await results()).length;
      await service.prompt(ref, prompt);
      await until(async () => (await results()).length > before && !(await service.status(ref)).isStreaming);
      return textOf((await results()).at(-1)?.content);
    };
    const listing = await toolText("LIST-SAVED");
    expect(listing).toContain("- staged: A staged experiment");
    expect(listing).toContain("Route: Contract [stop: approve] -> Build (alpha: nobody-checks-this) -> Land [stop: land]");
    expect(await toolText("LIST-SAVED staged")).toContain("WORKFLOW-STAGED");
    proposalBasis = { kind: "saved", name: "missing", changes: "None" };
    await service.prompt(ref, "PROPOSE");
    await until(async () => !(await service.status(ref)).isStreaming && proposalErrors.length > 0);
    expect(proposalErrors).toContainEqual(expect.stringContaining("No saved workflow named missing. Saved: staged."));
    expect(await service.workflowProposals(ref)).toEqual([]);
    proposalBasis = { kind: "saved", name: "staged", changes: "Adds this task's instructions." };
    const proposal = await propose(ref);
    expect(proposal.basis).toEqual({ kind: "saved", name: "staged", changes: "Adds this task's instructions." });
  });

  it("lists no proposals for a session without Durable workflow hosting while POST still refuses", async () => {
    await service.dispose(); service = openService(false);
    const server = app();
    try {
      const ref = { id: (await service.start(root)).id, cwd: root };
      const url = `/sessions/${ref.id}/workflow-proposals`;
      const response = await server.inject({ url: `${url}?cwd=${encodeURIComponent(root)}` });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([]);
      expect((await server.inject({ method: "POST", url: `${url}/p1/start`, payload: { cwd: root, inputs: {}, requestId: "unsupported" } })).statusCode).toBe(404);
      expect((await server.inject({ method: "POST", url: `${url}/p1/changes`, payload: { cwd: root, note: "Revise." } })).statusCode).toBe(404);
      expect((await server.inject({ method: "POST", url: `${url}/p1/dismiss`, payload: { cwd: root } })).statusCode).toBe(404);
    } finally { await server.close(); }
  });

  it("restores an idle open proposal and its waiting count when the session reopens", async () => {
    const ref = { id: (await service.start(root)).id, cwd: root };
    const proposal = await propose(ref);
    const before = await service.messages(ref);
    await service.dispose(); service = openService();
    expect(await service.workflowProposals(ref)).toEqual([proposal]);
    expect((await service.status(ref)).waitingOnYou).toBe(1);
    expect((await service.status(ref)).isStreaming).toBe(false);
    expect(await service.messages(ref)).toEqual(before);
  });

  it.each([
    { text: "No workflow frontmatter", problem: "frontmatter" },
    { text: "---\nworkflow: [broken\n---\nProse", problem: "Flow sequence" },
    { text: `${staged}\n\x60\x60\x60js workflow\nthrow Error('no');\n\x60\x60\x60`, problem: "scripts" },
    { text: definition, inputs: { task: true }, problem: "requires string" },
    { text: staged, inputs: { extra: 1 }, problem: "Unknown workflow input" },
    { text: staged, name: "INVALID", problem: "Validation failed" },
    { text: staged, summary: "x".repeat(281), problem: "Validation failed" },
  ])("returns a tool error for invalid proposal $problem without saving it", async ({ text, inputs, name, summary, problem }) => {
    const ref = { id: (await service.start(root)).id, cwd: root };
    proposalText = text;
    proposalInputs = inputs ?? {};
    proposalName = name ?? "task-plan";
    proposalSummary = summary ?? "Valid overview";
    await service.prompt(ref, "PROPOSE");
    await until(async () => !(await service.status(ref)).isStreaming && proposalErrors.length > 0);
    expect(proposalErrors[0]).toContain(problem);
    expect(await service.workflowProposals(ref)).toEqual([]);
    expect((await service.status(ref)).waitingOnYou ?? 0).toBe(0);
  });

  it("prefills and validates editable inputs, rejects busy and active parents, and recovers frozen provenance", async () => {
    const server = app();
    try {
      const ref = { id: (await service.start(root)).id, cwd: root };
      proposalText = staged.replace("  version: 1", "  version: 1\n  inputs:\n    task: { type: string }\n    review: { type: boolean, default: true }");
      proposalInputs = { task: "Agent's brief" };
      const proposal = await propose(ref);
      expect(proposal.inputs).toEqual({ task: "Agent's brief", review: true });
      const url = `/sessions/${ref.id}/workflow-proposals/${proposal.id}/start`;
      const payload = { cwd: root, inputs: { task: "User's edited brief", review: false }, requestId: "edited" };
      expect((await server.inject({ method: "POST", url, payload: { ...payload, extra: true } })).statusCode).toBe(400);
      expect((await server.inject({ method: "POST", url, payload: { ...payload, inputs: { task: 1 } } })).statusCode).toBe(400);
      expect((await server.inject({ url: `/sessions/${ref.id}/workflow-proposals` })).statusCode).toBe(400);
      const foreign = { id: (await service.start(root)).id, cwd: root };
      expect((await server.inject({ method: "POST", url: `/sessions/${foreign.id}/workflow-proposals/${proposal.id}/start`, payload })).statusCode).toBe(404);
      await service.prompt(ref, "BUSY");
      await until(() => Promise.resolve(hub.sessionEvents.some(({ event }) => event.type === "tool.start" && event.toolName === "bash")));
      const busy = await server.inject({ method: "POST", url, payload });
      expect(busy.statusCode).toBe(409);
      expect(busy.json<{ error: string }>().error).toContain("idle");
      await until(async () => !(await service.status(ref)).isStreaming);
      await new AgentDirPromptLibrary(agentDir).save({ name: "staged", body: staged });
      const active = await service.runWorkflow(ref, "staged", {}, "saved-first");
      const blocked = await server.inject({ method: "POST", url, payload });
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json<{ error: string }>().error).toContain("active workflow");
      expect((await service.workflowProposals(ref))[0]?.state.kind).toBe("open");
      await until(async () => (await service.workflowRuns(ref))[0]?.stops?.["contract"]?.state === "waiting" && !(await service.status(ref)).isStreaming);
      await service.finishWorkflow(ref, active.id, "stopped", "Switch to the task proposal");
      const response = await server.inject({ method: "POST", url, payload });
      expect(response.statusCode).toBe(200);
      const run = runBody(response.json());
      expect(run.inputs).toEqual(payload.inputs);
      expect(run.definition.text).toBe(proposalText);
      await until(async () => (await service.workflowRuns(ref)).find((item) => item.id === run.id)?.stops?.["contract"]?.state === "waiting" && !(await service.status(ref)).isStreaming);
      await service.dispose(); service = openService();
      expect((await service.workflowProposals(ref))[0]?.state).toMatchObject({ kind: "started", runId: run.id });
      expect((await service.startWorkflowProposal(ref, proposal.id, payload.inputs, payload.requestId)).id).toBe(run.id);
      expect((await service.workflowRuns(ref)).find((item) => item.id === run.id)?.definition).toEqual(run.definition);
    } finally { await server.close(); }
  }, 15000);
});
