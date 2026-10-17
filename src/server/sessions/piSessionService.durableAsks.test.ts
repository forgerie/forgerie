import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime, SessionManager, createAgentSessionServices } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { expect, it, vi } from "vitest";
import { DurableAgentSession } from "./durableAgentSession.js";
import { PiSessionService } from "./piSessionService.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import { SessionEventHub } from "../realtime/sessionEventHub.js";
import { SessionAsks } from "./sessionAsks.js";
import { responseFromBranch, SESSION_RESPONSE_CUSTOM_TYPE } from "./sessionResponse.js";
import { undeliveredAskAnswers } from "./askAnswerDelivery.js";

it("recovers an accepted SDK decision only through its Durable receipt, not an additional JSONL notification", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-accepted-decision-"));
  const modelRuntime = await ModelRuntime.create({ authPath: join(directory, "auth.json"), modelsPath: join(directory, "models.json") });
  const provider = fauxProvider(); modelRuntime.registerNativeProvider(provider.provider); await modelRuntime.refresh({ allowNetwork: false });
  provider.setResponses([fauxAssistantMessage("accepted answer delivered"), fauxAssistantMessage("duplicate answer must not run")]);
  const gateway = createPiSessionManagerGateway({ agentDir: directory, env: {}, sessionDirEnvKeys: [] });
  const manager = gateway.create(directory);
  if (!(manager instanceof SessionManager)) throw new Error("Fixture requires a concrete SDK manager");
  manager.appendModelChange("faux", "faux-1");
  manager.appendMessage({ role: "user", content: "ask for a decision", timestamp: 1 });
  manager.appendMessage(fauxAssistantMessage("Choose an option."));
  const asks = new SessionAsks({ readResponse: () => responseFromBranch(manager.getBranch()),
    appendEvent: (_id, event) => { manager.appendCustomEntry(SESSION_RESPONSE_CUSTOM_TYPE, event); }, createAskId: () => "lost-receipt" });
  const opened = asks.open({ sessionId: manager.getSessionId(), questions: [{ id: "q", question: "Choose", options: [{ value: "one", label: "One" }] }] });
  expect(asks.submit(manager.getSessionId(), opened.ask.askId, { answers: [{ id: "q", values: ["one"] }] }).status).toBe("closed");
  expect(undeliveredAskAnswers(manager.getBranch())).toHaveLength(1);
  let hosted: DurableAgentSession | undefined;
  const service = new PiSessionService(new SessionEventHub(), { agentDir: directory, modelRuntime, sessionManager: gateway, heartbeatIntervalMs: 60_000,
    createAgentRuntime: async (_create, options) => {
      if (!(options.sessionManager instanceof SessionManager)) throw new Error("Fixture requires a concrete SDK manager");
      const services = await createAgentSessionServices({ cwd: directory, agentDir: directory, modelRuntime,
        resourceLoaderOptions: { noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true } });
      services.settingsManager.applyOverrides({ compaction: { enabled: false } });
      const model = modelRuntime.getModel("faux", "faux-1");
      if (model === undefined) throw new Error("Fixture model is missing");
      const session = await DurableAgentSession.open({ services, sessionManager: options.sessionManager, initialModel: model });
      hosted = session;
      return { cwd: directory, session, setRebindSession() { /* one session in this recovery test */ },
        fork: () => Promise.reject(new Error("Recovery must not fork")), dispose: () => session.close() };
    },
  });
  try {
    await service.status({ id: manager.getSessionId(), cwd: directory });
    await vi.waitFor(() => { expect(provider.state.callCount).toBe(1); });
    if (hosted === undefined) throw new Error("Recovery must open the native session");
    const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
    await hosted.journal.conversation.waitForIdle(BACKGROUND_CONTEXT);
    // The old recovery path used to add another custom notification and provider turn here.
    expect(provider.state.callCount).toBe(1);
    expect(hosted.messages.filter((message) => message.role === "custom" && message.customType === "pi-web.ask.answers")).toHaveLength(0);
  } finally { await service.dispose(); await rm(directory, { recursive: true, force: true }); }
});

