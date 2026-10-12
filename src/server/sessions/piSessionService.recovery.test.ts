import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, type FauxResponseFactory } from "@earendil-works/pi-ai/providers/faux";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, emptyArchiveStore } from "./piSessionService.testSupport.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";

const directories: string[] = [];
const services: PiSessionService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
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
