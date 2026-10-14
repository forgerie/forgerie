import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, type FauxResponseStep } from "@earendil-works/pi-ai/providers/faux";
import { describe, expect, it } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, emptyArchiveStore } from "./piSessionService.testSupport.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import { REPLY_FORMAT_GUIDE } from "../../shared/replyFormatGuide.js";

/** The system message the model received on each call, as JSON text. */
function recordingResponses(prompts: string[], count: number): FauxResponseStep[] {
  return Array.from({ length: count }, () => (context) => {
    const system = context.messages.find((message) => "role" in message && message.role === "system");
    prompts.push(JSON.stringify(system ?? null));
    return fauxAssistantMessage("ok");
  });
}

async function promptOnce(profile: { systemMd?: string; appendMd?: string }): Promise<string[]> {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-reply-guide-"));
  const agentDir = join(directory, "agent");
  await mkdir(agentDir, { recursive: true });
  if (profile.systemMd !== undefined) await writeFile(join(agentDir, "SYSTEM.md"), profile.systemMd);
  if (profile.appendMd !== undefined) await writeFile(join(agentDir, "APPEND_SYSTEM.md"), profile.appendMd);
  const models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
  const provider = fauxProvider();
  models.registerNativeProvider(provider.provider); await models.refresh({ allowNetwork: false });
  const prompts: string[] = [];
  // Title generation shares the provider, so script more answers than turns.
  provider.setResponses(recordingResponses(prompts, 6));
  const hub = new CapturingSessionEventHub();
  const gateway = createPiSessionManagerGateway({ agentDir, env: { HOME: directory }, sessionDirEnvKeys: [] });
  const service = new PiSessionService(hub, { agentDir, modelRuntime: models, sessionManager: gateway, archiveStore: emptyArchiveStore(), heartbeatIntervalMs: 60_000 });
  try {
    const session = await service.start(directory);
    const ref = { id: session.id, cwd: directory };
    await service.prompt(ref, "first turn");
    // Title generation also calls the model; wait for the turn's own call.
    const deadline = Date.now() + 5_000;
    while (!prompts.some((prompt) => prompt.includes("first turn") || !prompt.includes("retrieval label")) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    return prompts.filter((prompt) => !prompt.includes("retrieval label"));
  } finally {
    await service.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}

// The guide is the contract between the renderer and the agent, so prove it
// reaches the model itself, not only the resource loader.
describe("reply format guide in a hosted session", () => {
  const guideLine = JSON.stringify("Reply format in Forgerie").slice(1, -1);

  it("reaches the model's system message through the production factory", async () => {
    const prompts = await promptOnce({});
    expect(prompts.length).toBeGreaterThanOrEqual(1);
    expect(prompts.some((prompt) => prompt.includes(guideLine))).toBe(true);
    expect(prompts.some((prompt) => prompt.includes(JSON.stringify(REPLY_FORMAT_GUIDE).slice(1, 200)))).toBe(true);
  });

  it("survives a profile that replaces the system prompt and keeps the profile's own addendum", async () => {
    const prompts = await promptOnce({ systemMd: "You are a custom agent.", appendMd: "PROFILE ADDENDUM" });
    const main = prompts.find((prompt) => prompt.includes("You are a custom agent."));
    expect(main).toBeDefined();
    expect(main).toContain(guideLine);
    expect(main).toContain("PROFILE ADDENDUM");
  });
});
