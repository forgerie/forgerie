import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { JsonObject } from "@earendil-works/pi-ai";
import { expect, it, vi } from "vitest";
import { createDurableChildHost, LiveChildSessionIndex } from "../sessions/durableChildHost.js";
import { ChildRunStore } from "../sessions/childRunStore.js";
import { PiSessionService } from "../sessions/piSessionService.js";
import { CapturingSessionEventHub, emptyArchiveStore } from "../sessions/piSessionService.testSupport.js";
import { createPiSessionManagerGateway } from "../sessions/piSessionManagerGateway.js";
import { ProjectService } from "../projects/projectService.js";
import { ProjectStore } from "../storage/projectStore.js";
import { RegisteredProjectWorkspaceCwds } from "../workspaces/projectWorkspaceCwds.js";
import { WorkspaceService } from "../workspaces/workspaceService.js";
import { WorkflowLibrary, workflowInputs } from "../resources/workflowLibrary.js";
import { workflowTriggerFire } from "./triggerFire.js";
import { TriggerService } from "./triggerService.js";

it.each(["scope", "lifecycle"] as const)("hosts workflow_schedule %s through a real calling agent", async (scenario) => {
  const root = await mkdtemp(join(tmpdir(), "forgerie-trigger-tools-"));
  const agentDir = join(root, "agent");
  const cwd = join(root, "workspace");
  await mkdir(join(agentDir, "prompts"), { recursive: true });
  for (const name of ["agent-night", "foreign-night", "multi-night", "all-night"]) await writeFile(join(agentDir, "prompts", `${name}.md`), "---\nworkflow: { version: 1 }\n---\nReview the task.\n");
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: [], defaultProvider: "faux", defaultModel: "faux-1" }));
  await mkdir(join(cwd, ".pi", "prompts"), { recursive: true });
  await writeFile(join(cwd, ".pi", "prompts", "nightly.md"), "---\nworkflow: { version: 1 }\n---\nReview the task.\n");
  const models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
  const provider = fauxProvider(); models.registerNativeProvider(provider.provider); await models.refresh({ allowNetwork: false });
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
    const foreign = await triggers.create({ id: "foreign-night", name: "Foreign night", schedule: { kind: "daily", at: "03:00", timezone: "UTC" }, action: { kind: "workflow", targets: { kind: "projects", cwds: [otherCwd] }, workflow: "foreign-night", inputs: {} } });
    const multi = await triggers.create({ id: "multi-night", name: "Multi night", schedule: { kind: "daily", at: "03:00", timezone: "UTC" }, action: { kind: "workflow", targets: { kind: "projects", cwds: [cwd, otherCwd] }, workflow: "multi-night", inputs: {} } });
    const all = await triggers.create({ id: "all-night", name: "All night", schedule: { kind: "daily", at: "03:00", timezone: "UTC" }, action: { kind: "workflow", targets: { kind: "all" }, workflow: "all-night", inputs: {} } });
    const caller = await sessions.start(cwd);
    await sessions.nameTriggerSession(caller, "Calling session");
    let request = 0;
    const invoke = async (value: JsonObject) => {
      command = value;
      const previous = await readFile(caller.path, "utf8").catch(() => "");
      const count = provider.state.callCount;
      await sessions.prompt(caller, "Schedule operation", undefined, undefined, { requestId: `tool-${String(request++)}` });
      await vi.waitFor(async () => { expect(provider.state.callCount).toBeGreaterThan(count); expect((await sessions.status(caller)).isStreaming).toBe(false); }, { timeout: 5000, interval: 10 });
      return (await readFile(caller.path, "utf8")).slice(previous.length);
    };
    await invoke({ action: "create", trigger: { name: "Agent night", schedule: { kind: "daily", at: "03:00" }, action: { kind: "workflow", workflow: "agent-night", inputs: {} } } });
    if (scenario === "scope") {
      expect(await invoke({ action: "list" })).not.toContain(foreign.id);
      for (const record of [multi, all]) {
        expect(await invoke({ action: "list" })).not.toContain(record.id);
        for (const action of ["pause", "resume", "delete", "run"]) expect(await invoke({ action, id: record.id })).toContain("calling session's project");
        expect(await invoke({ action: "update", id: record.id, changes: { baseRevision: 1, name: "Hijacked" } })).toContain("calling session's project");
        expect(await invoke({ action: "create", trigger: { name: "Forbidden", schedule: { kind: "daily", at: "03:00" }, action: record.action } })).toContain("calling session's project");
      }
      for (const action of ["pause", "resume", "delete", "run"]) {
        expect(await invoke({ action, id: foreign.id })).toContain("calling session's project");
      }
      expect(await invoke({ action: "update", id: foreign.id, changes: { baseRevision: 1, name: "Hijacked" } })).toContain("calling session's project");
      expect(await invoke({ action: "create", trigger: { name: "Foreign create", schedule: { kind: "daily", at: "03:00" }, action: { kind: "workflow", targets: { kind: "projects", cwds: [otherCwd] }, workflow: "agent-night", inputs: {} } } })).toContain("calling session's project");
      expect(await invoke({ action: "update", id: "agent-night", changes: { baseRevision: 1, action: { kind: "workflow", targets: { kind: "projects", cwds: [otherCwd] }, workflow: "agent-night", inputs: {} } } })).toContain("calling session's project");
      expect(await triggers.get(foreign.id)).toEqual(foreign);
    }
    const created = await triggers.get("agent-night");
    expect(created).toMatchObject({ createdBy: { kind: "agent", sessionId: caller.id, cwd }, action: { targets: { kind: "projects", cwds: [cwd] } }, schedule: { timezone: triggers.timezone } });
    const transcript = await readFile(caller.path, "utf8");
    expect(transcript).toContain("Next run");
    if (created.state.kind !== "active") throw new Error("Expected active");
    expect(transcript).toContain(new Date(created.state.nextFireAt).toISOString());
    if (scenario === "lifecycle") {
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
      expect((await triggers.list()).triggers).toEqual([foreign, multi, all]);
      expect(hub.globalEvents.filter((event) => event.type === "triggers.changed").length).toBeGreaterThan(6);
    }
  } finally { await triggers.close(); await sessions.dispose(); await rm(root, { recursive: true, force: true }); }
});

