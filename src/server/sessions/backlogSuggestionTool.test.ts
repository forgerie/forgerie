import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import { CapturingSessionEventHub, emptyArchiveStore } from "./piSessionService.testSupport.js";
import { BacklogSuggestionStore } from "../backlog/suggestions/suggestionStore.js";
import { suggestion } from "../backlog/suggestions/suggestionTestSupport.js";
import { createBacklogSuggestionTool } from "./backlogSuggestionTool.js";

it("captures a parent suggestion as a model-only tool result and continues the turn without filing", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgerie-suggest-tool-")); const agentDir = join(root, "agent"); await mkdir(agentDir);
  const models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
  const provider = fauxProvider({ tokensPerSecond: 100000 }); models.registerNativeProvider(provider.provider); await models.refresh({ allowNetwork: false });
  const input = { title: "Improve launch recovery", body: "Keep the prompt", why: "Found a gap", files: ["src/launch.ts"], decisions: ["Use receipts"] };
  provider.setResponses(Array.from({ length: 20 }, () => request => {
    const last = request.messages.at(-1);
    return last?.role === "user" && JSON.stringify(last.content).includes("Suggest the follow-up")
      ? fauxAssistantMessage([fauxToolCall("suggest_backlog", input)], { stopReason: "toolUse" }) : fauxAssistantMessage("Continuing the current work.");
  }));
  const hub = new CapturingSessionEventHub(); const store = new BacklogSuggestionStore(join(root, "backlog-suggestions.json")); await store.initialize();
  const deps = { suggest: async (_cwd: string, sessionId: string, received: typeof input, context: { modelSpec?: string; thinkingLevel?: string } = {}) => store.create(suggestion({ sessionId, title: received.title, body: received.body, context: { why: received.why, files: received.files, decisions: received.decisions }, defaultModel: { ...(context.modelSpec === undefined ? {} : { modelSpec: context.modelSpec }), ...(context.thinkingLevel === undefined ? {} : { thinkingLevel: context.thinkingLevel }) } })) };
  expect(createBacklogSuggestionTool(root, deps).exposure).toBe("model-only");
  const service = new PiSessionService(hub, { agentDir, modelRuntime: models, archiveStore: emptyArchiveStore(), backlogSuggestions: deps,
    sessionManager: createPiSessionManagerGateway({ agentDir, env: { HOME: root }, sessionDirEnvKeys: [] }) });
  try {
    const ref = { id: (await service.start(root, { initialModelSpec: "faux/faux-1" })).id, cwd: root };
    await service.prompt(ref, "Suggest the follow-up and keep working.");
    await vi.waitFor(async () => { expect(store.list(), JSON.stringify((await service.messages(ref)).messages)).toHaveLength(1); expect((await service.status(ref)).isStreaming).toBe(false); }, { timeout: 5000 });
    expect(store.list()[0]).toMatchObject({ sessionId: ref.id, state: { kind: "open" }, defaultModel: { modelSpec: "faux/faux-1" } });
    const messages = JSON.stringify((await service.messages(ref)).messages);
    expect(messages).toContain('"toolName":"suggest_backlog"'); expect(messages).toContain('"suggestionId":"suggestion"'); expect(messages).toContain("Continuing the current work");
    expect(await service.decisions(ref)).toEqual([]);
  } finally { await service.dispose(); await rm(root, { recursive: true, force: true }); }
}, 10000);
