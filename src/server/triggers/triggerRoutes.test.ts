import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { Check } from "typebox/value";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TriggerSchema, TriggerListResponseSchema, TriggerWorkflowsResponseSchema, TriggerErrorResponseSchema, TriggerRunResponseSchema, type Trigger } from "../../shared/triggers.js";
import { parseTriggerSchedule } from "../../shared/triggerSchedules.js";
import { WorkflowLibrary } from "../resources/workflowLibrary.js";
import { ProjectService } from "../projects/projectService.js";
import { ProjectStore } from "../storage/projectStore.js";
import { WorkspaceService } from "../workspaces/workspaceService.js";
import { RegisteredProjectWorkspaceCwds } from "../workspaces/projectWorkspaceCwds.js";
import { SessionDaemonClient } from "../../sessiond/sessionDaemonClient.js";
import { registerSessionProxyRoutes } from "../sessiond/sessionProxyRoutes.js";
import { TriggerService } from "./triggerService.js";
import { registerTriggerRoutes } from "./triggerRoutes.js";

let root: string;
let cwd: string;
let service: TriggerService;
let daemon: FastifyInstance;
let edge: FastifyInstance;
let base: string;
let changes = 0;
let fires = 0;
let options: Parameters<typeof TriggerService.open>[0];
const prose = "---\ndescription: Nightly task\nworkflow:\n  version: 1\n  inputs:\n    task: { type: string, default: baseline }\n  stages:\n    - { id: land, name: Land, stop: land }\n---\nReview the task, then stop at land.\n";
const create = () => ({ name: "Nightly refinement", schedule: { kind: "daily", at: "03:00", timezone: "UTC" }, action: { kind: "workflow", targets: { kind: "projects", cwds: [cwd] }, workflow: "nightly", inputs: {} } });
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "forgerie-trigger-http-"));
  cwd = join(root, "workspace");
  await mkdir(join(cwd, ".pi", "prompts"), { recursive: true });
  await writeFile(join(cwd, ".pi", "prompts", "nightly.md"), prose);
  await writeFile(join(cwd, ".pi", "prompts", "script.md"), prose + "\n```js workflow\nreturn 1\n```\n");
  await writeFile(join(cwd, ".pi", "prompts", "broken.md"), "---\nworkflow: nope\n---\nBad\n");
  const projects = new ProjectService(new ProjectStore(join(root, "projects.json")));
  await projects.add({ path: cwd });
  changes = 0; fires = 0;
  options = { env: { PI_WEB_DATA_DIR: root }, workflows: new WorkflowLibrary(join(root, "agent")), workspaces: new RegisteredProjectWorkspaceCwds({ projects, workspaces: new WorkspaceService() }),
    fire: (request) => { fires++; return Promise.resolve({ sessionId: "session", cwd, runId: request.requestId }); },
    publish: () => { changes++; }, onError: () => undefined,
  };
  service = await TriggerService.open(options);
  daemon = Fastify();
  registerTriggerRoutes(daemon, service);
  const address = await daemon.listen({ port: 0, host: "127.0.0.1" });
  edge = Fastify(); await edge.register(websocket);
  vi.stubEnv("PI_WEB_SESSIOND_URL", address);
  registerSessionProxyRoutes(edge, new SessionDaemonClient());
  base = await edge.listen({ port: 0, host: "127.0.0.1" });
});
afterEach(async () => { await edge.close(); await daemon.close(); await service.close(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });
async function http(method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}/api/triggers${path}`, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
  const value: unknown = await response.json();
  return { status: response.status, value };
}
async function created(): Promise<Trigger> {
  const result = await http("POST", "", create());
  expect(result.status).toBe(201);
  if (!Check(TriggerSchema, result.value)) throw new Error("Invalid trigger response");
  return result.value;
}

it("lists workflows without any session, including scripts, inputs, land stops and diagnostics", async () => {
  const result = await http("GET", `/workflows?cwd=${encodeURIComponent(cwd)}`);
  expect(result.status).toBe(200);
  expect(Check(TriggerWorkflowsResponseSchema, result.value)).toBe(true);
  expect(result.value).toMatchObject({ workflows: [{ name: "nightly", kind: "prose", inputs: { task: { type: "string", default: "baseline" } }, hasLandStop: true }, { name: "script", kind: "script" }], diagnostics: [{ name: "broken" }] });
  expect(await http("GET", "/workflows?cwd=/unknown")).toMatchObject({ status: 400, value: { field: "action.targets.cwds" } });
  expect(await http("GET", "/workflows?cwd=relative")).toMatchObject({ status: 400 });
});

it("creates, detects revision conflicts, re-arms edits, pauses, resumes, acknowledges and deletes", async () => {
  const trigger = await created();
  expect(trigger).toMatchObject({ id: "nightly-refinement", revision: 1, createdBy: { kind: "user" }, attention: null });
  const update = await http("PATCH", `/${trigger.id}`, { baseRevision: 1, name: "Updated", schedule: { kind: "daily", at: "04:00", timezone: "UTC" } });
  expect(update).toMatchObject({ status: 200, value: { name: "Updated", revision: 2 } });
  const conflict = await http("PATCH", `/${trigger.id}`, { baseRevision: 1, name: "stale" });
  expect(conflict).toMatchObject({ status: 409, value: { field: "baseRevision" } });
  expect(JSON.stringify(conflict.value)).toContain("revision is 2");
  expect(await http("POST", `/${trigger.id}/pause`, {})).toMatchObject({ status: 200, value: { state: { kind: "paused" }, revision: 3 } });
  expect(await http("POST", `/${trigger.id}/pause`, {})).toMatchObject({ value: { revision: 3 } });
  expect(await http("POST", `/${trigger.id}/resume`, {})).toMatchObject({ value: { state: { kind: "active" }, revision: 4 } });
  expect(await http("POST", `/${trigger.id}/acknowledge`, {})).toMatchObject({ value: { attention: null } });
  expect(await http("DELETE", `/${trigger.id}`)).toEqual({ status: 200, value: { ok: true } });
  expect(await http("GET", `/${trigger.id}`)).toMatchObject({ status: 404 });
  expect(changes).toBeGreaterThanOrEqual(5);
});

it.each([
  ["name", { name: "" }], ["name", { name: "   " }], ["schedule.at", { schedule: { kind: "daily", at: "25:00", timezone: "UTC" } }],
  ["schedule.at", { schedule: { kind: "weekly", on: ["mon"], at: "25:00", timezone: "UTC" } }],
  ["schedule.timezone", { schedule: { kind: "daily", at: "03:00", timezone: "Nowhere/Here" } }],
  ["action.targets.cwds", { action: { kind: "workflow", targets: { kind: "projects", cwds: ["/unknown"] }, workflow: "nightly", inputs: {} } }],
  ["action.workflow", { action: { kind: "workflow", targets: { kind: "projects", cwds: ["CURRENT"] }, workflow: "script", inputs: {} } }],
  ["action.workflow", { action: { kind: "workflow", targets: { kind: "projects", cwds: ["CURRENT"] }, workflow: "missing", inputs: {} } }],
  ["action.inputs", { action: { kind: "workflow", targets: { kind: "projects", cwds: ["CURRENT"] }, workflow: "nightly", inputs: { task: 9 } } }],
  ["action.model", { action: { kind: "workflow", targets: { kind: "projects", cwds: ["CURRENT"] }, workflow: "nightly", inputs: {}, model: "not-a-model" } }],
])("returns a field error for %s", async (field, invalid) => {
  const input: unknown = JSON.parse(JSON.stringify({ ...create(), ...invalid }).replaceAll("CURRENT", cwd));
  const result = await http("POST", "", input);
  expect(result.status).toBe(400);
  expect(Check(TriggerErrorResponseSchema, result.value)).toBe(true);
  expect(result.value).toMatchObject({ field });
});

it("refuses extra fields, invalid operations, duplicate IDs and malformed JSON", async () => {
  expect(await http("POST", "", { ...create(), extra: true })).toMatchObject({ status: 400 });
  expect(await http("POST", "/constructor/pause", {})).toMatchObject({ status: 404 });
  const trigger = await created();
  expect(await http("POST", "", { ...create(), id: trigger.id })).toMatchObject({ status: 409 });
  expect(await http("PATCH", `/${trigger.id}`, { name: "no revision" })).toMatchObject({ status: 400, value: { field: "baseRevision" } });
  expect(await http("DELETE", `/${trigger.id}`, { extra: true })).toMatchObject({ status: 400, value: { field: "extra" } });
  for (const operation of ["pause", "resume", "acknowledge", "run"]) expect(await http("POST", `/${trigger.id}/${operation}`, { extra: true })).toMatchObject({ status: 400 });
  expect(await http("POST", `/${trigger.id}/run`, { requestId: "bad_id" })).toMatchObject({ status: 400 });
  const response = await fetch(`${base}/api/triggers`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
  expect(response.status).toBe(400);
  const malformed: unknown = await response.json();
  expect(Check(TriggerErrorResponseSchema, malformed)).toBe(true);
});

it("deduplicates manual requests while paused without moving the next fire and bounds list history", async () => {
  const trigger = await created();
  const before = (await service.get(trigger.id)).state;
  await http("POST", `/${trigger.id}/run`, { requestId: "active" });
  await vi.waitFor(async () => { expect((await service.get(trigger.id)).history[0]?.outcome.kind).toBe("started"); });
  expect((await service.get(trigger.id)).state).toEqual(before);
  await http("POST", `/${trigger.id}/pause`, {});
  for (let index = 0; index < 55; index++) {
    const result = await http("POST", `/${trigger.id}/run`, { requestId: String(index) });
    expect(result.status).toBe(202);
    if (!Check(TriggerRunResponseSchema, result.value)) throw new Error("Invalid run response");
    const requestId = result.value.requestId;
    await vi.waitFor(async () => { const record = await service.get(trigger.id); expect(record.history.filter((entry) => entry.outcome.kind === "started")).toHaveLength(Math.min(index + 2, 50)); expect(record.history[0]?.requestId).toBe(requestId); expect(record.history[0]?.outcome.kind).toBe("started"); });
  }
  await http("POST", `/${trigger.id}/run`, { requestId: "0" });
  expect(fires).toBe(56);
  expect((await service.get(trigger.id)).state.kind).toBe("paused");
  expect(before.kind).toBe("active");
  const list = await http("GET", "");
  if (!Check(TriggerListResponseSchema, list.value)) throw new Error("Invalid list");
  expect(list.value.triggers[0]?.history).toHaveLength(7);
  const detail = await http("GET", `/${trigger.id}`);
  if (!Check(TriggerSchema, detail.value)) throw new Error("Invalid detail");
  expect(detail.value.history).toHaveLength(50);
  expect(list.value.timezones).toContain("UTC");
  expect(list.value.timezones).toEqual([...new Set(list.value.timezones)].sort());
  for (const timezone of list.value.timezones) expect(() => parseTriggerSchedule({ kind: "daily", at: "03:00", timezone })).not.toThrow();
});

it("fails only trigger calls with 503 when another daemon owns the store", async () => {
  const unavailable = await TriggerService.open(options);
  try { await expect(unavailable.list()).rejects.toMatchObject({ status: 503 }); } finally { await unavailable.close(); }
  await service.close();
  expect(await http("GET", "")).toMatchObject({ status: 503 });
});

it.each([
  ["GET", "", "list"], ["GET", "/night", "get"], ["GET", "/workflows?cwd=/workspace", "workflows"],
  ["POST", "", "create"], ["PATCH", "/night", "update"], ["POST", "/night/pause", "pause"],
  ["POST", "/night/resume", "resume"], ["POST", "/night/acknowledge", "acknowledge"], ["POST", "/night/run", "run"],
])("refuses a malformed %s %s response before sending", async (method, path, operation) => {
  const server = Fastify();
  const adapted = {
    list: () => service.list(), get: (id: string) => service.get(id), commonWorkflows: (targets: Parameters<TriggerService["commonWorkflows"]>[0]) => service.commonWorkflows(targets), workflows: (path: string) => service.workflows(path),
    create: (value: unknown) => service.create(value), update: (id: string, value: unknown) => service.update(id, value),
    pause: (id: string) => service.pause(id), resume: (id: string) => service.resume(id), acknowledge: (id: string) => service.acknowledge(id),
    run: (id: string, value: unknown) => service.run(id, value), remove: (id: string) => service.remove(id),
    [operation]: () => Promise.resolve({ unexpected: "payload" }),
  };
  registerTriggerRoutes(server, adapted);
  const address = await server.listen({ port: 0, host: "127.0.0.1" });
  try {
    const response = await fetch(`${address}/triggers${path}`, { method, ...(method === "GET" ? {} : { headers: { "content-type": "application/json" }, body: "{}" }) });
    expect(response.status).toBe(500);
    const value: unknown = await response.json();
    expect(Check(TriggerErrorResponseSchema, value)).toBe(true);
    expect(value).not.toHaveProperty("unexpected");
  } finally { await server.close(); }
});

it("does not send an invalid error envelope", async () => {
  const server = Fastify();
  const { TriggerError } = await import("./durableTriggers.js");
  const error = new TriggerError("Invalid field", 400, "action.cwd");
  Object.defineProperty(error, "field", { value: 42 });
  const adapted = {
    list: () => Promise.reject(error), get: (id: string) => service.get(id), commonWorkflows: (targets: Parameters<TriggerService["commonWorkflows"]>[0]) => service.commonWorkflows(targets), workflows: (path: string) => service.workflows(path),
    create: (value: unknown) => service.create(value), update: (id: string, value: unknown) => service.update(id, value),
    pause: (id: string) => service.pause(id), resume: (id: string) => service.resume(id), acknowledge: (id: string) => service.acknowledge(id),
    run: (id: string, value: unknown) => service.run(id, value), remove: (id: string) => service.remove(id),
  };
  registerTriggerRoutes(server, adapted);
  const address = await server.listen({ port: 0, host: "127.0.0.1" });
  try {
    const response = await fetch(`${address}/triggers`);
    expect(response.status).toBe(500);
    const value: unknown = await response.json();
    expect(Check(TriggerErrorResponseSchema, value)).toBe(true);
  } finally { await server.close(); }
});

it("serves common workflows and runs just the requested project through the browser proxy", async () => {
  const other = join(root, "second");
  await mkdir(join(other, ".pi", "prompts"), { recursive: true });
  await writeFile(join(other, ".pi", "prompts", "nightly.md"), prose);
  const projects = new ProjectService(new ProjectStore(join(root, "projects.json"))); await projects.add({ path: other });
  const targets = { kind: "projects", cwds: [cwd, other] };
  const common = await http("POST", "/workflows/common", targets);
  expect(common.status).toBe(200); expect(Check(TriggerWorkflowsResponseSchema, common.value)).toBe(true);
  expect(common.value).toMatchObject({ workflows: [{ name: "nightly", kind: "prose" }] });
  expect(await http("POST", "/workflows/common", { kind: "all" })).toMatchObject({ status: 200, value: { workflows: [{ name: "nightly" }] } });
  expect(await http("POST", "/workflows/common", { kind: "projects", cwds: [] })).toMatchObject({ status: 400 });
  const made = await http("POST", "", { ...create(), action: { ...create().action, targets } });
  expect(made.status).toBe(201);
  if (!Check(TriggerSchema, made.value)) throw new Error("Invalid trigger");
  const id = made.value.id;
  const accepted = await http("POST", `/${id}/run`, { requestId: "single", cwd: other });
  expect(accepted.status).toBe(202);
  await vi.waitFor(async () => { expect((await service.get(id)).history[0]?.outcome.kind).toBe("started"); });
  expect((await service.get(id)).history[0]?.projects.map((project) => project.cwd)).toEqual([other]);
  expect(fires).toBe(1);
  expect(await http("POST", `/${id}/run`, { requestId: "outside", cwd: root })).toMatchObject({ status: 400, value: { field: "cwd" } });
});

it("common-workflow diagnostics compare available copies when the first target lacks it", async () => {
  const projects = new ProjectService(new ProjectStore(join(root, "projects.json")));
  const second = join(root, "second");
  const third = join(root, "third");
  for (const target of [second, third]) {
    await mkdir(join(target, ".pi", "prompts"), { recursive: true });
    await writeFile(join(target, ".pi", "prompts", "nightly.md"), prose);
    await projects.add({ path: target });
  }
  await writeFile(join(cwd, ".pi", "prompts", "nightly.md"), "An ordinary prompt, not a workflow.\n");
  const missing = { name: "nightly", path: cwd, error: `Workflow is unavailable in ${cwd}` };
  for (const cwds of [[cwd, second], [cwd, second, third]]) {
    const result = await http("POST", "/workflows/common", { kind: "projects", cwds });
    expect(result.status).toBe(200);
    if (!Check(TriggerWorkflowsResponseSchema, result.value)) throw new Error("Invalid common-workflow response");
    expect(result.value.workflows).toEqual([]);
    expect(result.value.diagnostics.filter((problem) => problem.name === "nightly")).toEqual([missing]);
  }
  await writeFile(join(third, ".pi", "prompts", "nightly.md"), prose.replace("default: baseline", "default: different"));
  const result = await http("POST", "/workflows/common", { kind: "projects", cwds: [cwd, second, third] });
  expect(result.status).toBe(200);
  if (!Check(TriggerWorkflowsResponseSchema, result.value)) throw new Error("Invalid common-workflow response");
  const problems = result.value.diagnostics.filter((problem) => problem.name === "nightly");
  expect(problems).toHaveLength(2);
  expect(problems[0]).toEqual(missing);
  expect(problems[1]?.path).toBe(join(third, ".pi", "prompts", "nightly.md"));
  expect(problems[1]?.error).toContain("input declarations differ");
  expect(problems[1]?.error).toContain(second);
  expect(problems[1]?.error).toContain(third);
  expect(problems[1]?.error).not.toContain(cwd);
});
