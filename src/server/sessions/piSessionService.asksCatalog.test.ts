import { describe, expect, it } from "vitest";
import { PendingAskStore } from "./pendingAskStore.js";
import { PendingExtensionDialogStore } from "./pendingExtensionDialogStore.js";
import { PiSessionService } from "./piSessionService.js";
import {
  CapturingSessionEventHub,
  emptyArchiveStore,
  fakeRuntime,
  fakeSessionManager,
  sessionGateway,
  sessionRecord,
  sessionRef,
  testModelRuntime,
} from "./piSessionService.testSupport.js";

const TEST_AGENT_DIR = "/tmp/forgerie-asks-catalog-test-agent";

function catalogStores() {
  return {
    asks: new PendingAskStore({
      now: () => new Date("2026-08-02T10:00:00.000Z"),
      createAskId: () => "ask-1",
    }),
    dialogs: new PendingExtensionDialogStore({
      now: () => new Date("2026-08-02T10:01:00.000Z"),
      createDialogId: () => "dialog-1",
    }),
  };
}

describe("PiSessionService asks catalog", () => {
  it("returns only live sessions with pending asks or extension dialogs and reflects their close transitions", async () => {
    const stores = catalogStores();
    const live = fakeRuntime("session-1", {
      sessionManager: fakeSessionManager("/workspace", {
        getSessionId: () => "session-1",
        getSessionFile: () => "/sessions/session-1.jsonl",
      }),
    });
    let runtimeCreations = 0;
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      sessionManager: sessionGateway([sessionRecord("session-1"), sessionRecord("idle-session")]),
      archiveStore: emptyArchiveStore(),
      pendingAskStore: stores.asks,
      pendingExtensionDialogStore: stores.dialogs,
      createAgentRuntime: () => {
        runtimeCreations += 1;
        return Promise.resolve(live.runtime);
      },
      heartbeatIntervalMs: 60_000,
    });

    try {
      await service.status(sessionRef("session-1"));
      const openedAsk = stores.asks.open({
        sessionId: "session-1",
        questions: [{ id: "choice", question: "Choose", options: [] }],
      }).ask;
      const openedDialog = stores.dialogs.open({
        sessionId: "session-1",
        kind: "confirm",
        title: "Proceed?",
        runScoped: false,
      });

      expect(service.asksCatalog()).toEqual({
        sessions: [{
          id: "session-1",
          cwd: "/workspace",
          pendingAsk: openedAsk,
          pendingDialogs: [openedDialog],
        }],
      });
      expect(runtimeCreations).toBe(1);

      stores.asks.cancel("session-1", openedAsk.askId);
      stores.dialogs.cancel("session-1", openedDialog.dialogId, "cancelled");

      expect(service.asksCatalog()).toEqual({ sessions: [] });
      expect(runtimeCreations).toBe(1);
    } finally {
      await service.dispose();
    }
  });

  it("includes a dialog that blocks extension startup before the session reaches the active map", async () => {
    const stores = catalogStores();
    let extensionsBound: (() => void) | undefined;
    const bindingStarted = new Promise<void>((resolve) => { extensionsBound = resolve; });
    const starting = fakeRuntime("starting-session", {
      sessionManager: fakeSessionManager("/starting-workspace", {
        getSessionId: () => "starting-session",
        getSessionFile: () => "/sessions/starting-session.jsonl",
      }),
      bindExtensions: async (bindings) => {
        const ui = bindings.uiContext;
        if (ui === undefined) throw new Error("Expected startup UI context");
        const answer = ui.confirm("Startup permission", "Allow startup?");
        extensionsBound?.();
        await answer;
      },
    });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      sessionManager: sessionGateway([sessionRecord("starting-session", "/starting-workspace")]),
      archiveStore: emptyArchiveStore(),
      pendingAskStore: stores.asks,
      pendingExtensionDialogStore: stores.dialogs,
      createAgentRuntime: () => Promise.resolve(starting.runtime),
      extensionDialogsTimeoutMs: 0,
      heartbeatIntervalMs: 60_000,
    });

    const opening = service.status({ id: "starting-session", cwd: "/starting-workspace" });
    await bindingStarted;

    try {
      expect(service.activeCount()).toBe(0);
      expect(service.asksCatalog()).toEqual({
        sessions: [{
          id: "starting-session",
          cwd: "/starting-workspace",
          pendingDialogs: [expect.objectContaining({ dialogId: "dialog-1", title: "Startup permission" })],
        }],
      });

      const closed = await service.cancelDialog({ id: "starting-session", cwd: "/starting-workspace" }, "dialog-1");
      expect(closed.result).toBe("closed");
      await opening;
      expect(service.activeCount()).toBe(1);
    } finally {
      await service.dispose();
    }
  });

  it("returns an empty snapshot without opening runtimes", async () => {
    let runtimeCreations = 0;
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      sessionManager: sessionGateway([]),
      archiveStore: emptyArchiveStore(),
      createAgentRuntime: () => {
        runtimeCreations += 1;
        return Promise.reject(new Error("runtime should not be created"));
      },
      heartbeatIntervalMs: 60_000,
    });

    try {
      expect(service.asksCatalog()).toEqual({ sessions: [] });
      expect(runtimeCreations).toBe(0);
    } finally {
      await service.dispose();
    }
  });
});
