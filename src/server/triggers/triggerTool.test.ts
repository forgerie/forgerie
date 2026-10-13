import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { JsonObject } from "@earendil-works/pi-ai";
import { expect, it, vi } from "vitest";
import { PiSessionService } from "../sessions/piSessionService.js";
import { CapturingSessionEventHub, emptyArchiveStore } from "../sessions/piSessionService.testSupport.js";
import { createPiSessionManagerGateway } from "../sessions/piSessionManagerGateway.js";
import { ProjectService } from "../projects/projectService.js";
import { ProjectStore } from "../storage/projectStore.js";
import { RegisteredProjectWorkspaceCwds } from "../workspaces/projectWorkspaceCwds.js";
import { WorkspaceService } from "../workspaces/workspaceService.js";
import { WorkflowLibrary } from "../resources/workflowLibrary.js";
import { workflowTriggerFire } from "./triggerFire.js";
import { TriggerService } from "./triggerService.js";

it("hosts all seven tool operations, defaults cwd and zone, and records the calling agent", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgerie-trigger-tools-"));
  const agentDir = join(root, "agent");
  const cwd = join(root, "workspace");
  await mkdir(agentDir);
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: [], defaultProvider: "faux", defaultModel: "faux-1" }));
  await mkdir(join(cwd, ".pi", "prompts"), { recursive: true });
  await writeFile(join(cwd, ".pi", "prompts", "nightly.md"), "---\nworkflow: { version: 1 }\n---\nReview the task.\n");
  const models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
  const provider = fauxProvider(); models.registerNativeProvider(provider.provider);
  let command: JsonObject = { action: "list" };
  provider.setResponses(Array.from({ length: 80 }, () => (transcript) => {
    const last = transcript.messages.at(-1);
    if (last?.role === "user") return fauxAssistantMessage([fauxToolCall("workflow_schedule", command)], { stopReason: "toolUse" });
    return fauxAssistantMessage("Schedule operation complete");
  }));
  const projects = new ProjectService(new ProjectStore(join(root, "projects.json"))); await projects.add({ path: cwd });
  const workspaces = new RegisteredProjectWorkspaceCwds({ projects, workspaces: new WorkspaceService() });
  const hub = new CapturingSessionEventHub();
  const gateway = createPiSessionManagerGateway({ agentDir, env: { HOME: root }, sessionDirEnvKeys: [] });
  const sessions = new PiSessionService(hub, { agentDir, modelRuntime: models, sessionManager: gateway, archiveStore: emptyArchiveStore(), triggers: () => triggers });
  const triggers = await TriggerService.open({ env: { PI_WEB_DATA_DIR: root }, workflows: new WorkflowLibrary(agentDir), workspaces,
    fire: (request) => Promise.resolve({ sessionId: "manual-session", cwd, runId: request.requestId }), publish: () => { hub.publishGlobal({ type: "triggers.changed" }); }, onError: (error) => { throw error; },
  });
  try {
    const otherCwd = join(root, "other-project");
    await mkdir(join(otherCwd, ".pi", "prompts"), { recursive: true });
    await writeFile(join(otherCwd, ".pi", "prompts", "nightly.md"), "---\nworkflow: { version: 1 }\n---\nOther project task.\n");
    await projects.add({ path: otherCwd });
    const foreign = await triggers.create({ id: "foreign-night", name: "Foreign night", schedule: { kind: "daily", at: "03:00", timezone: "UTC" }, action: { kind: "workflow", cwd: otherCwd, workflow: "nightly", inputs: {} } });
    const caller = await sessions.start(cwd);
    await sessions.nameTriggerSession(caller, "Calling session");
    let request = 0;
    const invoke = async (value: JsonObject) => {
      command = value;
      const previous = await readFile(caller.path, "utf8").catch(() => "");
      const count = provider.state.callCount;
      await sessions.prompt(caller, "Schedule operation", undefined, undefined, { requestId: `tool-${String(request++)}` });
      await vi.waitFor(async () => { expect(provider.state.callCount).toBeGreaterThan(count); expect((await sessions.status(caller)).isStreaming).toBe(false); }, { timeout: 5000 });
      return (await readFile(caller.path, "utf8")).slice(previous.length);
    };
    await invoke({ action: "create", trigger: { name: "Agent night", schedule: { kind: "daily", at: "03:00" }, action: { kind: "workflow", workflow: "nightly", inputs: {} } } });
    expect(await invoke({ action: "list" })).not.toContain(foreign.id);
    for (const action of ["pause", "resume", "delete", "run"]) {
      expect(await invoke({ action, id: foreign.id })).toContain("calling session's project");
    }
    expect(await invoke({ action: "update", id: foreign.id, changes: { baseRevision: 1, name: "Hijacked" } })).toContain("calling session's project");
    expect(await invoke({ action: "create", trigger: { name: "Foreign create", schedule: { kind: "daily", at: "03:00" }, action: { kind: "workflow", cwd: otherCwd, workflow: "nightly", inputs: {} } } })).toContain("calling session's project");
    expect(await invoke({ action: "update", id: "agent-night", changes: { baseRevision: 1, action: { kind: "workflow", cwd: otherCwd, workflow: "nightly", inputs: {} } } })).toContain("calling session's project");
    expect(await triggers.get(foreign.id)).toEqual(foreign);
    const created = await triggers.get("agent-night");
    expect(created).toMatchObject({ createdBy: { kind: "agent", sessionId: caller.id, cwd }, action: { cwd }, schedule: { timezone: triggers.timezone } });
    const transcript = await readFile(caller.path, "utf8");
    expect(transcript).toContain("Next run");
    if (created.state.kind !== "active") throw new Error("Expected active");
    expect(transcript).toContain(new Date(created.state.nextFireAt).toISOString());
    await invoke({ action: "list" });
    await invoke({ action: "pause", id: created.id });
    expect((await triggers.get(created.id)).state.kind).toBe("paused");
    await invoke({ action: "update", id: created.id, changes: { baseRevision: (await triggers.get(created.id)).revision, name: "Agent updated" } });
    expect((await triggers.get(created.id)).name).toBe("Agent updated");
    await invoke({ action: "run", id: created.id, requestId: "manual" });
    await vi.waitFor(async () => { expect((await triggers.get(created.id)).history[0]?.outcome.kind).toBe("started"); });
    await invoke({ action: "resume", id: created.id });
    expect((await triggers.get(created.id)).state.kind).toBe("active");
    await invoke({ action: "delete", id: created.id });
    expect((await triggers.list()).triggers).toEqual([foreign]);
    expect(hub.globalEvents.filter((event) => event.type === "triggers.changed").length).toBeGreaterThan(6);
  } finally { await triggers.close(); await sessions.dispose(); await rm(root, { recursive: true, force: true }); }
});

