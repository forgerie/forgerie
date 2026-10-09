import { describe, expect, it } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, emptyArchiveStore, fakeRuntime as sessionRuntime, fakeSessionManager as sessionManager, sessionGateway, sessionRecord, testModelRuntime, type RuntimeCreator } from "./piSessionService.testSupport.js";

function service(records: ReturnType<typeof sessionRecord>[], archived: string[] = [], createAgentRuntime?: RuntimeCreator) {
  return new PiSessionService(new CapturingSessionEventHub(), {
    agentDir: "/tmp/forgerie-cleanup-policy-profile", modelRuntime: testModelRuntime,
    ...(createAgentRuntime === undefined ? {} : { createAgentRuntime }),
    sessionManager: { ...sessionGateway([]), listCatalog: () => Promise.resolve(records) },
    archiveStore: { ...emptyArchiveStore(), list: () => Promise.resolve(archived.map((sessionId) => ({ sessionId, cwd: "/repo", archivedAt: "2026-10-09T00:00:00.000Z" }))) },
  });
}

function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("worktree cleanup session-use policy", () => {
  it("keeps startup sessions and open runtimes before they enter the catalog", async () => {
    const cwd = "/repo/.worktrees/a/subdir";
    const runtime = sessionRuntime("session-1", { sessionManager: sessionManager(cwd) });
    const constructing = latch();
    const constructionReady = latch();
    const binding = latch();
    const bindingReady = latch();
    runtime.session.bindExtensions = () => { binding.resolve(); return bindingReady.promise; };
    const sessions = service([], [], async () => { constructing.resolve(); await constructionReady.promise; return runtime.runtime; });
    const started = sessions.start(cwd);
    try {
      await constructing.promise;
      expect(sessions.activeCount()).toBe(0);
      expect(await sessions.worktreeHasLiveSession("/repo/.worktrees/a")).toBe(true);
      constructionReady.resolve();
      await binding.promise;
      expect(await sessions.worktreeHasLiveSession("/repo/.worktrees/a")).toBe(true);
      bindingReady.resolve();
      await started;
      expect(sessions.activeCount()).toBe(1);
      expect(await sessions.worktreeHasLiveSession("/repo/.worktrees/a")).toBe(true);
    } finally {
      constructionReady.resolve();
      bindingReady.resolve();
      await started;
      await sessions.dispose();
    }
  });

  it("releases a failed construction instead of keeping the checkout in use forever", async () => {
    const sessions = service([], [], () => Promise.reject(new Error("runtime unavailable")));
    try {
      await expect(sessions.start("/repo/.worktrees/a")).rejects.toThrow("runtime unavailable");
      expect(await sessions.worktreeHasLiveSession("/repo/.worktrees/a")).toBe(false);
    } finally { await sessions.dispose(); }
  });

  it("keeps an idle nested session from the full catalog without opening a runtime", async () => {
    const sessions = service([sessionRecord("hidden-child", "/repo/.worktrees/a/subdir")]);
    try {
      expect(await sessions.worktreeHasLiveSession("/repo/.worktrees/a")).toBe(true);
      expect(sessions.activeCount()).toBe(0);
    } finally { await sessions.dispose(); }
  });

  it("keeps an unarchived parent whose cwd is outside the child's checkout", async () => {
    const sessions = service([sessionRecord("owner-full-id", "/repo")]);
    try {
      expect(await sessions.worktreeHasLiveSession("/repo/.worktrees/child", "owner-full-id")).toBe(true);
      expect(await sessions.worktreeHasLiveSession("/repo/.worktrees/child")).toBe(false);
    } finally { await sessions.dispose(); }
  });

  it("does not count archived sessions or a neighboring path as live use", async () => {
    const sessions = service([sessionRecord("archived", "/repo/.worktrees/a"), sessionRecord("neighbor", "/repo/.worktrees/a-next")], ["archived"]);
    try {
      expect(await sessions.worktreeHasLiveSession("/repo/.worktrees/a", "archived")).toBe(false);
    } finally { await sessions.dispose(); }
  });
});