async function liveAskFixture(holdResume = false) {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-live-durable-ask-"));
  const modelRuntime = await ModelRuntime.create({ authPath: join(directory, "auth.json"), modelsPath: join(directory, "models.json") });
  const provider = fauxProvider(); modelRuntime.registerNativeProvider(provider.provider); await modelRuntime.refresh({ allowNetwork: false });
  const gateway = createPiSessionManagerGateway({ agentDir: directory, env: {}, sessionDirEnvKeys: [] });
  const manager = gateway.create(directory);
  if (!(manager instanceof SessionManager)) throw new Error("Concrete SDK manager required");
  manager.appendModelChange("faux", "faux-1");
  manager.appendMessage({ role: "user", content: "seed", timestamp: 1 });
  manager.appendMessage(fauxAssistantMessage("ready"));
  const ref = { id: manager.getSessionId(), cwd: directory };
  let hosted: DurableAgentSession | undefined;
  const openService = () => new PiSessionService(new SessionEventHub(), { agentDir: directory, modelRuntime, sessionManager: gateway, heartbeatIntervalMs: 60_000,
    createAgentRuntime: async (_create, options) => {
      if (!(options.sessionManager instanceof SessionManager)) throw new Error("Concrete SDK manager required");
      const services = await createAgentSessionServices({ cwd: directory, agentDir: directory, modelRuntime,
        resourceLoaderOptions: { noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true } });
      services.settingsManager.applyOverrides({ compaction: { enabled: false } });
      const session = await DurableAgentSession.open({ services, sessionManager: options.sessionManager, initialModel: provider.getModel() });
      hosted = session;
      if (holdResume) vi.spyOn(session.journal.harness, "resume").mockImplementation(() => undefined);
      return { cwd: directory, session, setRebindSession() { /* No replacements in these ask tests. */ },
        fork: () => Promise.reject(new Error("Must not fork")), dispose: () => session.close() };
    },
  });
  let service = openService();
  return { ref, provider, service: () => service, session: () => { if (hosted === undefined) throw new Error("Session not opened"); return hosted; },
    restart: async () => { await service.dispose(); holdResume = false; service = openService(); },
    close: async () => { await service.dispose(); vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }); } };
}

it("commits a live answer before delivery and recovers it exactly once after a crash", async () => {
  const f = await liveAskFixture(true);
  const { BACKGROUND_CONTEXT: context } = await import("@earendil-works/chord/context");
  const { ParentAsks } = await import("./durableParentDocuments.js");
  try {
    await f.service().status(f.ref);
    const opened = await f.service().openAsk({ sessionId: f.ref.id, questions: [{ id: "q", question: "Choose", options: [{ value: "one", label: "One" }] }] });
    const submitting = f.service().submitAsk(f.ref, opened.ask.askId, { answers: [{ id: "q", values: ["one"] }] });
    void submitting.catch(() => undefined);
    await vi.waitFor(async () => {
      const receipt = (await f.session().journal.harness.snapshot(ParentAsks, f.session().journal.conversation.id, context))?.closed[opened.ask.askId];
      expect(receipt?.delivery.kind).toBe("pending");
    });
    expect((await submitting).result).toBe("closed");
    expect(f.provider.state.callCount).toBe(0);
    expect(f.session().sessionManager.getBranch().filter((entry) => entry.type === "custom_message" && entry.customType === "pi-web.ask.answers")).toHaveLength(0);
    await f.restart();
    await f.service().status(f.ref);
    await vi.waitFor(() => { expect(f.provider.state.callCount).toBe(1); });
    await f.session().journal.conversation.waitForIdle(context);
    expect(f.provider.state.callCount).toBe(1);
    expect((await f.session().journal.conversation.context(context)).messages.filter((message) => message.role === "user" && (typeof message.content === "string" ? message.content : message.content.filter(part => part.type === "text").map(part => part.text).join("\n")).includes("The user submitted answers"))).toHaveLength(1);
    expect((await f.service().submitAsk(f.ref, opened.ask.askId, { answers: [{ id: "q", values: ["one"] }] })).result).toBe("stale");
    expect(f.provider.state.callCount).toBe(1);
  } finally { await f.close(); }
});

