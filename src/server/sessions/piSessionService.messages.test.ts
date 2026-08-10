import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { agentSessionDirEnvKeys } from "../../config.js";
import { PiSessionService } from "./piSessionService.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import { CapturingSessionEventHub, emptyArchiveStore, fakeRuntime, fakeSessionManager, runtimeCreator, sessionGateway, sessionRecord, sessionRef, testModelRuntime, type RuntimeCreator } from "./piSessionService.testSupport.js";

const TEST_AGENT_DIR = "/tmp/pi-web-test-agent";

describe("PiSessionService", () => {
  describe("read-only transcript history", () => {
    it("returns an inactive session page from the session manager without starting a runtime", async () => {
      const sessionId = "inactive-history";
      const branch = [
        { type: "message", message: { role: "user", content: [{ type: "text", text: "hi" }] } },
        { type: "thinking_level_change", thinkingLevel: "high" },
        { type: "message", message: { role: "assistant", provider: "openai", model: "gpt-4.1", content: [{ type: "text", text: "answer" }] } },
        { type: "custom_message", display: true, customType: "notice", content: "custom", details: { ok: true } },
        { type: "compaction", summary: "older turns" },
        { type: "message", message: { role: "toolResult", toolName: "bash", content: [{ type: "text", text: "done" }] } },
      ];
      const manager = fakeSessionManager("/workspace", { getSessionId: () => sessionId, getBranch: () => branch });
      const open = vi.fn(() => manager);
      let createCalls = 0;
      const createAgentRuntime: RuntimeCreator = () => {
        createCalls += 1;
        return Promise.reject(new Error("runtime should not be created for history"));
      };
      const events = new CapturingSessionEventHub();
      const service = new PiSessionService(events, {
        agentDir: TEST_AGENT_DIR,
        modelRuntime: testModelRuntime,
        createAgentRuntime,
        archiveStore: emptyArchiveStore(),
        sessionManager: {
          ...sessionGateway([sessionRecord(sessionId)]),
          open,
        },
        heartbeatIntervalMs: 60_000,
      });

      const page = await service.messages(sessionRef(sessionId));

      expect(page).toEqual({
        start: 0,
        total: 5,
        messages: [
          { role: "user", content: [{ type: "text", text: "hi" }] },
          { role: "assistant", provider: "openai", model: "gpt-4.1", content: [{ type: "text", text: "answer" }], thinkingLevel: "high" },
          { role: "custom", content: "custom", customType: "notice", details: { ok: true } },
          { role: "system", source: "compaction", content: "Compacted history:\n\nolder turns" },
          { role: "toolResult", toolName: "bash", content: [{ type: "text", text: "done" }] },
        ],
      });
      expect(createCalls).toBe(0);
      expect(open).toHaveBeenCalledWith(`/sessions/${sessionId}.jsonl`);
      expect(service.activeCount()).toBe(0);
      expect(events.globalEvents).toEqual([]);
      expect(events.sessionEvents).toEqual([]);
      expect(events.notificationSummaryEvents).toEqual([]);
      await service.dispose();
    });

    it("reads a real persisted session file without Forgerie runtime or publication side effects", async () => {
      const root = await mkdtemp(join(tmpdir(), "pi-web-history-open-"));
      try {
        const cwd = join(root, "workspace");
        const agentDir = join(root, "agent");
        const sessionDir = join(root, "sessions");
        const sessionId = "real-history";
        await mkdir(cwd, { recursive: true });
        await mkdir(sessionDir, { recursive: true });
        await writeFile(join(sessionDir, "2026-01-01_real-history.jsonl"), `${[
          JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: "2026-01-01T00:00:00.000Z", cwd }),
          JSON.stringify({ type: "message", id: "m1", parentId: "root", timestamp: "2026-01-01T00:01:00.000Z", message: { role: "user", content: "from disk" } }),
          JSON.stringify({ type: "message", id: "m2", parentId: "m1", timestamp: "2026-01-01T00:02:00.000Z", message: { role: "assistant", provider: "openai", model: "gpt-4.1", content: "read-only" } }),
        ].join("\n")}\n`, "utf8");
        let createCalls = 0;
        const events = new CapturingSessionEventHub();
        const service = new PiSessionService(events, {
          agentDir,
          modelRuntime: testModelRuntime,
          createAgentRuntime: () => {
            createCalls += 1;
            return Promise.reject(new Error("runtime should not be created for disk history"));
          },
          archiveStore: emptyArchiveStore(),
          sessionManager: createPiSessionManagerGateway({
            agentDir,
            env: { PI_WEB_AGENT_SESSION_DIR: sessionDir },
            sessionDirEnvKeys: agentSessionDirEnvKeys(),
          }),
          heartbeatIntervalMs: 60_000,
        });

        const page = await service.messages({ id: sessionId, cwd });

        expect(page).toEqual({
          start: 0,
          total: 2,
          messages: [
            { role: "user", content: "from disk" },
            { role: "assistant", provider: "openai", model: "gpt-4.1", content: "read-only" },
          ],
        });
        expect(createCalls).toBe(0);
        expect(service.activeCount()).toBe(0);
        expect(events.globalEvents).toEqual([]);
        expect(events.sessionEvents).toEqual([]);
        expect(events.notificationSummaryEvents).toEqual([]);
        await service.dispose();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it("uses an already active session manager instead of reopening the session file", async () => {
      const sessionId = "active-history";
      const runtime = fakeRuntime(sessionId, {
        sessionManager: fakeSessionManager("/workspace", {
          getSessionId: () => sessionId,
          getBranch: () => [{ type: "message", message: { role: "user", content: "from active manager" } }],
        }),
      });
      const open = vi.fn(() => fakeSessionManager("/workspace", {
        getBranch: () => [{ type: "message", message: { role: "user", content: "from file" } }],
      }));
      const gateway = { ...sessionGateway([]), open };
      const service = new PiSessionService(new CapturingSessionEventHub(), {
        agentDir: TEST_AGENT_DIR,
        modelRuntime: testModelRuntime,
        createAgentRuntime: runtimeCreator(runtime.runtime),
        archiveStore: emptyArchiveStore(),
        sessionManager: gateway,
        heartbeatIntervalMs: 60_000,
      });

      await service.start("/workspace");
      open.mockClear();
      const page = await service.messages(sessionRef(sessionId));

      expect(page).toEqual({ start: 0, total: 1, messages: [{ role: "user", content: "from active manager" }] });
      expect(open).not.toHaveBeenCalled();
      await service.dispose();
    });

    it("returns an archived session page from its archive path without activating it", async () => {
      const sessionId = "archived-history";
      const archivePath = "/archive/archived-history.jsonl";
      const open = vi.fn((path: string) => fakeSessionManager("/workspace", {
        getSessionId: () => sessionId,
        getBranch: () => path === archivePath
          ? [{ type: "message", message: { role: "user", content: "from archive" } }]
          : [{ type: "message", message: { role: "user", content: "from active store" } }],
      }));
      let createCalls = 0;
      const createAgentRuntime: RuntimeCreator = () => {
        createCalls += 1;
        return Promise.reject(new Error("runtime should not be created for archived history"));
      };
      const events = new CapturingSessionEventHub();
      const service = new PiSessionService(events, {
        agentDir: TEST_AGENT_DIR,
        modelRuntime: testModelRuntime,
        createAgentRuntime,
        archiveStore: {
          ...emptyArchiveStore(),
          get: (id) => Promise.resolve(id === sessionId ? { sessionId, cwd: "/workspace", archivedAt: "2026-01-01T00:00:00.000Z", archivePath } : undefined),
        },
        sessionManager: { ...sessionGateway([sessionRecord(sessionId)]), open },
        heartbeatIntervalMs: 60_000,
      });

      const page = await service.messages(sessionRef(sessionId));

      expect(page).toEqual({ start: 0, total: 1, messages: [{ role: "user", content: "from archive" }] });
      expect(open).toHaveBeenCalledOnce();
      expect(open).toHaveBeenCalledWith(archivePath);
      expect(createCalls).toBe(0);
      expect(service.activeCount()).toBe(0);
      expect(events.globalEvents).toEqual([]);
      expect(events.sessionEvents).toEqual([]);
      expect(events.notificationSummaryEvents).toEqual([]);
      await service.dispose();
    });
  });

  describe("assistant thinking-level attribution", () => {
    function messagesService(branch: unknown[], patch: Parameters<typeof fakeRuntime>[1] = {}) {
      const fake = fakeRuntime("session-1", {
        sessionFile: "/tmp/session-1.jsonl",
        sessionManager: fakeSessionManager("/workspace", { getBranch: () => branch }),
        ...patch,
      });
      const events = new CapturingSessionEventHub();
      const service = new PiSessionService(events, {
        agentDir: TEST_AGENT_DIR,
        modelRuntime: testModelRuntime,
        createAgentRuntime: runtimeCreator(fake.runtime),
        sessionManager: { ...sessionGateway([sessionRecord("session-1")]), open: () => fake.session.sessionManager },
        heartbeatIntervalMs: 60_000,
      });
      return { fake, service, events };
    }

    it("annotates paged assistant messages with the thinking level in effect from branch entries", async () => {
      const branch = [
        { type: "message", message: { role: "user", content: [{ type: "text", text: "hi" }] } },
        { type: "message", message: { role: "assistant", provider: "openai", model: "gpt-4.1", content: [{ type: "text", text: "before any entry" }] } },
        { type: "thinking_level_change", thinkingLevel: "medium" },
        { type: "message", message: { role: "assistant", provider: "openai", model: "gpt-4.1", content: [{ type: "text", text: "first answer" }] } },
        { type: "thinking_level_change", thinkingLevel: "max" },
        { type: "message", message: { role: "assistant", provider: "openai", model: "gpt-4.1", content: [{ type: "text", text: "second answer" }] } },
        { type: "thinking_level_change", thinkingLevel: "off" },
        { type: "message", message: { role: "assistant", provider: "openai", model: "gpt-4.1", content: [{ type: "text", text: "unthinking answer" }] } },
        { type: "message", message: { role: "toolResult", toolName: "bash", content: [{ type: "text", text: "done" }] } },
      ];
      const { service } = messagesService(branch);

      const page = await service.messages(sessionRef("session-1"));

      expect(page).toEqual({
        start: 0,
        total: 6,
        messages: [
        { role: "user", content: [{ type: "text", text: "hi" }] },
        { role: "assistant", provider: "openai", model: "gpt-4.1", content: [{ type: "text", text: "before any entry" }] },
        { role: "assistant", provider: "openai", model: "gpt-4.1", content: [{ type: "text", text: "first answer" }], thinkingLevel: "medium" },
        { role: "assistant", provider: "openai", model: "gpt-4.1", content: [{ type: "text", text: "second answer" }], thinkingLevel: "max" },
        { role: "assistant", provider: "openai", model: "gpt-4.1", content: [{ type: "text", text: "unthinking answer" }] },
        { role: "toolResult", toolName: "bash", content: [{ type: "text", text: "done" }] },
        ],
      });
      await service.dispose();
    });

    it("annotates live assistant message.end events with the session's current thinking level", async () => {
      const { fake, service, events } = messagesService([], { thinkingLevel: "high" });
      await service.status(sessionRef("session-1")); // bring the session online so it publishes events

      fake.emit({ type: "message_end", message: { role: "assistant", provider: "openai", model: "gpt-4.1", content: [{ type: "text", text: "answer" }] } });
      fake.emit({ type: "message_end", message: { role: "user", content: [{ type: "text", text: "next" }] } });

      const messageEnds = events.sessionEvents.map(({ event }) => event).filter((event) => event.type === "message.end");
      expect(messageEnds).toEqual([
        { type: "message.end", message: { role: "assistant", provider: "openai", model: "gpt-4.1", content: [{ type: "text", text: "answer" }], thinkingLevel: "high" } },
        { type: "message.end", message: { role: "user", content: [{ type: "text", text: "next" }] } },
      ]);
      await service.dispose();
    });

    it("annotates the join-time stream snapshot partial with the current thinking level", async () => {
      const streamingMessage = {
        role: "assistant",
        provider: "openai",
        model: "gpt-4.1",
        content: [{ type: "thinking", thinking: "hmm", thinkingSignature: "provider-signature" }],
      };
      const { service } = messagesService([], { thinkingLevel: "xhigh", state: { streamingMessage } });

      const snapshot = await service.streamSnapshot(sessionRef("session-1"));

      expect(snapshot.partial).toEqual({
        role: "assistant",
        provider: "openai",
        model: "gpt-4.1",
        content: [{ type: "thinking", thinking: "hmm" }],
        thinkingLevel: "xhigh",
      });
      await service.dispose();
    });
  });
});
