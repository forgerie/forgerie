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
  const provider = fauxProvider(); modelRuntime.registerNativeProvider(provider.provider);
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
