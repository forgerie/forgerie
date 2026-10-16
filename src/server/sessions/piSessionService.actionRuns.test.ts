import { WorkspaceActivityService } from "../activity/workspaceActivityService.js";
import { SessionPinStore } from "./sessionPinStore.js";
import { SessionTabsStore } from "./sessionTabsStore.js";
import { SessionNotificationStore } from "./sessionNotificationStore.js";
import { SessionUnreadStore } from "./sessionUnreadStore.js";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { sessionServiceDependencies } from "../sessiond/sessionServiceDependencies.js";
import { createActiveDurableSessionReader } from "../sessiond/durableSessionReader.js";
import type { ArchivedSessionRecord } from "./sessionArchiveStore.js";
import { CapturingSessionEventHub, fakeRuntime, runtimeCreator, sessionGateway, sessionRecord, testModelRuntime } from "./piSessionService.testSupport.js";

function fixture() {
  const manager = SessionManager.inMemory("/workspace");
  const id = manager.getSessionId();
  const stops: unknown[] = [];
  const sent: unknown[] = [];
  let archived: ArchivedSessionRecord | undefined;
  const runtime = fakeRuntime(id, { sessionManager: manager,
    sendCustomMessage: (message, options) => {
      sent.push([message, options]); manager.appendCustomMessageEntry(message.customType, message.content, message.display, message.details); return Promise.resolve();
    } });
  const service = new PiSessionService(new CapturingSessionEventHub(), { ...sessionServiceDependencies({
    pinStore: new SessionPinStore(), tabsStore: new SessionTabsStore(), workspaceActivity: new WorkspaceActivityService(),
    logger: { info() { /* No test log output. */ } }, durableReader: createActiveDurableSessionReader(() => undefined), notificationStore: new SessionNotificationStore(), unreadStore: new SessionUnreadStore(),
    catalogRefreshStatus: { isRefreshInFlight: () => false }, askUserEnabled: true, codemodeEnabled: false,
    github: { read: () => Promise.resolve(""), write: () => Promise.resolve({ text: "" }) }, extensionDialogsTimeoutMs: 300_000,
    agentDir: "/tmp/action-runs-profile", modelRuntime: testModelRuntime, sessionManager: sessionGateway([sessionRecord(id)]),
    archiveStore: {
      list: () => Promise.resolve(archived === undefined ? [] : [archived]), get: () => Promise.resolve(archived), isArchived: () => Promise.resolve(archived !== undefined), restore: () => Promise.resolve(),
      archive: input => { archived = { sessionId: input.sessionId, cwd: input.cwd, archivedAt: "2026-10-01T12:00:00Z" }; return Promise.resolve(archived); },
      deleteArchived: () => { archived = undefined; return Promise.resolve(); },
    },
    actionRunWatches: { isWatching: () => true, stop: (id, reason) => { stops.push([id, reason]); return Promise.resolve(); } },
  }), createAgentRuntime: runtimeCreator(runtime.runtime), heartbeatIntervalMs: 60_000 });
  return { service, manager, runtime, stops, sent, ref: { id, cwd: "/workspace" } };
}

describe("Pi Actions run watch integration", () => {
  it("publishes the status/list flag through the daemon dependency assembly", async () => {
    const f = fixture();
    try {
      await f.service.start("/workspace");
      expect(await f.service.status(f.ref)).toMatchObject({ watchingActionRun: true });
      expect((await f.service.list("/workspace"))[0]).toMatchObject({ watchingActionRun: true });
    } finally { await f.service.dispose(); }
  });
  it("writes deduplicated forgerie:action-run notices with details.noticeId, without changing PR notices", async () => {
    const f = fixture();
    try {
      await f.service.start("/workspace");
      const notice = { id: "run-notice", text: "run news" };
      f.runtime.session.isStreaming = true;
      expect(await f.service.wakePullSession(f.ref, notice, () => true, "forgerie:action-run")).toBe("busy");
      expect(f.sent).toEqual([]); f.runtime.session.isStreaming = false;
      await f.service.wakePullSession(f.ref, notice, () => true, "forgerie:action-run");
      expect(await f.service.wakePullSession(f.ref, notice, () => true, "forgerie:action-run")).toBe("delivered");
      expect(f.manager.getBranch()).toContainEqual(expect.objectContaining({ type: "custom_message", customType: "forgerie:action-run", details: { noticeId: "run-notice" } }));
      await f.service.wakePullSession(f.ref, { id: "pr-notice", text: "PR news" }, () => true);
      expect(f.manager.getBranch()).toContainEqual(expect.objectContaining({ type: "custom_message", customType: "forgerie:pull-request", details: { noticeId: "pr-notice" } }));
      expect(f.sent).toHaveLength(2);
    } finally { await f.service.dispose(); }
  });
  it("stops all run watches on Abort, Stop, archive and delete", async () => {
    const f = fixture();
    try {
      await f.service.start("/workspace");
      await f.service.abort(f.ref); await f.service.stop(f.ref);
      await f.service.archive(f.ref);
      const deleted = await f.service.deleteArchivedMany([f.ref]);
      expect(deleted).toMatchObject({ deleted: true, deletedSessionIds: [f.ref.id], failures: [] });
      expect(f.stops).toEqual([[f.ref.id, "Session aborted by request."], [f.ref.id, "Session stopped by request."], [f.ref.id, "Session archived or deleted."], [f.ref.id, "Session archived or deleted."]]);
    } finally { await f.service.dispose(); }
  });
});
