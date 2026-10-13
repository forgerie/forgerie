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
const input = () => ({ id: "night", name: "Night", schedule: { kind: "daily", at: "03:00", timezone: "UTC" }, action: { kind: "workflow", cwd, workflow: "nightly", inputs: {} } });
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
  service = await TriggerService.open({ env: { PI_WEB_DATA_DIR: root }, workflows: new WorkflowLibrary(agentDir), workspaces: new RegisteredProjectWorkspaceCwds({ projects, workspaces: new WorkspaceService() }),
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
  const value = { ...input(), action: { ...input().action, cwd: escaped } };
  await expect(operation === "create" ? service.create(value) : service.update("night", { baseRevision: 1, action: value.action })).rejects.toMatchObject({ status: 400, field: "action.cwd" });
  expect(fires).toBe(0);
});

it.each(["create", "update"])("refuses a removed registered root at %s", async (operation) => {
  if (operation === "update") await service.create(input());
  await rm(cwd, { recursive: true });
  await expect(operation === "create" ? service.create(input()) : service.update("night", { baseRevision: 1, action: input().action })).rejects.toMatchObject({ status: 400, field: "action.cwd" });
});

it("stores a canonical directory at create and update, not its symlink alias", async () => {
  const alias = join(root, "alias"); await symlink(cwd, alias);
  const created = await service.create({ ...input(), action: { ...input().action, cwd: alias } });
  expect(created.action.cwd).toBe(cwd);
  const updated = await service.update("night", { baseRevision: 1, action: { ...input().action, cwd: `${alias}/.` } });
  expect(updated.action.cwd).toBe(cwd);
});

it.each(["symlink escape", "removed root"])("records a failed fire, without firing, after a %s", async (change) => {
  await service.create(input());
  await service.pause("night");
  if (change === "removed root") await rm(cwd, { recursive: true });
  else {
    const outside = join(root, "outside"); await mkdir(outside);
    await rename(cwd, join(root, "old-root")); await symlink(outside, cwd);
  }
  await service.run("night", { requestId: "boundary" });
  await vi.waitFor(async () => { expect((await service.get("night")).history[0]?.outcome.kind).toBe("failed"); });
  expect(fires).toBe(0);
  expect((await service.get("night")).attention).not.toBeNull();
});
