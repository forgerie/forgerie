import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, createTestModelRuntime, fakeRuntime, seedCredential, sessionGateway, sessionRecord, sessionRef } from "./piSessionService.testSupport.js";

describe("PiSessionService new-session defaults", () => {
  it("resolves the destination's Pi model and thinking defaults before a session exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgerie-session-defaults-"));
    const agentDir = join(root, "agent");
    const workspace = join(root, "workspace");
    const credentials = new InMemoryCredentialStore();
    await seedCredential(credentials, "anthropic", { type: "api_key", key: "sk-test" });
    const modelRuntime = await createTestModelRuntime(credentials);
    await Promise.all([
      mkdir(agentDir, { recursive: true }),
      mkdir(join(workspace, ".pi"), { recursive: true }),
    ]);
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({
      defaultProvider: "anthropic",
      defaultModel: "claude-sonnet-4-5-20250929",
      defaultThinkingLevel: "low",
      enabledModels: [
        "anthropic/claude-opus-4-5",
        "anthropic/claude-sonnet-4-5-20250929",
      ],
    }));
    await writeFile(join(workspace, ".pi", "settings.json"), JSON.stringify({ defaultThinkingLevel: "high" }));
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir,
      modelRuntime,
      sessionManager: sessionGateway([]),
      heartbeatIntervalMs: 60_000,
    });

    try {
      const selection = await service.availableModelsForNewSession(workspace);

      expect(selection.model).toMatchObject({ provider: "anthropic", id: "claude-sonnet-4-5-20250929" });
      expect(selection.thinkingLevel).toBe("high");
      expect(selection.models.slice(0, 2)).toMatchObject([
        { provider: "anthropic", id: "claude-opus-4-5" },
        { provider: "anthropic", id: "claude-sonnet-4-5-20250929" },
      ]);
      expect(selection.models.length).toBeGreaterThan(2);
    } finally {
      await service.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses the first scoped model and its pinned thinking when the saved default is outside scope", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgerie-session-scoped-default-"));
    const agentDir = join(root, "agent");
    const workspace = join(root, "workspace");
    const credentials = new InMemoryCredentialStore();
    await seedCredential(credentials, "anthropic", { type: "api_key", key: "sk-test" });
    const modelRuntime = await createTestModelRuntime(credentials);
    await Promise.all([mkdir(agentDir, { recursive: true }), mkdir(workspace, { recursive: true })]);
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({
      defaultProvider: "anthropic",
      defaultModel: "claude-sonnet-4-5-20250929",
      defaultThinkingLevel: "high",
      enabledModels: ["anthropic/claude-opus-4-5:low"],
    }));
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir,
      modelRuntime,
      sessionManager: sessionGateway([]),
      heartbeatIntervalMs: 60_000,
    });

    try {
      await expect(service.availableModelsForNewSession(workspace)).resolves.toMatchObject({
        model: { provider: "anthropic", id: "claude-opus-4-5" },
        thinkingLevel: "low",
      });
    } finally {
      await service.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("places scoped models first without hiding the remaining session catalogue", async () => {
    const credentials = new InMemoryCredentialStore();
    await seedCredential(credentials, "anthropic", { type: "api_key", key: "sk-test" });
    const modelRuntime = await createTestModelRuntime(credentials);
    const scopedModel = modelRuntime.getModel("anthropic", "claude-opus-4-5");
    if (scopedModel === undefined) throw new Error("Expected scoped test model");
    const runtime = fakeRuntime("scoped-list", { modelRuntime, scopedModels: [{ model: scopedModel }] });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: "/tmp/pi-web-test-agent",
      modelRuntime,
      createAgentRuntime: () => Promise.resolve(runtime.runtime),
      sessionManager: sessionGateway([sessionRecord("scoped-list")]),
      heartbeatIntervalMs: 60_000,
    });

    try {
      const models = await service.availableModels(sessionRef("scoped-list"));
      expect(models[0]).toMatchObject({ provider: "anthropic", id: "claude-opus-4-5" });
      expect(models.length).toBeGreaterThan(1);
    } finally {
      await service.dispose();
    }
  });

  it("passes the destination's resolved model scope into session runtimes", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgerie-session-runtime-scope-"));
    const agentDir = join(root, "agent");
    const workspace = join(root, "workspace");
    const credentials = new InMemoryCredentialStore();
    await seedCredential(credentials, "anthropic", { type: "api_key", key: "sk-test" });
    const modelRuntime = await createTestModelRuntime(credentials);
    await Promise.all([mkdir(agentDir, { recursive: true }), mkdir(workspace, { recursive: true })]);
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({
      enabledModels: [
        "anthropic/claude-opus-4-5:low",
        "anthropic/claude-sonnet-4-5-20250929",
      ],
    }));
    const runtime = fakeRuntime("scoped-runtime", { modelRuntime });
    let capturedOptions: unknown;
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir,
      modelRuntime,
      createAgentRuntime: (_createRuntime, options) => {
        capturedOptions = options;
        return Promise.resolve(runtime.runtime);
      },
      sessionManager: sessionGateway([sessionRecord("scoped-runtime", workspace)]),
      heartbeatIntervalMs: 60_000,
    });

    try {
      await service.status(sessionRef("scoped-runtime", workspace));
      expect(capturedOptions).toMatchObject({
        scopedModels: [
          { model: { provider: "anthropic", id: "claude-opus-4-5" }, thinkingLevel: "low" },
          { model: { provider: "anthropic", id: "claude-sonnet-4-5-20250929" } },
        ],
      });
    } finally {
      await service.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("falls back to Pi's standard thinking level when settings omit one", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgerie-session-defaults-fallback-"));
    const agentDir = join(root, "agent");
    const workspace = join(root, "workspace");
    const credentials = new InMemoryCredentialStore();
    await seedCredential(credentials, "anthropic", { type: "api_key", key: "sk-test" });
    const modelRuntime = await createTestModelRuntime(credentials);
    await Promise.all([mkdir(agentDir, { recursive: true }), mkdir(workspace, { recursive: true })]);
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({
      defaultProvider: "anthropic",
      defaultModel: "claude-sonnet-4-5-20250929",
    }));
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir,
      modelRuntime,
      sessionManager: sessionGateway([]),
      heartbeatIntervalMs: 60_000,
    });

    try {
      await expect(service.availableModelsForNewSession(workspace)).resolves.toMatchObject({ thinkingLevel: "medium" });
    } finally {
      await service.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
});
