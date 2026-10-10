import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import Fastify from "fastify";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type FauxResponseFactory } from "@earendil-works/pi-ai/providers/faux";
import { defineTool } from "@earendil-works/pi-durable";
import { Check } from "typebox/value";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, emptyArchiveStore } from "./piSessionService.testSupport.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import { createDurableChildHost, LiveChildSessionIndex } from "./durableChildHost.js";
import { ChildRunStore } from "./childRunStore.js";
import { registerWorkflowRoutes } from "./workflowRoutes.js";
import { DurableChildWorktrees } from "./durableChildWorktrees.js";
import { SessionWorktrees } from "../workspaces/sessionWorktrees.js";
import { SessionWorktreeStore } from "../workspaces/sessionWorktreeStore.js";
import { sanitizedGitEnv } from "../git/gitEnv.js";
import { AgentDirPromptLibrary } from "../resources/promptLibrary.js";
import { ResourceEditorService } from "../resources/resourceEditorService.js";
import { registerPromptLibraryRoutes } from "../resources/promptLibraryRoutes.js";
import { WorkflowRunSchema, type WorkflowRun } from "../../shared/workflowRuns.js";

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
let root = "";
let agentDir = "";
let service: PiSessionService;
let models: ModelRuntime;
let store: ChildRunStore;
let autoComplete = false;
let worktrees: SessionWorktrees | undefined;
let isolate = false;
let started = 0;
let sequence = 0;
const errors: unknown[] = [];
const app = () => {
  const server = Fastify();
  registerPromptLibraryRoutes(server, new AgentDirPromptLibrary(agentDir));
  registerWorkflowRoutes(server, service);
  return server;
};
const textOf = (value: unknown): string => typeof value === "string" ? value : Array.isArray(value) ? value.map((part: { text?: string }) => part.text ?? "").join("") : "";
const work = defineTool({ name: "work", description: "Do a bounded work step", parameters: Type.Object({}), replay: "safe", execute: async () => {
  started++;
  await sleep(700);
  return { content: [{ type: "text" as const, text: "WORK-DONE" }] };
} });
const route: FauxResponseFactory = (context) => {
  const last = [...context.messages].reverse().find((message) => message.role !== "system");
  const said = textOf(last?.content);
  const call = (name: string, args: Record<string, string>) => fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
  const answer = (text: string) => fauxAssistantMessage([fauxText(text)]);
  const workflow = [...context.messages].reverse().find((message) => message.role === "user" && textOf(message.content).includes("WORKFLOW-TEST"));
  const runId = /^Workflow run ([a-f0-9]+)/u.exec(textOf(workflow?.content))?.[1];
  if (last?.role === "toolResult") {
    if (said === "WORK-DONE") return call("write", { path: "result.txt", content: "CHILD-RESULT" });
    if (said.startsWith("Started")) return answer("Waiting for the child.");
    if (said.includes("Wait for")) return runId === undefined ? answer("Cannot finish") : call("workflow_finish", { runId, outcome: "completed", result: "REVIEWED-RESULT" });
    return answer("Done.");
  }
  if (said.startsWith("[subagent")) return autoComplete && runId !== undefined ? call("workflow_finish", { runId, outcome: "completed", result: "REVIEWED-RESULT" }) : answer("Reviewed. Await explicit finish.");
  if (said === "FAIL-CHILD") return fauxAssistantMessage("", { stopReason: "error", errorMessage: "Controlled workflow child failure" });
  if (said.startsWith("CHILD-TASK")) return fauxAssistantMessage([fauxToolCall("work", {})], { stopReason: "toolUse" });
  if (said.includes("WORKFLOW-TEST")) {
    if (said.includes('"task":"parallel"')) return fauxAssistantMessage(["alpha", "beta", "gamma"].map((name) => fauxToolCall("child_agent", { action: "spawn", name, message: "CHILD-TASK" })), { stopReason: "toolUse" });
    return call("child_agent", { action: "spawn", name: `writer${String(++sequence)}`, message: said.includes('"task":"failure"') ? "FAIL-CHILD" : "CHILD-TASK", ...(isolate ? { isolation: "worktree" } : {}) });
  }
  return answer("Session title");
};
function openService(): PiSessionService {
  return new PiSessionService(new CapturingSessionEventHub(), { agentDir, modelRuntime: models,
    sessionManager: createPiSessionManagerGateway({ agentDir, env: { HOME: root }, sessionDirEnvKeys: [] }), archiveStore: emptyArchiveStore(), heartbeatIntervalMs: 60000,
    durableChildAgents: createDurableChildHost({ extraTools: [work], index: new LiveChildSessionIndex(join(agentDir, "live.json")), runRecords: store, onRunRecordError: (error) => { errors.push(error); }, ...(worktrees === undefined ? {} : { worktrees }) }),
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
  errors.length = 0; started = 0; sequence = 0; autoComplete = false; worktrees = undefined; isolate = false;
  root = await mkdtemp(join(tmpdir(), "forgerie-workflow-runs-"));
  agentDir = join(root, "agent");
  await mkdir(agentDir);
  store = new ChildRunStore(join(agentDir, "child-runs.json"));
  models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
  const provider = fauxProvider({ tokensPerSecond: 600 });
  models.registerNativeProvider(provider.provider);
  provider.setResponses(Array.from({ length: 300 }, () => route));
  service = openService();
});
afterEach(async () => { vi.restoreAllMocks(); await service.dispose(); await rm(root, { recursive: true, force: true }); expect(errors).toEqual([]); });

describe("saved prose workflows through production Durable sessions and HTTP", () => {
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
      const recovery = await service.resumeDurableChildren(await new LiveChildSessionIndex(join(agentDir, "live.json")).list());
      expect(recovery.resumed).toContain(ref.id);
      expect(recovery.failed).toEqual([]);
      expect(runBody((await server.inject({ method: "POST", url, payload })).json()).id).toBe(first.id);
      const completedChild = await until(async () => {
        const run = (await service.workflowRuns(ref))[0];
        return run?.children[0]?.state.kind === "settled" && run.children[0].state.delivered ? run : false;
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

  it("associates three parallel children, keeps stopped and failed results, and expires only completed records", async () => {
    const ref = { id: (await service.start(root)).id, cwd: root };
    await new AgentDirPromptLibrary(agentDir).save({ name: "experiment", body: definition });
    const first = await service.runWorkflow(ref, "experiment", { task: "parallel" }, "parallel-1");
    await until(() => Promise.resolve(started === 3));
    const beta = (await service.durableChildren(ref)).find((child) => child.name === "beta");
    if (beta === undefined) throw new Error("Missing parallel child");
    await service.stopDurableChild(ref, beta.conversationId);
    const settled = await until(async () => {
      const run = (await service.workflowRuns(ref))[0];
      return run?.children.length === 3 && run.children.every((child) => child.state.kind === "settled" && (child.state.delivered || child.state.deliveryError !== undefined)) ? run : false;
    });
    expect(settled.children.map((child) => child.state.kind === "settled" ? child.state.outcome : "working").sort()).toEqual(["answered", "answered", "stopped"]);
    const stopped = settled.children.find((child) => child.name === "beta")?.state;
    expect(stopped).toMatchObject({ kind: "settled", outcome: "stopped", delivered: false });
    if (stopped?.kind === "settled") expect(stopped.deliveryError).toBeTruthy();
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
