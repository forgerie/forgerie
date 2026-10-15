import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectService } from "../projects/projectService.js";
import { ProjectStore } from "../storage/projectStore.js";
import { WorkflowLibrary } from "../resources/workflowLibrary.js";
import { RegisteredProjectWorkspaceCwds } from "../workspaces/projectWorkspaceCwds.js";
import { WorkspaceService } from "../workspaces/workspaceService.js";
import { TriggerService } from "./triggerService.js";

let root: string;
let cwd: string;
let service: TriggerService;
let fires = 0;
const input = () => ({ id: "nightly", name: "Night", schedule: { kind: "daily", at: "03:00", timezone: "UTC" }, action: { kind: "workflow", targets: { kind: "projects", cwds: [cwd] }, workflow: "nightly", inputs: {} } });
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "trigger-workspace-boundary-"));
  cwd = join(root, "registered");
  await mkdir(cwd);
  const agentDir = join(root, "agent");
  await mkdir(join(agentDir, "prompts"), { recursive: true });
  await writeFile(join(agentDir, "prompts", "nightly.md"), "---\nworkflow: { version: 1 }\n---\nReview the task.\n");
  const projects = new ProjectService(new ProjectStore(join(root, "projects.json")));
  await projects.add({ path: cwd });
  fires = 0;
  service = await TriggerService.open({ env: { PI_WEB_DATA_DIR: root }, fileSync: { watch: () => ({ close: () => undefined }) }, workflows: new WorkflowLibrary(agentDir), workspaces: new RegisteredProjectWorkspaceCwds({ projects, workspaces: new WorkspaceService() }),
    fire: (request) => { fires++; return Promise.resolve({ sessionId: "session", cwd: request.action.cwd, runId: request.requestId }); }, publish: () => undefined, onError: (error) => { throw error; },
  });
});
afterEach(async () => { await service.close(); await rm(root, { recursive: true, force: true }); });

it.each(["create", "update"])("refuses a real symlink escape at %s", async (operation) => {
  const outside = join(root, "outside");
  await mkdir(join(outside, "child"), { recursive: true });
  await symlink(join(outside, "child"), join(cwd, "link"));
  const escaped = `${cwd}/link/..`;
  if (operation === "update") await service.create(input());
  const value = { ...input(), action: { ...input().action, targets: { kind: "projects", cwds: [escaped] } } };
  await expect(operation === "create" ? service.create(value) : service.update("nightly", { baseRevision: 1, action: value.action })).rejects.toMatchObject({ status: 400, field: "action.targets.cwds" });
  expect(fires).toBe(0);
});

it.each(["create", "update"])("refuses a removed registered root at %s", async (operation) => {
  if (operation === "update") await service.create(input());
  await rm(cwd, { recursive: true });
  await expect(operation === "create" ? service.create(input()) : service.update("nightly", { baseRevision: 1, action: input().action })).rejects.toMatchObject({ status: 400, field: "action.targets.cwds" });
});

it("stores a canonical directory at create and update, not its symlink alias", async () => {
  const alias = join(root, "alias"); await symlink(cwd, alias);
  const created = await service.create({ ...input(), action: { ...input().action, targets: { kind: "projects", cwds: [alias] } } });
  expect(created.action.targets).toEqual({ kind: "projects", cwds: [cwd] });
  const updated = await service.update("nightly", { baseRevision: 1, action: { ...input().action, targets: { kind: "projects", cwds: [`${alias}/.`] } } });
  expect(updated.action.targets).toEqual({ kind: "projects", cwds: [cwd] });
});

it.each(["symlink escape", "removed root"])("records a failed fire, without firing, after a %s", async (change) => {
  await service.create(input());
  await service.pause("nightly");
  if (change === "removed root") await rm(cwd, { recursive: true });
  else {
    const outside = join(root, "outside"); await mkdir(outside);
    await rename(cwd, join(root, "old-root")); await symlink(outside, cwd);
  }
  await service.run("nightly", { requestId: "boundary" });
  await vi.waitFor(async () => { expect((await service.get("nightly")).history[0]?.outcome.kind).toBe("failed"); });
  expect(fires).toBe(0);
  expect((await service.get("nightly")).attention).not.toBeNull();
});

