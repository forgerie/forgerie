import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, createTestModelRuntime, seedCredential, sessionGateway } from "./piSessionService.testSupport.js";

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
      expect(selection.models).toContainEqual(expect.objectContaining({ provider: "anthropic", id: "claude-sonnet-4-5-20250929" }));
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