it("persists a failed fire message without a model turn, with session identity and unread state", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgerie-trigger-failure-"));
  const agentDir = join(root, "agent");
  const models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
  const provider = fauxProvider(); models.registerNativeProvider(provider.provider); await models.refresh({ allowNetwork: false });
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

it("keeps a persisted model and thinking choice when a trigger retry proposes another", async () => {
  const root = await mkdtemp(join(tmpdir(), "trigger-selection-retention-"));
  const agentDir = join(root, "agent");
  const models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
  const provider = fauxProvider({ models: [{ id: "faux-1", reasoning: true }, { id: "faux-selected", reasoning: true }] });
  models.registerNativeProvider(provider.provider); await models.refresh({ allowNetwork: false });
  const gateway = createPiSessionManagerGateway({ agentDir, env: { HOME: root }, sessionDirEnvKeys: [] });
  const open = () => new PiSessionService(new CapturingSessionEventHub(), { agentDir, modelRuntime: models, sessionManager: gateway, archiveStore: emptyArchiveStore() });
  let sessions = open();
  const ref = { id: "01900000-0000-7000-8000-000000000001", cwd: root };
  const action = { kind: "workflow" as const, cwd: root, workflow: "nightly", inputs: {}, model: "faux/faux-selected", thinkingLevel: "high" as const };
  try {
    await sessions.ensureTriggerSession(ref, action);
    await sessions.dispose(); sessions = open();
    await sessions.ensureTriggerSession(ref, { ...action, model: "faux/faux-1", thinkingLevel: "low" });
    expect(await sessions.status(ref)).toMatchObject({ model: { id: "faux-selected" }, thinkingLevel: "high" });
    expect(provider.state.callCount).toBe(0);
  } finally { await sessions.dispose(); await rm(root, { recursive: true, force: true }); }
});

it("keeps the existing session identity when restart workspace validation fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "trigger-retry-workspace-failure-"));
  const cwd = join(root, "workspace"); const agentDir = join(root, "agent");
  await mkdir(cwd); await mkdir(join(agentDir, "prompts"), { recursive: true });
  await writeFile(join(agentDir, "prompts", "nightly.md"), "---\nworkflow: { version: 1 }\n---\nReview.\n");
  const models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
  const provider = fauxProvider(); models.registerNativeProvider(provider.provider); await models.refresh({ allowNetwork: false });
  const sessions = new PiSessionService(new CapturingSessionEventHub(), { agentDir, modelRuntime: models, archiveStore: emptyArchiveStore(), sessionManager: createPiSessionManagerGateway({ agentDir, env: { HOME: root }, sessionDirEnvKeys: [] }) });
  const projects = new ProjectService(new ProjectStore(join(root, "projects.json"))); await projects.add({ path: cwd });
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  let hold = true;
  const options = { env: { PI_WEB_DATA_DIR: root }, workflows: new WorkflowLibrary(agentDir), workspaces: new RegisteredProjectWorkspaceCwds({ projects, workspaces: new WorkspaceService() }),
    fireFactory: (validateWorkspace: (cwd: string) => Promise<void>) => workflowTriggerFire({ sessions, validateWorkspace, validateAction: () => Promise.resolve(), afterStep: async (step, _request, context) => {
      if (step !== "session" || !hold) return;
      enter();
      await new Promise<never>((_resolve, reject) => { context.abortSignal?.addEventListener("abort", () => { reject(new Error("restart")); }, { once: true }); });
    } }), publish: () => undefined, onError: (error: unknown) => { throw error; },
  };
  let triggers = await TriggerService.open(options);
  try {
    await triggers.create({ id: "night", name: "Night", schedule: { kind: "daily", at: "03:00", timezone: "UTC" }, action: { kind: "workflow", targets: { kind: "projects", cwds: [cwd] }, workflow: "nightly", inputs: {} } });
    await triggers.run("nightly", { requestId: "retry" }); await entered;
    const [session] = await sessions.list(cwd); if (session === undefined) throw new Error("Session was not created");
    await triggers.close(); hold = false; await rm(cwd, { recursive: true });
    triggers = await TriggerService.open(options);
    await vi.waitFor(async () => { expect((await triggers.get("nightly")).history[0]?.outcome.kind).toBe("failed"); });
    expect((await triggers.get("nightly")).history[0]?.outcome).toMatchObject({ kind: "failed", sessionId: session.id, cwd });
    expect(await readFile(session.path, "utf8")).toContain('"customType":"forgerie:trigger"');
    expect(provider.state.callCount).toBe(0);
  } finally { await triggers.close(); await sessions.dispose(); await rm(root, { recursive: true, force: true }); }
});