it("persists a failed fire message without a model turn, with session identity and unread state", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgerie-trigger-failure-"));
  const agentDir = join(root, "agent");
  const models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
  const provider = fauxProvider(); models.registerNativeProvider(provider.provider);
  const gateway = createPiSessionManagerGateway({ agentDir, env: { HOME: root }, sessionDirEnvKeys: [] });
  const sessions = new PiSessionService(new CapturingSessionEventHub(), { agentDir, modelRuntime: models, sessionManager: gateway, archiveStore: emptyArchiveStore() });
  try {
    const fire = workflowTriggerFire({ sessions, validateAction: () => Promise.reject(new Error("Workflow disappeared")) });
    const request = { triggerId: "night", name: "Nightly refinement", occurrence: Date.parse("2026-10-13T03:00Z"), requestId: "trigger-night-failure", timezone: "UTC", action: { kind: "workflow" as const, cwd: root, workflow: "missing", inputs: {} } };
    await expect(fire(request, context)).rejects.toMatchObject({ message: "Workflow disappeared", cwd: root });
    const files = await gateway.list(root);
    expect(files).toHaveLength(1);
    const entry = files[0]; if (entry === undefined) throw new Error("No failed session");
    const transcript = await readFile(entry.path, "utf8");
    expect(transcript).toContain('"customType":"forgerie:trigger"');
    expect(transcript).toContain('"display":true');
    expect(transcript).toContain("Workflow disappeared");
    expect(provider.state.callCount).toBe(0);
    expect((await sessions.unreadCatalog()).sessions).toMatchObject([{ sessionId: entry.id, cwd: root }]);
    await expect(fire(request, context)).rejects.toThrow("Workflow disappeared");
    expect((await readFile(entry.path, "utf8")).split('"customType":"forgerie:trigger"')).toHaveLength(2);
  } finally { await sessions.dispose(); await rm(root, { recursive: true, force: true }); }
});