it("starts target projects concurrently, isolates failure, and deduplicates Run now", async () => {
  const other = join(root, "other"); await mkdir(other);
  const projects = new ProjectService(new ProjectStore(join(root, "projects.json"))); await projects.add({ path: other });
  await service.close();
  const entered: string[] = []; let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  service = await TriggerService.open({ env: { PI_WEB_DATA_DIR: root }, fileSync: { watch: () => ({ close: () => undefined }) }, workflows: new WorkflowLibrary(join(root, "agent")), workspaces: new RegisteredProjectWorkspaceCwds({ projects, workspaces: new WorkspaceService() }),
    fire: async (request) => { entered.push(request.action.cwd); await held; if (request.action.cwd === other) throw new Error("quota"); return { sessionId: "ok", cwd, runId: request.requestId }; }, publish: () => undefined, onError: (error) => { throw error; },
  });
  await service.create({ ...input(), action: { kind: "workflow", targets: { kind: "projects", cwds: [cwd, other, cwd] }, workflow: "nightly", inputs: {} } });
  await service.run("nightly", { requestId: "partial" });
  await vi.waitFor(() => { expect(entered).toEqual([cwd, other]); });
  expect((await service.get("nightly")).history[0]?.projects.every((project) => project.outcome.kind === "running")).toBe(true);
  release();
  await vi.waitFor(async () => { expect((await service.get("nightly")).history[0]?.outcome.kind).toBe("failed"); });
  expect((await service.get("nightly")).history[0]?.projects).toMatchObject([{ cwd, outcome: { kind: "started" } }, { cwd: other, outcome: { kind: "failed", error: "quota" } }]);
  expect((await service.get("nightly")).attention).not.toBeNull();
  await service.run("nightly", { requestId: "partial" }); expect(entered).toHaveLength(2);
  await service.run("nightly", { requestId: "one", cwd });
  await vi.waitFor(() => { expect(entered).toHaveLength(3); });
  expect(entered[2]).toBe(cwd);
  await expect(service.run("nightly", { requestId: "outside", cwd: root })).rejects.toMatchObject({ status: 400, field: "cwd" });
});

it("All projects includes later registrations and skips unavailable projects without attention", async () => {
  await service.create({ ...input(), action: { kind: "workflow", targets: { kind: "all" }, workflow: "nightly", inputs: {} } });
  const projects = new ProjectService(new ProjectStore(join(root, "projects.json")));
  const other = join(root, "other"); await mkdir(other); await projects.add({ path: other }); await rm(other, { recursive: true });
  await service.run("nightly", { requestId: "all" });
  await vi.waitFor(async () => { expect((await service.get("nightly")).history[0]?.outcome.kind).toBe("started"); });
  expect((await service.get("nightly")).history[0]?.projects).toMatchObject([{ cwd, outcome: { kind: "started" } }, { cwd: other, outcome: { kind: "unavailable" } }]);
  expect((await service.get("nightly")).attention).toBeNull(); expect(fires).toBe(1);
});

it("common workflows require prose and identical inputs after project overrides", async () => {
  const projects = new ProjectService(new ProjectStore(join(root, "projects.json")));
  const other = join(root, "other"); await mkdir(join(other, ".pi", "prompts"), { recursive: true }); await projects.add({ path: other });
  expect((await service.commonWorkflows({ kind: "all" })).workflows.map((workflow) => workflow.name)).toEqual(["nightly"]);
  await writeFile(join(other, ".pi", "prompts", "nightly.md"), "---\nworkflow: { version: 1, inputs: { task: { type: string } } }\n---\nReview.\n");
  const different = await service.commonWorkflows({ kind: "projects", cwds: [cwd, other] });
  expect(different.workflows).toEqual([]); expect(different.diagnostics[0]?.name).toBe("nightly"); expect(different.diagnostics[0]?.error).toContain("input declarations");
  await writeFile(join(other, ".pi", "prompts", "nightly.md"), "---\nworkflow: { version: 1 }\n---\n```js workflow\nreturn 1\n```\n");
  const script = await service.commonWorkflows({ kind: "all" });
  expect(script.workflows).toEqual([]); expect(script.diagnostics[0]?.name).toBe("nightly"); expect(script.diagnostics[0]?.error).toContain("prose");
});