it("starts real sessions in two projects with distinct identities and the same workflow inputs and model choices", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgerie-multi-project-sessions-"));
  const agentDir = join(root, "agent");
  const cwds = [join(root, "one"), join(root, "two")];
  await mkdir(join(agentDir, "prompts"), { recursive: true });
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: [], defaultProvider: "faux", defaultModel: "faux-1" }));
  await writeFile(join(agentDir, "prompts", "nightly.md"), "---\nworkflow: { version: 1, inputs: { task: { type: string, default: baseline } } }\n---\nReview the task.\n");
  const models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
  const provider = fauxProvider({ models: [{ id: "faux-1", reasoning: true }, { id: "faux-selected", reasoning: true }] }); models.registerNativeProvider(provider.provider); await models.refresh({ allowNetwork: false });
  provider.setResponses(Array.from({ length: 10 }, () => fauxAssistantMessage("Review started")));
  const projects = new ProjectService(new ProjectStore(join(root, "projects.json")));
  for (const cwd of cwds) { await mkdir(cwd); await projects.add({ path: cwd }); }
  const sessions = new PiSessionService(new CapturingSessionEventHub(), { agentDir, modelRuntime: models, archiveStore: emptyArchiveStore(), sessionManager: createPiSessionManagerGateway({ agentDir, env: { HOME: root }, sessionDirEnvKeys: [] }), durableChildAgents: createDurableChildHost({ index: new LiveChildSessionIndex(join(root, "children.json")), runRecords: new ChildRunStore(join(root, "child-runs.json")) }) });
  const library = new WorkflowLibrary(agentDir);
  const triggers = await TriggerService.open({ env: { PI_WEB_DATA_DIR: root }, workflows: library, workspaces: new RegisteredProjectWorkspaceCwds({ projects, workspaces: new WorkspaceService() }),
    fireFactory: (validateWorkspace) => workflowTriggerFire({ sessions, validateWorkspace, validateAction: async (action) => { const workflow = await library.read(action.cwd, action.workflow); workflowInputs(workflow.definition, action.inputs); } }), publish: () => undefined, onError: (error) => { throw error; },
  });
  try {
    await triggers.create({ name: "Multi", schedule: { kind: "daily", at: "03:00", timezone: "UTC" }, action: { kind: "workflow", targets: { kind: "projects", cwds }, workflow: "nightly", inputs: {}, model: "faux/faux-selected", thinkingLevel: "high" } });
    await triggers.pause("nightly"); await triggers.run("nightly", { requestId: "two-projects" });
    await vi.waitFor(async () => { const record = await triggers.get("nightly"); expect(record.history[0]?.outcome.kind, JSON.stringify(record.history[0])).toBe("started"); }, { timeout: 5000 });
    const fire = (await triggers.get("nightly")).history[0];
    expect(fire?.projects).toHaveLength(2);
    const ids: string[] = [];
    for (const project of fire?.projects ?? []) {
      if (project.outcome.kind !== "started") throw new Error("Project did not start");
      const ref = { id: project.outcome.sessionId, cwd: project.cwd }; ids.push(ref.id);
      expect(await sessions.status(ref)).toMatchObject({ model: { id: "faux-selected" }, thinkingLevel: "high" });
      expect((await sessions.workflowRuns(ref))[0]).toMatchObject({ id: project.outcome.runId, definition: { name: "nightly" }, inputs: { task: "baseline" } });
      expect(await sessions.list(project.cwd)).toHaveLength(1);
    }
    expect(new Set(ids).size).toBe(2);
    await triggers.run("nightly", { requestId: "two-projects" });
    for (const cwd of cwds) expect(await sessions.list(cwd)).toHaveLength(1);
  } finally { await triggers.close(); await sessions.dispose(); await rm(root, { recursive: true, force: true }); }
});