it("answers the native pending form after reconnect without requiring its JSONL event", async () => {
  const f = await liveAskFixture();
  const { BACKGROUND_CONTEXT: context } = await import("@earendil-works/chord/context");
  try {
    await f.service().status(f.ref);
    const opened = await f.service().openAsk({ sessionId: f.ref.id, questions: [{ id: "q", question: "Choose", options: [{ value: "one", label: "One" }] }] });
    await f.restart();
    expect((await f.service().status(f.ref)).pendingAsk?.askId).toBe(opened.ask.askId);
    expect((await f.service().submitAsk(f.ref, opened.ask.askId, { answers: [{ id: "q", values: ["one"] }] })).result).toBe("closed");
    await vi.waitFor(() => { expect(f.provider.state.callCount).toBe(1); });
    await f.session().journal.conversation.waitForIdle(context);
    expect((await f.service().status(f.ref)).pendingAsk).toBeUndefined();
    expect(f.provider.state.callCount).toBe(1);
  } finally { await f.close(); }
});

it("commits native cancel and chat-reply transitions without a legacy custom delivery", async () => {
  const f = await liveAskFixture(true);
  const { BACKGROUND_CONTEXT: context } = await import("@earendil-works/chord/context");
  const { ParentAsks } = await import("./durableParentDocuments.js");
  try {
    await f.service().status(f.ref);
    const questions = [{ id: "q", question: "Choose", options: [{ value: "one", label: "One" }] }];
    const first = await f.service().openAsk({ sessionId: f.ref.id, questions });
    expect((await f.service().cancelAsk(f.ref, first.ask.askId)).result).toBe("closed");
    expect((await f.session().journal.harness.snapshot(ParentAsks, f.session().journal.conversation.id, context))?.closed[first.ask.askId]?.delivery.kind).toBe("pending");
    const second = await f.service().openAsk({ sessionId: f.ref.id, questions });
    await f.service().prompt(f.ref, "answer in chat");
    const receipt = (await f.session().journal.harness.snapshot(ParentAsks, f.session().journal.conversation.id, context))?.closed[second.ask.askId];
    expect(receipt?.outcome.reason).toBe("answered-in-chat");
    expect(receipt?.delivery.kind).toBe("none");
    expect((await f.service().status(f.ref)).pendingAsk).toBeUndefined();
    expect(f.session().sessionManager.getBranch().filter((entry) => entry.type === "custom_message" && entry.customType === "pi-web.ask.answers")).toHaveLength(0);
  } finally { await f.close(); }
});

it("commits the production end_turn declaration to the native parent response", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-native-declare-"));
  const modelRuntime = await ModelRuntime.create({ authPath: join(directory, "auth.json"), modelsPath: join(directory, "models.json") });
  const provider = fauxProvider(); modelRuntime.registerNativeProvider(provider.provider); await modelRuntime.refresh({ allowNetwork: false });
  const { fauxToolCall } = await import("@earendil-works/pi-ai/providers/faux");
  provider.setResponses([fauxAssistantMessage([{ type: "text", text: "The result is ready." }, fauxToolCall("end_turn", { awaiting: "nothing", reply: "The result is ready." })], { stopReason: "toolUse" })]);
  const gateway = createPiSessionManagerGateway({ agentDir: directory, env: {}, sessionDirEnvKeys: [] });
  const service = new PiSessionService(new SessionEventHub(), { agentDir: directory, modelRuntime, sessionManager: gateway, heartbeatIntervalMs: 60_000 });
  try {
    const started = await service.start(directory, { initialModelSpec: "faux/faux-1" });
    const ref = { id: started.id, cwd: directory };
    await service.prompt(ref, "Finish this work");
    await vi.waitFor(async () => { const status = await service.status(ref); expect(status.isStreaming).toBe(false); expect(status.response).toEqual({ kind: "none" }); });
  } finally { await service.dispose(); await rm(directory, { recursive: true, force: true }); }
});
