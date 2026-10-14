import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCurrentTools, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime, SessionManager, createAgentSessionServices } from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, emptyArchiveStore } from "./piSessionService.testSupport.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import { controlledManagedProcessLauncher } from "../processes/managedProcesses.testSupport.js";
import { ChildRunStore } from "./childRunStore.js";
import { createDurableChildHost } from "./durableChildHost.js";
import { DurableAgentSession } from "./durableAgentSession.js";
import { ManagedProcesses } from "../processes/managedProcesses.js";
import { AttachedManagedProcessLauncher } from "../processes/managedProcessLauncher.js";

it("runs the hosted SDK process tool, retains it on reload, and leaves the injected owner open on runtime shutdown", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgerie-hosted-process-tool-"));
  const agentDir = join(root, "agent");
  const models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
  const provider = fauxProvider({ tokensPerSecond: 100000 }); models.registerNativeProvider(provider.provider);
  const model = models.getModel("faux", "faux-1");
  if (model === undefined) throw new Error("Missing model");
  const manager = SessionManager.create(root, join(root, "sessions"));
  const core = new ManagedProcesses({ stateDirectory: root, sessionId: manager.getSessionId(), launcher: new AttachedManagedProcessLauncher(), environment: { PATH: process.env["PATH"], PRIVATE_TOKEN: "not-for-models" } });
  await core.initialize();
  let session: DurableAgentSession | undefined;
  try {
    const services = await createAgentSessionServices({ cwd: root, agentDir, modelRuntime: models, resourceLoaderOptions: { noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true } });
    services.settingsManager.applyOverrides({ compaction: { enabled: false } });
    session = await DurableAgentSession.open({ services, sessionManager: manager, initialModel: model,
      getManagedProcesses: (id) => { expect(id).toBe(manager.getSessionId()); return Promise.resolve(core); } });
    session.subscribe(() => undefined); await session.bindExtensions({});
    provider.setResponses([
      request => {
        expect(getCurrentTools(request.messages).some(tool => tool.name === "process")).toBe(true);
        return fauxAssistantMessage([fauxToolCall("process", { action: "start", name: "input-reader", command: "printf 'ready\\n'; read line; printf 'received:%s\\n' \"$line\"; sleep 30", notify: { onSuccess: "ignore", onFailure: "ignore" } })], { stopReason: "toolUse" });
      }, fauxAssistantMessage("started"),
    ]);
    await session.prompt("START");
    const record = (await core.list())[0];
    if (record === undefined) throw new Error("Tool did not start the real command");
    await vi.waitFor(async () => { expect((await core.readOutput(record.id)).lines.map(line => line.text)).toContain("ready"); });
    const toolResult = JSON.stringify(session.messages.filter(message => message.role === "toolResult"));
    expect(toolResult).toContain("Attached process: ends when Forgerie restarts.");
    expect(toolResult).not.toMatch(/PRIVATE_TOKEN|not-for-models|environment/);
    await session.reload();
    provider.setResponses([
      request => {
        expect(getCurrentTools(request.messages).some(tool => tool.name === "process")).toBe(true);
        return fauxAssistantMessage([fauxToolCall("process", { action: "write", id: record.id, input: "hello\n" })], { stopReason: "toolUse" });
      }, fauxAssistantMessage("written"),
    ]);
    await session.prompt("WRITE");
    await vi.waitFor(async () => { expect((await core.readOutput(record.id, { cursor: { offset: 0, line: 1 } })).lines.map(line => line.text)).toContain("received:hello"); });
    const agent = await session.journal.conversation.agent(context);
    const process = agent.extensions.flatMap(extension => extension.tools ?? []).find(tool => tool.name === "process");
    expect(process?.replay).toBe("unsafe");
    await session.close(); session = undefined;
    expect((await core.status(record.id)).state.kind).toBe("running");
  } finally { await session?.close(); await core.dispose(); await rm(root, { recursive: true, force: true }); }
});


it("wires the production hosted child tool to the persisted run ID and keeps only a reported parent process", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgerie-child-process-tool-"));
  const agentDir = join(root, "agent");
  const models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
  const provider = fauxProvider({ tokensPerSecond: 100000 }); models.registerNativeProvider(provider.provider);
  const control = controlledManagedProcessLauncher();
  const records = new ChildRunStore(join(root, "child-runs.json"));
  const gateway = createPiSessionManagerGateway({ agentDir, env: { HOME: root }, sessionDirEnvKeys: [] });
  const service: PiSessionService = new PiSessionService(new CapturingSessionEventHub(), { agentDir, modelRuntime: models, sessionManager: gateway,
    archiveStore: emptyArchiveStore(), heartbeatIntervalMs: 60_000,
    managedProcesses: { stateDirectory: root, prepareLauncher: () => Promise.resolve(control.launcher) },
    durableChildAgents: createDurableChildHost({ runRecords: records, onRunFinished: run => service.childRunFinished(run) }) });
  provider.setResponses(Array.from({ length: 30 }, () => request => {
    const last = request.messages.at(-1);
    if (getCurrentSystemPrompt(request.messages).includes('You are the child agent')) {
      if (last?.role === "toolResult") return fauxAssistantMessage("The kept process is for the parent; keepAfterChild is true.");
      expect(getCurrentTools(request.messages).some(tool => tool.name === "process")).toBe(true);
      return fauxAssistantMessage([
        fauxToolCall("process", { action: "start", name: "temporary", command: "cat", notify: { onFailure: "ignore" } }),
        fauxToolCall("process", { action: "start", name: "kept", command: "cat", keepAfterChild: true }),
      ], { stopReason: "toolUse" });
    }
    if (last?.role === "user" && JSON.stringify(last.content).includes("SPAWN-PROCESS")) return fauxAssistantMessage([
      fauxToolCall("child_agent", { action: "spawn", name: "worker", message: "Start the processes, then report.", isolation: "shared" }),
    ], { stopReason: "toolUse" });
    return fauxAssistantMessage("Parent done.");
  }));
  try {
    const ref = { id: (await service.start(root)).id, cwd: root };
    await service.runCommand(ref, "/name Managed process child test");
    await service.prompt(ref, "SPAWN-PROCESS");
    await vi.waitFor(async () => {
      expect(control.started).toHaveLength(2);
      expect((await records.list({ session: ref.id }))[0]?.state.kind).toBe("finished");
    }, { timeout: 10000 });
    const run = (await records.list({ session: ref.id }))[0];
    expect(control.started.map(record => record.child)).toEqual([{ name: "worker", runId: run?.id }, { name: "worker", runId: run?.id }]);
    expect(control.started.map(record => record.cwd)).toEqual([root, root]);
    expect(control.started.map(record => record.keepAfterChild).sort()).toEqual([false, true]);
    const core = await service.getManagedProcesses(ref.id);
    const snapshots = await core.list();
    expect(snapshots.find(snapshot => snapshot.keepAfterChild === true)?.state.kind).toBe("running");
    expect(snapshots.find(snapshot => snapshot.keepAfterChild === false)?.state.kind).not.toBe("running");
    const messages = JSON.stringify(await service.messages(ref));
    expect(messages).not.toContain("Managed process registry integration is not installed");
  } finally { await service.dispose(); await rm(root, { recursive: true, force: true }); }
}, 20000);
