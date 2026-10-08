import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { describe, expect, it } from "vitest";
import type { SessionUiEvent } from "../types.js";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, emptyArchiveStore } from "./piSessionService.testSupport.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import { durableSessionPaths } from "./durableSessionJournal.js";

class CompletionSessionEventHub extends CapturingSessionEventHub {
  readonly completed: Promise<void>;
  private complete: (() => void) | undefined;
  private fail: ((error: Error) => void) | undefined;
  private sawAnswer = false;

  constructor() {
    super();
    this.completed = new Promise<void>((resolve, reject) => { this.complete = resolve; this.fail = reject; });
  }
  rejectPending(error: Error): void { this.fail?.(error); }
  override publish(sessionId: string, event: SessionUiEvent): void {
    super.publish(sessionId, event);
    if (event.type === "session.error") this.fail?.(new Error(event.message));
    if (event.type === "message.end" && event.message !== undefined && JSON.stringify(event.message).includes("durable service answer")) this.sawAnswer = true;
    if (event.type === "status.update" && this.sawAnswer && !event.status.isStreaming) this.complete?.();
  }
}

describe("Forgerie default Durable runtime", () => {
  it("runs a parent through the production factory and leaves a native journal", async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgerie-durable-service-"));
    const agentDir = join(directory, "agent");
    const models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
    const provider = fauxProvider();
    models.registerNativeProvider(provider.provider);
    // Title generation shares this provider with the parent. Both paths use configured responses.
    provider.setResponses([fauxAssistantMessage("durable service answer"), fauxAssistantMessage("durable service answer"), fauxAssistantMessage("durable service answer")]);
    const hub = new CompletionSessionEventHub();
    const gateway = createPiSessionManagerGateway({ agentDir, env: { HOME: directory }, sessionDirEnvKeys: [] });
    const service = new PiSessionService(hub, { agentDir, modelRuntime: models, sessionManager: gateway, archiveStore: emptyArchiveStore(), heartbeatIntervalMs: 60_000 });
    try {
      const session = await service.start(directory);
      const ref = { id: session.id, cwd: directory };
      await service.prompt(ref, "complete the integration request");
      const timeout = setTimeout(() => { hub.rejectPending(new Error(`Native integration did not settle: ${JSON.stringify({ calls: provider.state.callCount, events: hub.sessionEvents.slice(-12) })}`)); }, 2_000);
      try { await hub.completed; } finally { clearTimeout(timeout); }
      expect(provider.state.callCount).toBeGreaterThanOrEqual(1);
      expect((await service.status(ref)).isStreaming).toBe(false);
      const listed = await gateway.list(directory);
      const stored = listed.find((entry) => entry.id === session.id);
      if (stored === undefined) throw new Error("Native session must remain discoverable");
      expect(await readFile(stored.path, "utf8")).toContain("forgerieDurableSessionId");
      expect((await readFile(durableSessionPaths(stored.path).database)).subarray(0, 16).toString()).toBe("SQLite format 3\u0000");
    } finally {
      await service.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);
});
