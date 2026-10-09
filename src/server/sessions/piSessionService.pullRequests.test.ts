import { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { SESSION_RESPONSE_CUSTOM_TYPE } from "./sessionResponse.js";
import { CapturingSessionEventHub, emptyArchiveStore, fakeRuntime, runtimeCreator, sessionGateway, testModelRuntime } from "./piSessionService.testSupport.js";

function fixture() {
  const manager = SessionManager.inMemory("/workspace");
  const id = manager.getSessionId();
  const stops: unknown[] = [];
  const sent: unknown[] = [];
  const options: unknown[] = [];
  const runtime = fakeRuntime(id, { sessionManager: manager,
    sendCustomMessage: (message, sendOptions) => { sent.push(message); options.push(sendOptions); manager.appendCustomMessageEntry(message.customType, message.content, message.display, message.details); return Promise.resolve(); } });
  const service = new PiSessionService(new CapturingSessionEventHub(), {
    agentDir: "/tmp/pr-runtime-profile", modelRuntime: testModelRuntime, archiveStore: emptyArchiveStore(), sessionManager: sessionGateway([]), createAgentRuntime: runtimeCreator(runtime.runtime), heartbeatIntervalMs: 60_000,
    pullRequestWatches: { isWatching: () => true, stop: (sessionId, reason) => { stops.push([sessionId, reason]); return Promise.resolve(); } },
  });
  return { service, manager, runtime, stops, sent, options, ref: { id, cwd: "/workspace" } };
}

describe("Pi PR watch integration", () => {
  it("keeps running undeclared turns unsettled and exposes an idle watch as Working data", async () => {
    const f = fixture();
    try {
      await f.service.start("/workspace");
      f.manager.appendCustomEntry(SESSION_RESPONSE_CUSTOM_TYPE, { version: 1, kind: "started" });
      f.runtime.session.isStreaming = true;
      expect((await f.service.inspectPullSession(f.ref)).settled).toBe(false);
      expect(await f.service.status(f.ref)).toMatchObject({ watchingPullRequest: true });
      f.runtime.session.isStreaming = false;
      expect((await f.service.inspectPullSession(f.ref)).settled).toBe(true);
      f.manager.appendCustomEntry(SESSION_RESPONSE_CUSTOM_TYPE, { version: 1, kind: "declared", awaiting: "nothing" });
      expect((await f.service.inspectPullSession(f.ref)).settled).toBe(false);
      f.manager.appendCustomEntry(SESSION_RESPONSE_CUSTOM_TYPE, { version: 1, kind: "declared", awaiting: "reply" });
      expect((await f.service.inspectPullSession(f.ref)).settled).toBe(true);
    } finally { await f.service.dispose(); }
  });
  it("does not wake busy sessions and deduplicates accepted notices from the real session branch", async () => {
    const f = fixture();
    try {
      await f.service.start("/workspace");
      f.runtime.session.isStreaming = true;
      const notice = { id: "notice-1", text: "check failed" };
      expect(await f.service.wakePullSession(f.ref, notice, () => true)).toBe("busy");
      expect(f.sent).toEqual([]);
      f.runtime.session.isStreaming = false;
      expect(await f.service.wakePullSession(f.ref, notice, () => false)).toBe("busy");
      expect(f.sent).toEqual([]);
      await f.service.wakePullSession(f.ref, notice, () => true);
      expect(await f.service.wakePullSession(f.ref, notice, () => true)).toBe("delivered");
      expect(f.sent).toHaveLength(1);
      expect(f.manager.getBranch()).toContainEqual(expect.objectContaining({ type: "custom_message", customType: "forgerie:pull-request", details: { noticeId: "notice-1" } }));
    } finally { await f.service.dispose(); }
  });
  it("writes a panel merge into the transcript without starting a turn", async () => {
    const f = fixture();
    try {
      await f.service.start("/workspace");
      const details = { kind: "merged" as const, repo: "o/r", number: 9, headSha: "a".repeat(40), method: "rebase" as const, base: "main" };
      await f.service.notePullSession(f.ref, { text: "The user merged pull request #9.", details });
      expect(f.options).toEqual([{ triggerTurn: false }]);
      expect(f.manager.getBranch()).toContainEqual(expect.objectContaining({ type: "custom_message", customType: "forgerie:pull-request", display: true, details }));
    } finally { await f.service.dispose(); }
  });
  it("stops the watcher on both Abort and Stop, and refuses an abbreviated id", async () => {
    const f = fixture();
    try {
      await f.service.start("/workspace");
      await expect(f.service.inspectPullSession({ ...f.ref, id: f.ref.id.slice(0, 8) })).rejects.toThrow("full session id");
      await f.service.abort(f.ref); await f.service.stop(f.ref);
      expect(f.stops).toEqual([[f.ref.id, "Session aborted by request."], [f.ref.id, "Session stopped by request."]]);
    } finally { await f.service.dispose(); }
  });
});