it("agent scope hides and refuses every multi-project or All trigger", async () => {
  const projects = new ProjectService(new ProjectStore(join(root, "projects.json"))); const other = join(root, "other"); await mkdir(other); await projects.add({ path: other });
  for (const targets of [{ kind: "all" }, { kind: "projects", cwds: [cwd, other] }]) {
    const record = await service.create({ ...input(), id: undefined, action: { kind: "workflow", targets, workflow: "nightly", inputs: {} } });
    expect((await service.list(cwd)).triggers).toEqual([]);
    for (const operation of [() => service.get(record.id, cwd), () => service.pause(record.id, cwd), () => service.resume(record.id, cwd), () => service.remove(record.id, cwd), () => service.run(record.id, { requestId: "agent" }, cwd), () => service.update(record.id, { baseRevision: record.revision, name: "Changed" }, cwd)]) {
      await expect(operation()).rejects.toMatchObject({ status: 400 });
    }
    await expect(service.create({ ...input(), id: `agent-${record.id}`, action: { kind: "workflow", targets, workflow: "nightly", inputs: {} } }, { kind: "user" }, cwd)).rejects.toMatchObject({ status: 400 });
    await service.remove(record.id);
  }
});

it.each(["missing workflow", "not a directory"])("All records %s as unavailable", async (change) => {
  await service.create({ ...input(), action: { kind: "workflow", targets: { kind: "all" }, workflow: "nightly", inputs: {} } });
  const projects = new ProjectService(new ProjectStore(join(root, "projects.json")));
  const other = join(root, "other"); await mkdir(other); await projects.add({ path: other });
  if (change === "missing workflow") {
    await mkdir(join(other, ".pi", "prompts"), { recursive: true });
    await writeFile(join(other, ".pi", "prompts", "nightly.md"), "An ordinary prompt shadows the global workflow.\n");
  } else { await rm(other, { recursive: true }); await writeFile(other, "Not a folder"); }
  await service.run("nightly", { requestId: "skip" });
  await vi.waitFor(async () => { expect((await service.get("nightly")).history[0]?.outcome.kind).toBe("started"); });
  expect((await service.get("nightly")).history[0]?.projects[1]?.outcome.kind).toBe("unavailable");
  expect((await service.get("nightly")).attention).toBeNull();
});

it("All execution failures set attention, unlike unavailable preflight failures", async () => {
  await service.close();
  const projects = new ProjectService(new ProjectStore(join(root, "projects.json")));
  service = await TriggerService.open({ env: { PI_WEB_DATA_DIR: root }, fileSync: { watch: () => ({ close: () => undefined }) }, workflows: new WorkflowLibrary(join(root, "agent")), workspaces: new RegisteredProjectWorkspaceCwds({ projects, workspaces: new WorkspaceService() }),
    fire: () => Promise.reject(new Error("quota")), publish: () => undefined, onError: (error) => { throw error; },
  });
  await service.create({ ...input(), action: { kind: "workflow", targets: { kind: "all" }, workflow: "nightly", inputs: {} } });
  await service.run("nightly", { requestId: "all-quota" });
  await vi.waitFor(async () => { expect((await service.get("nightly")).history[0]?.outcome.kind).toBe("failed"); });
  expect((await service.get("nightly")).attention).not.toBeNull();
});

it.each(["projects", "all"])("a single-project Run now records the gone target under %s", async (kind) => {
  await service.create({ ...input(), action: { kind: "workflow", targets: kind === "all" ? { kind } : { kind, cwds: [cwd] }, workflow: "nightly", inputs: {} } });
  await rm(cwd, { recursive: true });
  await service.run("nightly", { requestId: "gone-one", cwd });
  await vi.waitFor(async () => { expect((await service.get("nightly")).history[0]?.outcome.kind).toBe(kind === "all" ? "unavailable" : "failed"); });
  expect((await service.get("nightly")).history[0]?.projects[0]?.cwd).toBe(cwd);
  expect((await service.get("nightly")).attention === null).toBe(kind === "all");
});
