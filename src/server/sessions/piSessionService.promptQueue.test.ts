import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, InMemoryCredentialStore, type AssistantMessage } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type * as PiCodingAgent from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fingerprintPromptResourceCommand, fingerprintPromptResourceDeliveryText } from "../../shared/promptResourceCommand.js";
import { PROMPT_RESOURCE_CATALOG_LIMITS } from "../resources/promptResourceCatalog.js";
import { PiSessionService } from "./piSessionService.js";
import { buildActiveCommandCatalog, buildPromptResourceCatalogFromResources } from "./commandCatalog.js";
import { CapturingSessionEventHub, createTestModelRuntime, fakeRuntime, runtimeCreator, seedCredential, sessionGateway, sessionRecord, sessionRef, TEST_MODEL_ID, TEST_MODEL_PROVIDER, testModel, testModelRuntime, type RuntimeCreator } from "./piSessionService.testSupport.js";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<typeof PiCodingAgent>()),
  resizeImage: vi.fn((bytes: Buffer, mimeType: string) => Promise.resolve({
    data: bytes.toString("base64"),
    mimeType,
    originalWidth: 1,
    originalHeight: 1,
    width: 1,
    height: 1,
    wasResized: false,
  })),
}));

const TEST_AGENT_DIR = "/tmp/pi-web-test-agent";

