import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, type FauxResponseFactory } from "@earendil-works/pi-ai/providers/faux";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, emptyArchiveStore } from "./piSessionService.testSupport.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";

const directories: string[] = [];
const services: PiSessionService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  vi.useRealTimers();
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-parent-recovery-"));
  directories.push(directory);
  const agentDir = join(directory, "agent");
  const models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
  const provider = fauxProvider();
  models.registerNativeProvider(provider.provider);
  const gateway = createPiSessionManagerGateway({ agentDir, env: { HOME: directory }, sessionDirEnvKeys: [] });
  const open = (archiveStore = emptyArchiveStore()) => {
    const hub = new CapturingSessionEventHub();
    const service = new PiSessionService(hub, { agentDir, modelRuntime: models, sessionManager: gateway, archiveStore, heartbeatIntervalMs: 60_000 });
    services.push(service);
    return { service, hub };
  };
  return { directory, provider, gateway, open };
}

// Hold only this parent request. Cancellation closes the real provider call during daemon disposal.
function holdRequest(provider: ReturnType<typeof fauxProvider>, input: string) {
  let entered = false;
  const response: FauxResponseFactory = async (request, options) => {
    const user = [...request.messages].reverse().find((message) => message.role === "user");
    const text = typeof user?.content === "string" ? user.content : user?.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("");
    if (text !== input) return fauxAssistantMessage("Test session");
    entered = true;
    await new Promise<void>((resolve) => {
      if (options?.signal?.aborted === true) resolve();
      else options?.signal?.addEventListener("abort", () => { resolve(); }, { once: true });
    });
    return fauxAssistantMessage("Interrupted", { stopReason: "aborted" });
  };
  provider.setResponses(Array.from({ length: 8 }, () => response));
  return () => entered;
}

const hasAnswer = (hub: CapturingSessionEventHub, answer: string) => hub.sessionEvents.some(({ event }) =>
  event.type === "message.end" && JSON.stringify(event.message).includes(answer));