beforeEach(() => {
  // Pi 0.82 uses PI_OFFLINE for refreshes after runtime creation. These tests
  // exercise local model/auth behavior and must never fetch provider catalogs.
  vi.stubEnv("PI_OFFLINE", "1");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("PiSessionService prompt, queue, and auth warnings", () => {
  it("sends prompts to an injected runtime without touching the SDK runtime", async () => {
    const fake = fakeRuntime("prompt-session");
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("prompt-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.prompt(sessionRef("prompt-session"), "Build the thing");

    expect(fake.calls.prompt).toEqual([{ text: "Build the thing", options: undefined }]);
    await service.dispose();
  });

  it("echoes the user message for direct prompts but not command-forwarded ones", async () => {
    const fake = fakeRuntime("echo-session", {
      resourceLoader: { getSkills: () => ({ skills: [{ name: "skill-creator" }] }) },
    });
    const hub = new CapturingSessionEventHub();
    const service = new PiSessionService(hub, {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("echo-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.prompt(sessionRef("echo-session"), "Build the thing");
    expect(hub.sessionEvents.filter(({ event }) => event.type === "message.append")).toHaveLength(1);

    // The client optimistically renders command-forwarded prompts (e.g. /skill:*),
    // so the server must not publish a second copy via message.append.
    await service.runCommand(sessionRef("echo-session"), "/skill:skill-creator");
    expect(hub.sessionEvents.filter(({ event }) => event.type === "message.append")).toHaveLength(1);
    expect(fake.calls.prompt).toEqual([
      { text: "Build the thing", options: undefined },
      { text: "/skill:skill-creator", options: undefined },
    ]);

    await service.dispose();
  });

  it("expands an identity-matched prompt resource with generic prompt expansion disabled", async () => {
    const fake = fakeRuntime("prompt-resource-session");
    fake.session.promptTemplates = [{ name: "review", description: "Review", content: "Review $ARGUMENTS" }];
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("prompt-resource-session")]),
      heartbeatIntervalMs: 60_000,
    });
    const identity = {
      source: "prompt" as const,
      name: "review",
      fingerprint: await fingerprintPromptResourceCommand({
        source: "prompt",
        name: "review",
        origin: "prompt:unknown:unknown:unknown:unknown",
        content: "Review $ARGUMENTS",
      }),
    };

    const response = await service.runPromptResourceCommand(sessionRef("prompt-resource-session"), "/review src", identity);

    expect(response).toEqual({ accepted: true, deliveryFingerprint: await fingerprintPromptResourceDeliveryText("Review src") });
    expect(JSON.stringify(response)).not.toContain("Review src");
    expect(fake.calls.prompt).toEqual([{ text: "Review src", options: { expandPromptTemplates: false } }]);
    await service.dispose();
  });

  it("delivers inline attachments through the identity-bound expansion-disabled path", async () => {
    const fake = fakeRuntime("prompt-resource-inline-session");
    fake.session.promptTemplates = [{ name: "review", description: "Review", content: "Review $ARGUMENTS" }];
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("prompt-resource-inline-session")]),
      heartbeatIntervalMs: 60_000,
    });
    const identity = {
      source: "prompt" as const,
      name: "review",
      fingerprint: await fingerprintPromptResourceCommand({ source: "prompt", name: "review", origin: "prompt:unknown:unknown:unknown:unknown", content: "Review $ARGUMENTS" }),
    };
    const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

    await expect(service.runPromptResourceCommand(
      sessionRef("prompt-resource-inline-session"),
      "/review src",
      identity,
      undefined,
      [{ kind: "image", mimeType: "image/png", data: tinyPng, name: "shot.png" }],
    )).resolves.toMatchObject({ accepted: true });

    expect(fake.calls.prompt).toHaveLength(1);
    expect(fake.calls.prompt[0]).toMatchObject({
      text: "Review src",
      options: { expandPromptTemplates: false, images: [{ type: "image", mimeType: "image/png" }] },
    });
    await service.dispose();
  });

  it("keeps prompt-resource expansion disabled when it waits behind queued compaction", async () => {
    const fake = fakeRuntime("queued-prompt-resource-session", {
      isStreaming: true,
      promptTemplates: [{ name: "review", description: "Review", content: "Review $ARGUMENTS" }],
    });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("queued-prompt-resource-session")]),
      heartbeatIntervalMs: 60_000,
    });
    const identity = {
      source: "prompt" as const,
      name: "review",
      fingerprint: await fingerprintPromptResourceCommand({ source: "prompt", name: "review", origin: "prompt:unknown:unknown:unknown:unknown", content: "Review $ARGUMENTS" }),
    };

    await service.runCommand(sessionRef("queued-prompt-resource-session"), "/compact", "followUp");
    await service.runPromptResourceCommand(sessionRef("queued-prompt-resource-session"), "/review src", identity, "followUp");
    expect(fake.calls.prompt).toEqual([]);

    fake.session.isStreaming = false;
    fake.emit({ type: "agent_end" });

    await vi.waitFor(() => {
      expect(fake.calls.prompt).toEqual([{ text: "Review src", options: { expandPromptTemplates: false } }]);
    });
    await service.dispose();
  });

  it("rejects a stale prompt-resource identity after its content changes", async () => {
    const fake = fakeRuntime("prompt-resource-stale-session", {
      promptTemplates: [{ name: "review", description: "Review", content: "Changed $ARGUMENTS" }],
    });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("prompt-resource-stale-session")]),
      heartbeatIntervalMs: 60_000,
    });
    const staleIdentity = {
      source: "prompt" as const,
      name: "review",
      fingerprint: await fingerprintPromptResourceCommand({ source: "prompt", name: "review", origin: "prompt:unknown:unknown:unknown:unknown", content: "Original $ARGUMENTS" }),
    };

    await expect(service.runPromptResourceCommand(sessionRef("prompt-resource-stale-session"), "/review src", staleIdentity)).rejects.toThrow("no longer available");
    expect(fake.calls.prompt).toEqual([]);
    await service.dispose();
  });

  it("bounds a prompt receipt when Pi never reports preflight or completion", async () => {
    const fake = fakeRuntime("prompt-preflight-timeout-session", {
      prompt: () => new Promise(() => undefined),
    });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("prompt-preflight-timeout-session")]),
      heartbeatIntervalMs: 60_000,
      promptPreflightTimeoutMs: 25,
    });

    await expect(service.prompt(sessionRef("prompt-preflight-timeout-session"), "wait forever")).rejects.toThrow("preflight receipt timed out");
    await service.dispose();
  });

  it("does not return a delivery receipt when Pi rejects prompt preflight", async () => {
    const fake = fakeRuntime("prompt-resource-rejected-session", {
      promptTemplates: [{ name: "review", description: "Review", content: "Review $ARGUMENTS" }],
      prompt: () => {
        return Promise.reject(new Error("model unavailable"));
      },
    });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("prompt-resource-rejected-session")]),
      heartbeatIntervalMs: 60_000,
    });
    const identity = {
      source: "prompt" as const,
      name: "review",
      fingerprint: await fingerprintPromptResourceCommand({
        source: "prompt",
        name: "review",
        origin: "prompt:unknown:unknown:unknown:unknown",
        content: "Review $ARGUMENTS",
      }),
    };

    await expect(service.runPromptResourceCommand(sessionRef("prompt-resource-rejected-session"), "/review src", identity)).rejects.toThrow("rejected before agent start");
    await service.dispose();
  });

  it("does not run a colliding extension for an identity-bound prompt resource", async () => {
    const destination = await buildPromptResourceCatalogFromResources({
      prompts: [{ name: "review", description: "Review", content: "Review $ARGUMENTS", origin: "prompt:unknown:unknown:unknown:unknown" }],
      skills: [],
    });
    const identity = destination.commands[0]?.identity;
    if (identity === undefined) throw new Error("Expected prompt identity");
    const fake = fakeRuntime("prompt-resource-collision-session", {
      promptTemplates: [{ name: "review", description: "Review", content: "Review $ARGUMENTS" }],
    });
    const extensionRunner = fake.session.extensionRunner;
    fake.session.extensionRunner = {
      ...extensionRunner,
      getRegisteredCommands: () => [{ invocationName: "review", description: "extension wins" }],
    };
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("prompt-resource-collision-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await expect(service.runPromptResourceCommand(sessionRef("prompt-resource-collision-session"), "/review src", identity)).rejects.toThrow("Prompt-resource command is no longer available");

    expect(fake.calls.prompt).toEqual([]);
    await service.dispose();
  });

  it("does not run a colliding extension for an identity-bound prompt resource with inline attachments", async () => {
    const destination = await buildPromptResourceCatalogFromResources({
      prompts: [{ name: "review", description: "Review", content: "Review $ARGUMENTS", origin: "prompt:unknown:unknown:unknown:unknown" }],
      skills: [],
    });
    const identity = destination.commands[0]?.identity;
    if (identity === undefined) throw new Error("Expected prompt identity");
    const fake = fakeRuntime("prompt-resource-attachment-collision-session", {
      promptTemplates: [{ name: "review", description: "Review", content: "Review $ARGUMENTS" }],
    });
    const extensionRunner = fake.session.extensionRunner;
    fake.session.extensionRunner = {
      ...extensionRunner,
      getRegisteredCommands: () => [{ invocationName: "review", description: "extension wins" }],
    };
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("prompt-resource-attachment-collision-session")]),
      heartbeatIntervalMs: 60_000,
    });
    const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

    await expect(service.runPromptResourceCommand(
      sessionRef("prompt-resource-attachment-collision-session"),
      "/review src",
      identity,
      undefined,
      [{ kind: "image", mimeType: "image/png", data: tinyPng, name: "shot.png" }],
    )).rejects.toThrow("Prompt-resource command is no longer available");

    expect(fake.calls.prompt).toEqual([]);
    await service.dispose();
  });

  it("fails closed without dispatching oversized active prompt-template content", async () => {
    const oversizedContent = "x".repeat(PROMPT_RESOURCE_CATALOG_LIMITS.maxSerializedBytes + 1);
    const fake = fakeRuntime("prompt-resource-oversized-template-session", {
      promptTemplates: [{ name: "oversized", description: "Oversized", content: oversizedContent }],
    });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("prompt-resource-oversized-template-session")]),
      heartbeatIntervalMs: 60_000,
    });
    const identity = { source: "prompt" as const, name: "oversized", fingerprint: "a".repeat(64) };

    const error = await service.runPromptResourceCommand(sessionRef("prompt-resource-oversized-template-session"), "/oversized", identity).catch((caught: unknown) => caught);

    expect(error).toEqual(new Error("Prompt-resource template content is unavailable."));
    expect(String(error)).not.toContain(oversizedContent.slice(0, 100));
    expect(fake.calls.prompt).toEqual([]);
    await service.dispose();
  });

  it("fails closed without exposing a missing active skill path", async () => {
    const missingPath = join(tmpdir(), "forgerie-missing-skill", "SKILL.md");
    const fake = fakeRuntime("prompt-resource-missing-skill-session", {
      resourceLoader: { getSkills: () => ({ skills: [{ name: "missing", description: "Missing", filePath: missingPath, baseDir: join(tmpdir(), "forgerie-missing-skill") }] }) },
    });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("prompt-resource-missing-skill-session")]),
      heartbeatIntervalMs: 60_000,
    });
    const identity = { source: "skill" as const, name: "skill:missing", fingerprint: "a".repeat(64) };

    const error = await service.runPromptResourceCommand(sessionRef("prompt-resource-missing-skill-session"), "/skill:missing", identity).catch((caught: unknown) => caught);
    expect(error).toEqual(new Error("Prompt-resource skill content is unavailable."));
    expect(String(error)).not.toContain(missingPath);
    expect(fake.calls.prompt).toEqual([]);
    await service.dispose();
  });

  it("expands identity-bound prompt and skill resources before dispatching with Pi expansion disabled", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-prompt-resource-"));
    const skillPath = join(root, "SKILL.md");
    await writeFile(skillPath, "---\ndescription: Audit\n---\nUse the audit skill\n", "utf8");
    const activeCatalog = await buildActiveCommandCatalog({
      builtins: [],
      extensions: [],
      prompts: [{ name: "review", description: "Review", content: "Review $1 and ${2:-fallback} for $ARGUMENTS", origin: "prompt:unknown:unknown:unknown:unknown" }],
      skills: [{ name: "audit", description: "Audit", content: "---\ndescription: Audit\n---\nUse the audit skill\n", origin: `skill:unknown:unknown:unknown:${skillPath}`, baseDir: root, filePath: skillPath }],
    });
    const review = activeCatalog.resourceCommands.find((command) => command.name === "review");
    const audit = activeCatalog.resourceCommands.find((command) => command.name === "skill:audit");
    if (review === undefined || audit === undefined) throw new Error("Expected prompt and skill identities");
    const fake = fakeRuntime("prompt-resource-expansion-session", {
      promptTemplates: [{ name: "review", description: "Review", content: "Review $1 and ${2:-fallback} for $ARGUMENTS" }],
      resourceLoader: { getSkills: () => ({ skills: [{ name: "audit", description: "Audit", filePath: skillPath, baseDir: root }] }) },
    });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("prompt-resource-expansion-session")]),
      heartbeatIntervalMs: 60_000,
    });

    try {
      const reviewResponse = await service.runPromptResourceCommand(sessionRef("prompt-resource-expansion-session"), "/review src 'quoted value'", review.identity);
      const skillResponse = await service.runPromptResourceCommand(sessionRef("prompt-resource-expansion-session"), "/skill:audit target", audit.identity);

      expect(reviewResponse.deliveryFingerprint).toBe(await fingerprintPromptResourceDeliveryText("Review src and quoted value for src quoted value"));
      expect(skillResponse.deliveryFingerprint).toBe(await fingerprintPromptResourceDeliveryText(`<skill name="audit" location="${skillPath}">
References are relative to ${root}.

Use the audit skill
</skill>

target`));
      expect(JSON.stringify(reviewResponse)).not.toContain("Review src and quoted value");
      expect(JSON.stringify(skillResponse)).not.toContain("Use the audit skill");
      expect(fake.calls.prompt).toEqual([
        { text: "Review src and quoted value for src quoted value", options: { expandPromptTemplates: false } },
        { text: `<skill name="audit" location="${skillPath}">
References are relative to ${root}.

Use the audit skill
</skill>

target`, options: { expandPromptTemplates: false } },
      ]);
    } finally {
      await service.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects malformed prompt text before opening the runtime", async () => {
    const fake = fakeRuntime("prompt-session");
    let createCalls = 0;
    const createAgentRuntime: RuntimeCreator = async () => {
      createCalls += 1;
      await Promise.resolve();
      return fake.runtime;
    };
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime,
      sessionManager: sessionGateway([sessionRecord("prompt-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await expect(service.prompt(sessionRef("prompt-session"), undefined)).rejects.toThrow("Prompt text is required");

    expect(createCalls).toBe(0);
    expect(fake.calls.prompt).toEqual([]);
    await service.dispose();
  });

  it("generates a session name for the first prompt via the session's agent.streamFunction", async () => {
    const model = testModel();
    const streamCalls: unknown[] = [];
    const streamFn: StreamFn = (streamModel, context, options) => {
      streamCalls.push({ streamModel, context, options });
      const stream = createAssistantMessageEventStream();
      const message: AssistantMessage = {
        role: "assistant",
        content: [{ type: "text", text: "Fix login bug" }],
        api: "anthropic-messages",
        provider: "anthropic",
        model: model.id,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp: Date.now(),
      };
      stream.push({ type: "done", reason: "stop", message });
      stream.end(message);
      return stream;
    };
    const hub = new CapturingSessionEventHub();
    const fake = fakeRuntime("name-session", { model, agent: { streamFunction: streamFn } });
    const service = new PiSessionService(hub, {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("name-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.prompt(sessionRef("name-session"), "Please fix the login bug");
    await vi.waitFor(() => { expect(fake.session.sessionName).toBe("Fix login bug"); });

    expect(streamCalls).toHaveLength(1);
    expect(hub.sessionEvents.some(({ event }) => event.type === "session.name" && event.name === "Fix login bug")).toBe(true);
    await service.dispose();
  });

  describe("with a configured session title model", () => {
    const TITLE_MODEL_ID = "claude-haiku-4-5-20251001";

    function titleStreamFn(seen: string[]): StreamFn {
      return (streamModel) => {
        seen.push(`${streamModel.provider}/${streamModel.id}`);
        const stream = createAssistantMessageEventStream();
        const message: AssistantMessage = {
          role: "assistant",
          content: [{ type: "text", text: "Login bug" }],
          api: "anthropic-messages",
          provider: streamModel.provider,
          model: streamModel.id,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: "stop",
          timestamp: Date.now(),
        };
        stream.push({ type: "done", reason: "stop", message });
        stream.end(message);
        return stream;
      };
    }

    it("writes the title with the configured model, not the session's model", async () => {
      const credentials = new InMemoryCredentialStore();
      await seedCredential(credentials, TEST_MODEL_PROVIDER, { type: "api_key", key: "sk-test" });
      const modelRuntime = await createTestModelRuntime(credentials);
      const seen: string[] = [];
      const fake = fakeRuntime("title-model-session", { model: testModel(), agent: { streamFunction: titleStreamFn(seen) } });
      const service = new PiSessionService(new CapturingSessionEventHub(), {
        agentDir: TEST_AGENT_DIR,
        modelRuntime,
        sessionTitleModel: () => `${TEST_MODEL_PROVIDER}/${TITLE_MODEL_ID}`,
        createAgentRuntime: runtimeCreator(fake.runtime),
        sessionManager: sessionGateway([sessionRecord("title-model-session")]),
        heartbeatIntervalMs: 60_000,
      });

      await service.prompt(sessionRef("title-model-session"), "Please fix the login bug");
      await vi.waitFor(() => { expect(fake.session.sessionName).toBe("Login bug"); });

      expect(seen).toEqual([`${TEST_MODEL_PROVIDER}/${TITLE_MODEL_ID}`]);
      await service.dispose();
    });

    it("logs and uses the session's model when the configured model has no credentials", async () => {
      const logger = { info: vi.fn() };
      const seen: string[] = [];
      const fake = fakeRuntime("title-model-missing-session", { model: testModel(), agent: { streamFunction: titleStreamFn(seen) } });
      const service = new PiSessionService(new CapturingSessionEventHub(), {
        agentDir: TEST_AGENT_DIR,
        modelRuntime: testModelRuntime,
        sessionTitleModel: () => `${TEST_MODEL_PROVIDER}/${TITLE_MODEL_ID}`,
        logger,
        createAgentRuntime: runtimeCreator(fake.runtime),
        sessionManager: sessionGateway([sessionRecord("title-model-missing-session")]),
        heartbeatIntervalMs: 60_000,
      });

      await service.prompt(sessionRef("title-model-missing-session"), "Please fix the login bug");
      await vi.waitFor(() => { expect(fake.session.sessionName).toBe("Login bug"); });

      expect(seen).toEqual([`${TEST_MODEL_PROVIDER}/${TEST_MODEL_ID}`]);
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "title-model-missing-session", outcome: "title_model_unavailable" }),
        "session title model is unavailable; using the session's model",
      );
      await service.dispose();
    });

    it("reads the setting when it writes a title, so a change applies without a restart", async () => {
      const credentials = new InMemoryCredentialStore();
      await seedCredential(credentials, TEST_MODEL_PROVIDER, { type: "api_key", key: "sk-test" });
      const modelRuntime = await createTestModelRuntime(credentials);
      const seen: string[] = [];
      let setting: string | undefined = undefined;
      const fake = fakeRuntime("title-model-live-session", { model: testModel(), agent: { streamFunction: titleStreamFn(seen) } });
      const service = new PiSessionService(new CapturingSessionEventHub(), {
        agentDir: TEST_AGENT_DIR,
        modelRuntime,
        sessionTitleModel: () => setting,
        createAgentRuntime: runtimeCreator(fake.runtime),
        sessionManager: sessionGateway([sessionRecord("title-model-live-session")]),
        heartbeatIntervalMs: 60_000,
      });

      setting = `${TEST_MODEL_PROVIDER}/${TITLE_MODEL_ID}`;
      await service.prompt(sessionRef("title-model-live-session"), "Please fix the login bug");
      await vi.waitFor(() => { expect(fake.session.sessionName).toBe("Login bug"); });

      expect(seen).toEqual([`${TEST_MODEL_PROVIDER}/${TITLE_MODEL_ID}`]);
      await service.dispose();
    });

    it("logs and uses the session's model when the setting cannot be read", async () => {
      const logger = { info: vi.fn() };
      const seen: string[] = [];
      const fake = fakeRuntime("title-model-unreadable-session", { model: testModel(), agent: { streamFunction: titleStreamFn(seen) } });
      const service = new PiSessionService(new CapturingSessionEventHub(), {
        agentDir: TEST_AGENT_DIR,
        modelRuntime: testModelRuntime,
        sessionTitleModel: () => { throw new Error("Forgerie config must be a JSON object"); },
        logger,
        createAgentRuntime: runtimeCreator(fake.runtime),
        sessionManager: sessionGateway([sessionRecord("title-model-unreadable-session")]),
        heartbeatIntervalMs: 60_000,
      });

      await service.prompt(sessionRef("title-model-unreadable-session"), "Please fix the login bug");
      await vi.waitFor(() => { expect(fake.session.sessionName).toBe("Login bug"); });

      expect(seen).toEqual([`${TEST_MODEL_PROVIDER}/${TEST_MODEL_ID}`]);
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "title-model-unreadable-session", outcome: "title_model_unreadable" }),
        "session title model setting is unreadable; using the session's model",
      );
      await service.dispose();
    });
  });

  it("generates a session name when startup extensions already injected custom context", async () => {
    const model = testModel();
    const fake = fakeRuntime("custom-context-name-session", {
      messages: [{ role: "custom", customType: "bedrock-context", content: "Engineering guidance", display: false }],
      model,
      agent: { streamFunction: () => {
        const stream = createAssistantMessageEventStream();
        const message: AssistantMessage = {
          role: "assistant",
          content: [{ type: "text", text: "Architecture Improvement" }],
          api: "anthropic-messages",
          provider: "anthropic",
          model: model.id,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: "stop",
          timestamp: Date.now(),
        };
        stream.push({ type: "done", reason: "stop", message });
        stream.end(message);
        return stream;
      } },
    });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("custom-context-name-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.prompt(sessionRef("custom-context-name-session"), "/skill:se-architecture-improvement");
    await vi.waitFor(() => { expect(fake.session.sessionName).toBe("Architecture Improvement"); });

    await service.dispose();
  });

  it("uses the deterministic fallback when the first prompt has no selected model", async () => {
    const fake = fakeRuntime("model-less-name-session");
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("model-less-name-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.prompt(sessionRef("model-less-name-session"), "Please investigate Forgerie session naming");

    expect(fake.session.sessionName).toBe("Forgerie session naming");
    await service.dispose();
  });

  it("reports title persistence failures without rejecting the accepted prompt", async () => {
    const logger = { info: vi.fn() };
    const fake = fakeRuntime("title-write-failure-session", {
      setSessionName: () => { throw new Error("disk full"); },
    });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("title-write-failure-session")]),
      heartbeatIntervalMs: 60_000,
      logger,
    });

    await expect(service.prompt(sessionRef("title-write-failure-session"), "/skill:se-architecture-improvement"))
      .resolves.toBeUndefined();

    expect(logger.info).toHaveBeenCalledWith(
      { sessionId: "title-write-failure-session", outcome: "persistence_failed", error: "disk full" },
      "failed to persist generated session title",
    );
    await service.dispose();
  });

  it("claims only the first accepted intent when prompts arrive concurrently", async () => {
    const model = testModel();
    const titleStream = createAssistantMessageEventStream();
    let generationCalls = 0;
    const fake = fakeRuntime("concurrent-name-session", {
      model,
      agent: { streamFunction: () => {
        generationCalls += 1;
        return titleStream;
      } },
    });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("concurrent-name-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await Promise.all([
      service.prompt(sessionRef("concurrent-name-session"), "First accepted task"),
      service.prompt(sessionRef("concurrent-name-session"), "Second accepted task"),
    ]);

    expect(generationCalls).toBe(1);
    await service.dispose();
  });

  it("uses raw skill intent instead of expanded skill instructions", async () => {
    const model = testModel();
    let generationCalls = 0;
    const fake = fakeRuntime("raw-skill-name-session", {
      model,
      agent: { streamFunction: () => {
        generationCalls += 1;
        return createAssistantMessageEventStream();
      } },
    });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("raw-skill-name-session")]),
      heartbeatIntervalMs: 60_000,
    });
    await service.status(sessionRef("raw-skill-name-session"));

    fake.titleBridge.publish({ type: "intent.accepted", text: "/skill:se-architecture-improvement" });

    expect(fake.session.sessionName).toBe("Architecture Improvement");
    expect(generationCalls).toBe(0);
    await service.dispose();
  });

  it("generates a signal-dense name from skill request text", async () => {
    const model = testModel();
    let titleContext: Parameters<StreamFn>[1] | undefined;
    const fake = fakeRuntime("skill-request-name-session", {
      model,
      agent: { streamFunction: (_streamModel, context) => {
        titleContext = context;
        const stream = createAssistantMessageEventStream();
        const message: AssistantMessage = {
          role: "assistant",
          content: [{ type: "text", text: "Escape Key Parity" }],
          api: "anthropic-messages",
          provider: "anthropic",
          model: model.id,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: "stop",
          timestamp: Date.now(),
        };
        stream.push({ type: "done", reason: "stop", message });
        stream.end(message);
        return stream;
      } },
    });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("skill-request-name-session")]),
      heartbeatIntervalMs: 60_000,
    });
    await service.status(sessionRef("skill-request-name-session"));

    fake.titleBridge.publish({ type: "intent.accepted", text: "/skill:se-debug Make Escape behave like the TUI" });

    await vi.waitFor(() => { expect(fake.session.sessionName).toBe("Escape Key Parity"); });
    expect(titleContext?.messages[1]?.content).toContain("/skill:se-debug Make Escape behave like the TUI");
    await service.dispose();
  });

  it("aborts stale generation when the session lifecycle resets", async () => {
    const model = testModel();
    const titleStream = createAssistantMessageEventStream();
    let generationSignal: AbortSignal | undefined;
    const fake = fakeRuntime("reset-name-session", {
      model,
      agent: { streamFunction: (_streamModel, _context, options) => {
        generationSignal = options?.signal;
        return titleStream;
      } },
    });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("reset-name-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.prompt(sessionRef("reset-name-session"), "Investigate title lifecycle");
    expect(generationSignal?.aborted).toBe(false);

    fake.titleBridge.publish({ type: "lifecycle.reset" });
    expect(generationSignal?.aborted).toBe(true);

    fake.titleBridge.publish({ type: "intent.accepted", text: "/skill:se-architecture-improvement" });
    expect(fake.session.sessionName).toBe("Architecture Improvement");

    const generatedMessage: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Title Lifecycle" }],
      api: "anthropic-messages",
      provider: "anthropic",
      model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: Date.now(),
    };
    titleStream.push({ type: "done", reason: "stop", message: generatedMessage });
    titleStream.end(generatedMessage);
    await Promise.resolve();

    expect(fake.session.sessionName).toBe("Architecture Improvement");
    await service.dispose();
  });

  it("does not backfill an existing unnamed conversation from a later prompt", async () => {
    const model = testModel();
    let generationCalls = 0;
    const fake = fakeRuntime("existing-unnamed-session", {
      messages: [{ role: "user", content: "Earlier task" }],
      model,
      agent: { streamFunction: () => {
        generationCalls += 1;
        return createAssistantMessageEventStream();
      } },
    });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("existing-unnamed-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.prompt(sessionRef("existing-unnamed-session"), "Later task");

    expect(generationCalls).toBe(0);
    expect(fake.session.sessionName).toBeUndefined();
    await service.dispose();
  });

  it("keeps a manual /name set while automatic naming is still in flight", async () => {
    const model = testModel();
    const titleStream = createAssistantMessageEventStream();
    const fake = fakeRuntime("manual-name-session", {
      model,
      agent: { streamFunction: () => titleStream },
    });
    const hub = new CapturingSessionEventHub();
    const service = new PiSessionService(hub, {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("manual-name-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.prompt(sessionRef("manual-name-session"), "Explain the session title mechanism");
    await expect(service.runCommand(sessionRef("manual-name-session"), "/name My Title"))
      .resolves.toMatchObject({ type: "done", session: { name: "My Title" } });

    let currentName = fake.session.sessionName;
    let resolveGeneratedNameCheck: (() => void) | undefined;
    const generatedNameChecked = new Promise<void>((resolve) => { resolveGeneratedNameCheck = resolve; });
    Object.defineProperty(fake.session, "sessionName", {
      configurable: true,
      get: () => {
        resolveGeneratedNameCheck?.();
        return currentName;
      },
      set: (name: string | undefined) => { currentName = name; },
    });

    const generatedMessage: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Session Title Mechanism" }],
      api: "anthropic-messages",
      provider: "anthropic",
      model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: Date.now(),
    };
    titleStream.push({ type: "done", reason: "stop", message: generatedMessage });
    titleStream.end(generatedMessage);

    await generatedNameChecked;
    expect(currentName).toBe("My Title");
    const publishedNames = hub.sessionEvents.flatMap(({ event }) => event.type === "session.name" ? [event.name] : []);
    expect(publishedNames).toEqual(["My Title"]);
    await service.dispose();
  });

  it("includes queued message details in session status", async () => {
    const fake = fakeRuntime("status-session", {
      messages: [{ role: "user", content: "hello" }, { role: "assistant", content: "hi" }],
      pendingMessageCount: 2,
      getSteeringMessages: () => ["adjust this turn"],
      getFollowUpMessages: () => ["then do this"],
      settingsManager: {
        getWarnings: () => ({}),
        setWarnings: () => undefined,
        getDoubleEscapeAction: () => "fork",
      },
    });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("status-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await expect(service.status(sessionRef("status-session"))).resolves.toMatchObject({
      pendingMessageCount: 2,
      queuedMessages: [{ kind: "steer", text: "adjust this turn" }, { kind: "followUp", text: "then do this" }],
      doubleEscapeAction: "fork",
      messageCount: 2,
    });
    await service.dispose();
  });

  it("does not enqueue duplicate queued message text", async () => {
    const fake = fakeRuntime("dedupe-session", {
      isStreaming: true,
      pendingMessageCount: 1,
      getFollowUpMessages: () => ["already queued"],
    });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("dedupe-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.prompt(sessionRef("dedupe-session"), "already queued", "followUp");

    expect(fake.calls.prompt).toEqual([]);
    await service.dispose();
  });

  it("does not append queued prompts to the transcript before delivery", async () => {
    const hub = new CapturingSessionEventHub();
    const fake = fakeRuntime("queued-session", { isStreaming: true });
    const service = new PiSessionService(hub, {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("queued-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.prompt(sessionRef("queued-session"), "Wait for the current turn", "followUp");

    expect(fake.calls.prompt).toEqual([{ text: "Wait for the current turn", options: { streamingBehavior: "followUp" } }]);
    expect(hub.sessionEvents.some(({ event }) => event.type === "message.append")).toBe(false);
    await service.dispose();
  });

  it("queues compaction after the active run and keeps later prompts behind it", async () => {
    const followUpMessages = ["Finish the current queue first"];
    const fake = fakeRuntime("queued-compaction-session", {
      isStreaming: true,
      pendingMessageCount: 1,
      getFollowUpMessages: () => followUpMessages,
    });
    let resolveCompaction: ((result: { summary: string; tokensBefore: number }) => void) | undefined;
    const compact = vi.fn(() => {
      fake.session.isCompacting = true;
      return new Promise<{ summary: string; tokensBefore: number }>((resolve) => { resolveCompaction = resolve; });
    });
    fake.session.compact = compact;
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("queued-compaction-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await expect(service.runCommand(sessionRef("queued-compaction-session"), "/compact focus on decisions", "followUp")).resolves.toEqual({
      type: "done",
      message: "Compaction queued…",
    });
    await service.prompt(sessionRef("queued-compaction-session"), "Continue after compaction", "followUp", [{
      kind: "image",
      mimeType: "image/png",
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      name: "shot.png",
    }]);

    expect(compact).not.toHaveBeenCalled();
    expect(fake.calls.abort).toBe(0);
    expect(fake.calls.prompt).toEqual([]);
    await expect(service.status(sessionRef("queued-compaction-session"))).resolves.toMatchObject({
      pendingMessageCount: 3,
      queuedMessages: [
        { kind: "followUp", text: "Finish the current queue first" },
        { kind: "followUp", text: "/compact focus on decisions" },
        { kind: "followUp", text: "Continue after compaction" },
      ],
    });

    followUpMessages.length = 0;
    fake.session.pendingMessageCount = 0;
    fake.session.isStreaming = false;
    fake.emit({ type: "agent_end" });

    await vi.waitFor(() => { expect(compact).toHaveBeenCalledExactlyOnceWith("focus on decisions"); });
    expect(fake.calls.prompt).toEqual([]);

    fake.session.isCompacting = false;
    resolveCompaction?.({ summary: "short", tokensBefore: 100 });
    await vi.waitFor(() => { expect(fake.calls.prompt).toHaveLength(1); });
    expect(fake.calls.prompt[0]).toMatchObject({
      text: "Continue after compaction",
      options: { images: [{ type: "image", mimeType: "image/png" }] },
    });
    await service.dispose();
  });

  it.each([
    Object.assign(new Error("request aborted"), { name: "AbortError" }),
    new Error("summary model failed"),
  ])("delivers later prompts after queued compaction ends with %s", async (compactionError) => {
    const fake = fakeRuntime("failed-queued-compaction-session", { isStreaming: true });
    fake.session.compact = vi.fn(() => {
      fake.session.isCompacting = true;
      return Promise.reject(compactionError).finally(() => { fake.session.isCompacting = false; });
    });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("failed-queued-compaction-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.runCommand(sessionRef("failed-queued-compaction-session"), "/compact", "followUp");
    await service.prompt(sessionRef("failed-queued-compaction-session"), "Continue despite compaction result", "followUp");
    fake.session.isStreaming = false;
    fake.emit({ type: "agent_end" });

    await vi.waitFor(() => {
      expect(fake.calls.prompt).toEqual([{ text: "Continue despite compaction result", options: undefined }]);
    });
    await service.dispose();
  });

  it("queues direct compact requests while the session is active and deduplicates them", async () => {
    const compact = vi.fn(() => Promise.resolve({ summary: "", tokensBefore: 0 }));
    const fake = fakeRuntime("direct-queued-compaction-session", { isStreaming: true, compact });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("direct-queued-compaction-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await expect(service.runCommand(sessionRef("direct-queued-compaction-session"), "/compact")).resolves.toEqual({ type: "done", message: "Compaction queued…" });
    await expect(service.runCommand(sessionRef("direct-queued-compaction-session"), "/compact")).resolves.toEqual({ type: "done", message: "Compaction is already queued." });

    expect(compact).not.toHaveBeenCalled();
    await service.dispose();
  });

  it("deduplicates concurrent compact requests before either starts", async () => {
    let resolveCompaction: ((result: { summary: string; tokensBefore: number }) => void) | undefined;
    const compact = vi.fn(() => new Promise<{ summary: string; tokensBefore: number }>((resolve) => { resolveCompaction = resolve; }));
    const fake = fakeRuntime("concurrent-compaction-session", { compact });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("concurrent-compaction-session")]),
      heartbeatIntervalMs: 60_000,
    });

    const [first, second] = await Promise.all([
      service.runCommand(sessionRef("concurrent-compaction-session"), "/compact"),
      service.runCommand(sessionRef("concurrent-compaction-session"), "/compact"),
    ]);

    expect(first).toEqual({ type: "done", message: "Compaction started…" });
    expect(second).toEqual({ type: "done", message: "Compaction is already queued." });
    await vi.waitFor(() => { expect(compact).toHaveBeenCalledOnce(); });
    resolveCompaction?.({ summary: "short", tokensBefore: 100 });
    await service.dispose();
  });

  it("restores a queued compaction between earlier and later prompts when stopped", async () => {
    const followUpMessages = ["Finish first"];
    const compact = vi.fn(() => Promise.resolve({ summary: "", tokensBefore: 0 }));
    const fake = fakeRuntime("abort-queued-compaction-session", {
      isStreaming: true,
      pendingMessageCount: 1,
      getFollowUpMessages: () => followUpMessages,
      compact,
      clearQueue: () => {
        fake.calls.clearQueue += 1;
        followUpMessages.length = 0;
        fake.session.pendingMessageCount = 0;
        return { steering: [], followUp: ["Finish first"] };
      },
    });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("abort-queued-compaction-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.runCommand(sessionRef("abort-queued-compaction-session"), "/compact", "followUp");
    await service.prompt(sessionRef("abort-queued-compaction-session"), "Continue later", "followUp");

    await expect(service.abort(sessionRef("abort-queued-compaction-session"))).resolves.toEqual({
      aborted: true,
      restoredMessages: [
        { kind: "followUp", text: "Finish first" },
        { kind: "followUp", text: "/compact" },
        { kind: "followUp", text: "Continue later" },
      ],
    });
    expect(compact).not.toHaveBeenCalled();
    await expect(service.status(sessionRef("abort-queued-compaction-session"))).resolves.toMatchObject({ pendingMessageCount: 0, queuedMessages: [] });
    await service.dispose();
  });

  it("waits for committed compaction startup before Stop aborts it", async () => {
    let rejectCompaction: ((reason: Error) => void) | undefined;
    const fake = fakeRuntime("stop-starting-compaction-session", { isStreaming: true });
    const compact = vi.fn(() => new Promise<never>((_, reject) => { rejectCompaction = reject; }));
    const abortCompaction = vi.fn(() => {
      fake.session.isCompacting = false;
      rejectCompaction?.(new Error("Compaction cancelled"));
    });
    fake.session.compact = compact;
    fake.session.abortCompaction = abortCompaction;
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("stop-starting-compaction-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.runCommand(sessionRef("stop-starting-compaction-session"), "/compact", "followUp");
    await service.prompt(sessionRef("stop-starting-compaction-session"), "Restore this later prompt", "followUp");
    fake.session.isStreaming = false;
    fake.emit({ type: "agent_end" });
    await vi.waitFor(() => { expect(compact).toHaveBeenCalledOnce(); });

    let stopped = false;
    const stop = service.abort(sessionRef("stop-starting-compaction-session")).then((result) => {
      stopped = true;
      return result;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);

    fake.session.isCompacting = true;
    fake.emit({ type: "compaction_start" });

    await expect(stop).resolves.toEqual({
      aborted: true,
      restoredMessages: [{ kind: "followUp", text: "Restore this later prompt" }],
    });
    expect(abortCompaction).toHaveBeenCalledOnce();
    await service.dispose();
  });

  it("holds prompts sent during compaction until compaction finishes", async () => {
    const hub = new CapturingSessionEventHub();
    const fake = fakeRuntime("compacting-session", { isCompacting: true });
    let resolveFirstPrompt: (() => void) | undefined;
    fake.session.prompt = (text: string, options?: { streamingBehavior?: "steer" | "followUp" }) => {
      fake.calls.prompt.push({ text, options });
      if (options === undefined) {
        fake.session.isStreaming = true;
        return new Promise<void>((resolve) => { resolveFirstPrompt = resolve; });
      }
      return Promise.resolve();
    };
    const service = new PiSessionService(hub, {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("compacting-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.prompt(sessionRef("compacting-session"), "Start task 1", "followUp");
    await service.prompt(sessionRef("compacting-session"), "Then task 2", "followUp");

    expect(fake.calls.prompt).toEqual([]);
    expect(hub.sessionEvents.some(({ event }) => event.type === "message.append")).toBe(false);
    await expect(service.status(sessionRef("compacting-session"))).resolves.toMatchObject({
      pendingMessageCount: 2,
      queuedMessages: [{ kind: "followUp", text: "Start task 1" }, { kind: "followUp", text: "Then task 2" }],
    });

    fake.session.isCompacting = false;
    fake.emit({ type: "compaction_end" });
    // compaction_end drains the held queue on a scheduled timer; wait for the
    // first prompt to be delivered rather than sleeping a fixed interval.
    await vi.waitFor(() => {
      expect(fake.calls.prompt).toEqual([{ text: "Start task 1", options: undefined }]);
    });

    expect(hub.sessionEvents.some(({ event }) => event.type === "message.append" && JSON.stringify(event.message).includes("Start task 1"))).toBe(true);
    await expect(service.status(sessionRef("compacting-session"))).resolves.toMatchObject({
      pendingMessageCount: 1,
      queuedMessages: [{ kind: "followUp", text: "Then task 2" }],
    });

    fake.emit({ type: "agent_start" });
    // agent_start drains the next queued prompt asynchronously; wait for both
    // prompts to have been delivered rather than sleeping.
    await vi.waitFor(() => {
      expect(fake.calls.prompt).toEqual([
        { text: "Start task 1", options: undefined },
        { text: "Then task 2", options: { streamingBehavior: "followUp" } },
      ]);
    });
    await expect(service.status(sessionRef("compacting-session"))).resolves.toMatchObject({
      pendingMessageCount: 0,
      queuedMessages: [],
    });
    resolveFirstPrompt?.();
    await service.dispose();
  });

  it("clears a queued compaction without starting it after the active run ends", async () => {
    vi.useFakeTimers();
    const compact = vi.fn(() => Promise.resolve({ summary: "", tokensBefore: 0 }));
    const fake = fakeRuntime("clear-queued-compaction-session", { isStreaming: true, compact });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("clear-queued-compaction-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.runCommand(sessionRef("clear-queued-compaction-session"), "/compact", "followUp");
    await service.prompt(sessionRef("clear-queued-compaction-session"), "Do not send this", "followUp");

    await expect(service.clearQueue(sessionRef("clear-queued-compaction-session"))).resolves.toMatchObject({ pendingMessageCount: 0, queuedMessages: [] });
    fake.session.isStreaming = false;
    fake.emit({ type: "agent_end" });
    await vi.advanceTimersByTimeAsync(200);

    expect(compact).not.toHaveBeenCalled();
    expect(fake.calls.prompt).toEqual([]);
    await service.dispose();
  });

  it("clears runtime and compaction queues without interrupting active work", async () => {
    const steeringMessages = ["adjust this turn"];
    const followUpMessages = ["then do this"];
    const transcript = [{ role: "user", content: "keep this history" }];
    const hub = new CapturingSessionEventHub();
    const fake = fakeRuntime("clear-queue-session", {
      messages: transcript,
      isStreaming: true,
      isCompacting: true,
      pendingMessageCount: 2,
      getSteeringMessages: () => steeringMessages,
      getFollowUpMessages: () => followUpMessages,
    });
    const clearRuntimeQueue = vi.fn(() => {
      const cleared = { steering: [...steeringMessages], followUp: [...followUpMessages] };
      steeringMessages.length = 0;
      followUpMessages.length = 0;
      fake.session.pendingMessageCount = 0;
      return cleared;
    });
    fake.session.clearQueue = clearRuntimeQueue;
    const service = new PiSessionService(hub, {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("clear-queue-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.prompt(sessionRef("clear-queue-session"), "queued during compaction", "followUp");
    await expect(service.status(sessionRef("clear-queue-session"))).resolves.toMatchObject({
      isStreaming: true,
      isCompacting: true,
      pendingMessageCount: 3,
      queuedMessages: [
        { kind: "steer", text: "adjust this turn" },
        { kind: "followUp", text: "then do this" },
        { kind: "followUp", text: "queued during compaction" },
      ],
    });

    const status = await service.clearQueue(sessionRef("clear-queue-session"));

    expect(clearRuntimeQueue).toHaveBeenCalledOnce();
    expect(status).toMatchObject({
      isStreaming: true,
      isCompacting: true,
      pendingMessageCount: 0,
      queuedMessages: [],
      messageCount: 1,
    });
    expect(fake.session.messages).toBe(transcript);
    expect(fake.calls.prompt).toEqual([]);
    expect(fake.calls.abort).toBe(0);
    expect(fake.calls.dispose).toBe(0);
    const publishedStatuses = hub.sessionEvents.filter(({ event }) => event.type === "status.update");
    expect(publishedStatuses.at(-1)?.event).toEqual({ type: "status.update", status });
    await service.dispose();
  });

  it("clears an already-empty queue idempotently", async () => {
    const fake = fakeRuntime("clear-empty-queue-session");
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("clear-empty-queue-session")]),
      heartbeatIntervalMs: 60_000,
    });

    const firstStatus = await service.clearQueue(sessionRef("clear-empty-queue-session"));
    const secondStatus = await service.clearQueue(sessionRef("clear-empty-queue-session"));

    expect(fake.calls.clearQueue).toBe(2);
    expect(fake.calls.abort).toBe(0);
    expect(firstStatus).toMatchObject({ pendingMessageCount: 0, queuedMessages: [] });
    expect(secondStatus).toMatchObject({ pendingMessageCount: 0, queuedMessages: [] });
    await service.dispose();
  });

  it("atomically returns queued messages when aborting active work", async () => {
    const steeringMessages = ["adjust this turn"];
    const followUpMessages = ["then summarize"];
    const fake = fakeRuntime("abort-session", {
      isStreaming: true,
      pendingMessageCount: 2,
      getSteeringMessages: () => steeringMessages,
      getFollowUpMessages: () => followUpMessages,
      clearQueue: () => {
        fake.calls.clearQueue += 1;
        steeringMessages.length = 0;
        followUpMessages.length = 0;
        fake.session.pendingMessageCount = 0;
        return { steering: ["adjust this turn"], followUp: ["then summarize"] };
      },
    });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("abort-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.status(sessionRef("abort-session"));
    const result = await service.abort(sessionRef("abort-session"));

    expect(result).toEqual({
      aborted: true,
      restoredMessages: [
        { kind: "steer", text: "adjust this turn" },
        { kind: "followUp", text: "then summarize" },
      ],
    });
    expect(fake.calls.clearQueue).toBe(1);
    expect(fake.calls.abort).toBe(1);
    await service.dispose();
  });

  it("cancels compaction and restores its queued prompts when aborting active work", async () => {
    let rejectCompaction: ((reason: Error) => void) | undefined;
    const fake = fakeRuntime("abort-compaction-session", {
      compact: () => {
        fake.session.isCompacting = true;
        return new Promise<never>((_, reject) => { rejectCompaction = reject; });
      },
      abortCompaction: () => {
        fake.calls.abortCompaction += 1;
        fake.session.isCompacting = false;
        rejectCompaction?.(new Error("Compaction cancelled"));
      },
    });
    const hub = new CapturingSessionEventHub();
    const service = new PiSessionService(hub, {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("abort-compaction-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.runCommand(sessionRef("abort-compaction-session"), "/compact");
    await service.prompt(sessionRef("abort-compaction-session"), "Do not deliver after abort", "followUp");
    await vi.waitFor(async () => {
      await expect(service.status(sessionRef("abort-compaction-session"))).resolves.toMatchObject({ isCompacting: true, pendingMessageCount: 1 });
    });
    const result = await service.abort(sessionRef("abort-compaction-session"));

    expect(result).toEqual({
      aborted: true,
      restoredMessages: [{ kind: "followUp", text: "Do not deliver after abort" }],
    });
    expect(fake.calls.abortCompaction).toBe(1);
    expect(fake.calls.clearQueue).toBe(1);
    expect(fake.calls.prompt).toEqual([]);
    await vi.waitFor(() => {
      expect(hub.sessionEvents.some(({ sessionId, event }) => sessionId === "abort-compaction-session"
        && event.type === "activity.update"
        && event.activity.phase === "idle"
        && event.activity.label === "compaction cancelled")).toBe(true);
    });
    expect(hub.sessionEvents.some(({ event }) => event.type === "session.error")).toBe(false);
    await expect(service.status(sessionRef("abort-compaction-session"))).resolves.toMatchObject({ isCompacting: false, pendingMessageCount: 0, queuedMessages: [] });
    await service.dispose();
  });

  it("reloads models.json before listing and selecting models", async () => {
    const agentDir = await mkdtemp(join(tmpdir(), "pi-web-model-runtime-"));
    try {
      const modelsPath = join(agentDir, "models.json");
      await writeLocalModelsConfig(modelsPath, "initial-model");
      const modelRuntime = await ModelRuntime.create({
        credentials: new InMemoryCredentialStore(),
        modelsPath,
        allowModelNetwork: false,
      });
      const setSessionModel = vi.fn(() => Promise.resolve());
      const fake = fakeRuntime("models-session", { modelRuntime, setModel: setSessionModel });
      const service = new PiSessionService(new CapturingSessionEventHub(), {
        agentDir,
        modelRuntime,
        createAgentRuntime: runtimeCreator(fake.runtime),
        sessionManager: sessionGateway([sessionRecord("models-session")]),
        heartbeatIntervalMs: 60_000,
      });

      try {
        await writeLocalModelsConfig(modelsPath, "listed-model");
        const listed = await service.availableModels(sessionRef("models-session"));
        expect(listed).toEqual(expect.arrayContaining([
          expect.objectContaining({ provider: "test-local", id: "listed-model" }),
        ]));
        expect(listed).not.toEqual(expect.arrayContaining([
          expect.objectContaining({ provider: "test-local", id: "initial-model" }),
        ]));

        await writeLocalModelsConfig(modelsPath, "selected-model");
        await expect(service.setModel(sessionRef("models-session"), "test-local", "selected-model")).resolves.toBeDefined();
        expect(setSessionModel).toHaveBeenCalledWith(expect.objectContaining({
          provider: "test-local",
          id: "selected-model",
        }));
      } finally {
        await service.dispose();
      }
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });

  it("clears queued messages when stopping a session runtime", async () => {
    const fake = fakeRuntime("stop-session");
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("stop-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.status(sessionRef("stop-session"));
    await service.stop(sessionRef("stop-session"));

    expect(fake.calls.clearQueue).toBe(1);
    await service.dispose();
  });
});

async function writeLocalModelsConfig(path: string, modelId: string): Promise<void> {
  await writeFile(path, JSON.stringify({
    providers: {
      "test-local": {
        name: "Test Local",
        baseUrl: "http://127.0.0.1:1234/v1",
        apiKey: "offline-test-key",
        api: "openai-completions",
        models: [{
          id: modelId,
          name: modelId,
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 1_000,
          maxTokens: 100,
        }],
      },
    },
  }));
}