describe("daemon-owned Durable recovery", () => {
  it("recovers the committed run start immediately on attachment and keeps it in refresh snapshots", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime("2026-10-12T10:00:00.000Z");
    const { directory, provider, gateway, open } = await fixture();
    const original = open();
    const ref = { id: (await original.service.start(directory, { initialModel: provider.getModel() })).id, cwd: directory };
    const entered = holdRequest(provider, "Keep working");
    await original.service.prompt(ref, "Keep working");
    await vi.waitFor(() => { expect(entered()).toBe(true); });
    const stored = (await gateway.list(directory)).find((entry) => entry.id === ref.id);
    if (stored === undefined) throw new Error("Session must persist");
    const user = SessionManager.open(stored.path).buildSessionContext().messages.find((message) => message.role === "user");
    if (user === undefined) throw new Error("Run input must persist");
    const start = new Date(user.timestamp).toISOString();
    expect(start).toBe("2026-10-12T10:00:00.000Z");
    const activity = async (service: PiSessionService) => (await service.machineListing()).activities.find((item) => item.sessionId === ref.id);
    await vi.waitFor(async () => { expect(await activity(original.service)).toMatchObject({ activeSince: start }); });
    await original.service.dispose();
    vi.setSystemTime("2026-10-12T10:05:00.000Z");
    holdRequest(provider, "Keep working");
    const restarted = open();
    // status() attaches the existing runtime. No event or heartbeat is needed to establish its start.
    expect((await restarted.service.status(ref)).isStreaming).toBe(true);
    expect(await activity(restarted.service)).toMatchObject({ activeSince: start });
    await restarted.service.streamSnapshot(ref);
    expect(await activity(restarted.service)).toMatchObject({ activeSince: start });
    vi.setSystemTime("2026-10-12T10:06:00.000Z");
    expect(await activity(restarted.service)).toMatchObject({ activeSince: start });
  }, 20_000);

  it("keeps the run start through tools and steering, then uses follow-up placement time for the next run", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime("2026-10-12T11:00:00.000Z");
    const { directory, provider, gateway, open } = await fixture();
    const { service, hub } = open();
    const ref = { id: (await service.start(directory, { initialModel: provider.getModel() })).id, cwd: directory };
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    let firstHeld = false;
    let followUpHeld = false;
    let sawTool = false;
    const response: FauxResponseFactory = async (request, options) => {
      const user = [...request.messages].reverse().find((message) => message.role === "user");
      const text = typeof user?.content === "string" ? user.content : "";
      if (text === "First turn" && !sawTool) {
        sawTool = true;
        return fauxAssistantMessage([fauxToolCall("read", { path: "missing-test-file" })], { stopReason: "toolUse" });
      }
      if (text === "First turn") {
        firstHeld = true;
        await released;
        return fauxAssistantMessage([fauxToolCall("read", { path: "another-missing-file" })], { stopReason: "toolUse" });
      }
      if (text === "Steer this turn") return fauxAssistantMessage("Steered done");
      if (text === "Follow-up turn") {
        followUpHeld = true;
        await new Promise<void>((resolve) => {
          if (options?.signal?.aborted === true) resolve();
          else options?.signal?.addEventListener("abort", () => { resolve(); }, { once: true });
        });
        return fauxAssistantMessage("Interrupted", { stopReason: "aborted" });
      }
      return fauxAssistantMessage("Test session");
    };
    provider.setResponses(Array.from({ length: 12 }, () => response));
    await service.prompt(ref, "First turn");
    try {
      await vi.waitFor(() => { expect(firstHeld).toBe(true); });
      const toolActivities = hub.globalEvents.flatMap((event) => event.type === "activity.update" && event.activity.detail === "read" ? [event.activity] : []);
      expect(toolActivities.map((item) => item.label)).toEqual(["running tool", "tool failed"]);
      expect(toolActivities.every((item) => item.activeSince === "2026-10-12T11:00:00.000Z")).toBe(true);
      vi.setSystemTime("2026-10-12T11:01:00.000Z");
      await service.prompt(ref, "Steer this turn", "steer");
      await service.prompt(ref, "Follow-up turn", "followUp");
      expect((await service.machineListing()).activities.find((item) => item.sessionId === ref.id)?.activeSince).toBe("2026-10-12T11:00:00.000Z");
      vi.setSystemTime("2026-10-12T11:02:00.000Z");
    } finally { release(); }
    await vi.waitFor(() => { expect(followUpHeld).toBe(true); });
    const stored = (await gateway.list(directory)).find((entry) => entry.id === ref.id);
    if (stored === undefined) throw new Error("Session must persist");
    const user = SessionManager.open(stored.path).buildSessionContext().messages.find((message) => message.role === "user" && message.content === "Follow-up turn");
    if (user === undefined) throw new Error("Follow-up input must persist");
    const followUpStart = new Date(user.timestamp).toISOString();
    expect(user.timestamp).toBeGreaterThanOrEqual(Date.parse("2026-10-12T11:02:00.000Z"));
    expect(followUpStart).not.toBe("2026-10-12T11:01:00.000Z");
    await vi.waitFor(async () => {
      expect((await service.machineListing()).activities.find((item) => item.sessionId === ref.id)?.activeSince).toBe(followUpStart);
    });
    const toolActivities = hub.globalEvents.flatMap((event) => event.type === "activity.update" && event.activity.detail === "read" ? [event.activity] : []);
    expect(toolActivities).toHaveLength(4);
    expect(toolActivities.every((item) => item.activeSince === "2026-10-12T11:00:00.000Z")).toBe(true);
    const steered = hub.globalEvents.flatMap((event) => event.type === "activity.update" && event.activity.at === "2026-10-12T11:01:00.000Z" ? [event.activity] : []);
    expect(steered.length).toBeGreaterThan(0);
    expect(steered.every((item) => item.activeSince === "2026-10-12T11:00:00.000Z")).toBe(true);
  }, 20_000);

  it("resumes an interrupted parent without a browser request, another prompt, or a child index", async () => {
    const { directory, provider, open } = await fixture();
    const original = open();
    const ref = { id: (await original.service.start(directory, { initialModel: provider.getModel() })).id, cwd: directory };
    const entered = holdRequest(provider, "Unfinished parent work");
    await original.service.prompt(ref, "Unfinished parent work");
    await vi.waitFor(() => { expect(entered()).toBe(true); });
    await original.service.dispose();
    const restarted = open();
    provider.setResponses([fauxAssistantMessage("Recovered parent answer")]);
    expect(restarted.service.activeCount()).toBe(0);
    expect(await restarted.service.resumeDurableSessions([])).toEqual({ resumed: [ref.id], failed: [] });
    // Only recovery runs before this assertion: status() would itself open the session and hide the bug.
    await vi.waitFor(() => { expect(hasAnswer(restarted.hub, "Recovered parent answer")).toBe(true); });
    const messages = (await restarted.service.messages(ref)).messages;
    expect(messages.filter((message) => typeof message === "object" && message !== null && "role" in message && message.role === "user")).toHaveLength(1);
  }, 20_000);

  it("recovers a queued follow-up without duplicating either user input", async () => {
    const { directory, provider, open } = await fixture();
    const original = open();
    const ref = { id: (await original.service.start(directory, { initialModel: provider.getModel() })).id, cwd: directory };
    const entered = holdRequest(provider, "First request");
    await original.service.prompt(ref, "First request");
    await vi.waitFor(() => { expect(entered()).toBe(true); });
    await vi.waitFor(async () => { expect((await original.service.status(ref)).isStreaming).toBe(true); });
    await original.service.prompt(ref, "Queued request", "followUp");
    await original.service.dispose();
    provider.setResponses([fauxAssistantMessage("Recovered first"), fauxAssistantMessage("Recovered queued")]);
    const restarted = open();
    expect(await restarted.service.resumeDurableSessions()).toEqual({ resumed: [ref.id], failed: [] });
    await vi.waitFor(() => { expect(hasAnswer(restarted.hub, "Recovered queued")).toBe(true); });
    const users = (await restarted.service.messages(ref)).messages.filter((message) => typeof message === "object" && message !== null && "role" in message && message.role === "user");
    expect(users).toHaveLength(2);
    expect(JSON.stringify(users)).toContain("First request");
    expect(JSON.stringify(users)).toContain("Queued request");
  }, 20_000);

  it("keeps completed and explicitly stopped runs lazy after restart", async () => {
    const { directory, provider, open } = await fixture();
    const original = open();
    const completed = { id: (await original.service.start(directory, { initialModel: provider.getModel() })).id, cwd: directory };
    provider.setResponses(Array.from({ length: 4 }, () => fauxAssistantMessage("Complete answer")));
    await original.service.prompt(completed, "Complete this request");
    await vi.waitFor(() => { expect(hasAnswer(original.hub, "Complete answer")).toBe(true); });
    await vi.waitFor(async () => { expect((await original.service.status(completed)).isStreaming).toBe(false); });
    const stopped = { id: (await original.service.start(directory, { initialModel: provider.getModel() })).id, cwd: directory };
    const entered = holdRequest(provider, "Cancel this request");
    await original.service.prompt(stopped, "Cancel this request");
    await vi.waitFor(() => { expect(entered()).toBe(true); });
    await original.service.abort(stopped);
    await original.service.dispose();
    const calls = provider.state.callCount;
    const restarted = open();
    expect(await restarted.service.resumeDurableSessions()).toEqual({ resumed: [], failed: [] });
    expect(restarted.service.activeCount()).toBe(0);
    expect(provider.state.callCount).toBe(calls);
  }, 20_000);

  it("does not open a runtime when shutdown starts during session-file resolution", async () => {
    const { directory, provider, gateway, open } = await fixture();
    const original = open();
    const ref = { id: (await original.service.start(directory, { initialModel: provider.getModel() })).id, cwd: directory };
    const entered = holdRequest(provider, "Shutdown request");
    await original.service.prompt(ref, "Shutdown request");
    await vi.waitFor(() => { expect(entered()).toBe(true); });
    await original.service.dispose();
    let resolved!: () => void;
    let release!: () => void;
    const resolving = new Promise<void>((resolve) => { resolved = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    const resolveFile = gateway.resolveSessionFile.bind(gateway);
    gateway.resolveSessionFile = async (...args) => { resolved(); await released; return resolveFile(...args); };
    let stopping = false;
    const restarted = open();
    const recovery = restarted.service.resumeDurableSessions([], () => stopping);
    await resolving;
    stopping = true;
    release();
    expect(await recovery).toEqual({ resumed: [], failed: [] });
    expect(restarted.service.activeCount()).toBe(0);
  }, 20_000);

  it("does not recover archived work or start recovery after disposal", async () => {
    const { directory, provider, open } = await fixture();
    const original = open();
    const ref = { id: (await original.service.start(directory, { initialModel: provider.getModel() })).id, cwd: directory };
    const entered = holdRequest(provider, "Archived request");
    await original.service.prompt(ref, "Archived request");
    await vi.waitFor(() => { expect(entered()).toBe(true); });
    await original.service.dispose();
    const archived = { sessionId: ref.id, cwd: directory, archivedAt: "2026-10-12T00:00:00.000Z" };
    const restarted = open({ ...emptyArchiveStore(), get: () => Promise.resolve(archived), list: () => Promise.resolve([archived]), isArchived: () => Promise.resolve(true) });
    expect(await restarted.service.resumeDurableSessions([ref])).toEqual({ resumed: [], failed: [] });
    expect(restarted.service.activeCount()).toBe(0);
    await restarted.service.dispose();
    expect(await restarted.service.resumeDurableSessions()).toEqual({ resumed: [], failed: [] });
  }, 20_000);
});
