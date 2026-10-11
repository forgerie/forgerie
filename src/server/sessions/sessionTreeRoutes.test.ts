import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { describe, expect, it, vi } from "vitest";
import type { SessionTreeSnapshot, SessionTreeResponse } from "../../shared/apiTypes.js";
import { agentSessionDirEnvKeys } from "../../config.js";
import { registerSessionProxyRoutes } from "../sessiond/sessionProxyRoutes.js";
import { SessionWorktreeStore } from "../workspaces/sessionWorktreeStore.js";
import { SessionWorktrees } from "../workspaces/sessionWorktrees.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import { PiSessionService } from "./piSessionService.js";
import { SessionArchiveStore } from "./sessionArchiveStore.js";
import { CapturingSessionEventHub, testModelRuntime } from "./piSessionService.testSupport.js";
import { registerSessionRoutes } from "./sessionRoutes.js";
import { searchEntry, writeSearchSession } from "./sessionSearch.testSupport.js";

const exec = promisify(execFile);

describe("read-only session tree GET", () => {
  it.each(["active", "landed", "discarded"] as const)("reads a %s worktree's full tree without starting Pi or changing state", async (state) => {
    const root = await mkdtemp(join(tmpdir(), "session-tree-route-"));
    const app = Fastify(); const browser = Fastify();
    let service: PiSessionService | undefined;
    try {
      const repo = join(root, "repo"); await mkdir(repo);
      const git = (...args: string[]) => exec("git", ["-C", repo, ...args]);
      await git("init", "-b", "main"); await git("config", "user.name", "Test"); await git("config", "user.email", "test@example.invalid");
      await writeFile(join(repo, ".gitignore"), ".sessions/\n"); await git("add", "."); await git("commit", "-m", "base");
      const statePath = join(root, "worktrees.json");
      const store = new SessionWorktreeStore(statePath); await store.initialize();
      const worktrees = new SessionWorktrees(store); const record = await worktrees.create(repo);
      const sessionDir = join(record.path, ".sessions"); const path = join(sessionDir, "session.jsonl");
      const id = "tree-session"; const ref = { id, cwd: record.path };
      const entries = [searchEntry("root", null, "root prompt"), searchEntry("other", "root", "other branch reply", "assistant"), searchEntry("current", "root", "current branch reply", "assistant")];
      await writeSearchSession(path, id, entries, { cwd: ref.cwd });
      // SDK open() would migrate this legacy receipt and repair its final newline.
      // A tree GET must leave both writable files and saved receipts unchanged.
      await writeFile(path, (await readFile(path, "utf8")).replace('"version":3', '"version":2').trimEnd());
      const session = { ...ref, path, created: "2026-01-01T00:00:00.000Z", modified: "2026-01-01T00:00:00.000Z", messageCount: 3, firstMessage: "root prompt" };
      await worktrees.attach(record.id, session);
      if (state === "landed") await worktrees.land(record.id, [session]);
      if (state === "discarded") await worktrees.discard(record.id, (await worktrees.discardPreview(record.id)).confirmationToken, [session]);
      const reloaded = new SessionWorktreeStore(statePath); await reloaded.initialize();
      const readonly = await reloaded.readOnly(ref); const transcriptPath = readonly?.transcriptPath ?? path;
      const transcriptBefore = await readFile(transcriptPath, "utf8"); const ownershipBefore = await readFile(statePath, "utf8");
      const archives = new SessionArchiveStore(join(root, "archives.json")); const restore = vi.spyOn(archives, "restore");
      const createAgentRuntime = vi.fn(() => Promise.reject(new Error("Tree reads must not start a runtime")));
      const events = new CapturingSessionEventHub();
      const assertWritable = vi.spyOn(reloaded, "assertWritable");
      service = new PiSessionService(events, {
        agentDir: join(root, "agent"), modelRuntime: testModelRuntime, archiveStore: archives,
        sessionWorktrees: new SessionWorktrees(reloaded), createAgentRuntime,
        sessionManager: createPiSessionManagerGateway({ agentDir: join(root, "agent"), env: { PI_WEB_AGENT_SESSION_DIR: sessionDir }, sessionDirEnvKeys: agentSessionDirEnvKeys() }),
        heartbeatIntervalMs: 60_000,
      });
      await app.register(websocket); registerSessionRoutes(app, service, events);
      await browser.register(websocket);
      const forward = { request: async (method: string, url: string) => {
        if (method !== "GET") throw new Error("Unexpected method");
        const response = await app.inject({ method, url });
        return { statusCode: response.statusCode, headers: { "content-type": "application/json" }, body: response.body };
      }, connectWebSocket: () => { throw new Error("Not used"); } };
      registerSessionProxyRoutes(browser, forward); registerSessionProxyRoutes(browser, forward, "/api/machines/local");
      const query = "?cwd=" + encodeURIComponent(ref.cwd);
      const expected: SessionTreeSnapshot = {
        nodes: [
          { id: "root", parentId: null, kind: "user", summary: "root prompt", timestamp: "2026-01-01T00:00:00.000Z" },
          { id: "other", parentId: "root", kind: "assistant", summary: "other branch reply", timestamp: "2026-01-01T00:00:00.000Z" },
          { id: "current", parentId: "root", kind: "assistant", summary: "current branch reply", timestamp: "2026-01-01T00:00:00.000Z" },
        ], activeLeafId: "current", activePathIds: ["root", "current"],
      };
      for (const prefix of ["", "/api", "/api/machines/local"]) {
        const server = prefix === "" ? app : browser;
        const response = await server.inject(prefix + "/sessions/" + id + "/tree" + query);
        expect(response.statusCode).toBe(200);
        expect(response.json<SessionTreeResponse>()).toEqual({ tree: expected });
        const unknown = await server.inject(prefix + "/sessions/unknown/tree" + query);
        expect(unknown.statusCode).toBe(404);
        expect(unknown.json<{ error: string }>().error).toBe("Session not found");
      }
      expect((await app.inject("/sessions/" + id + "/tree")).statusCode).toBe(400);
      expect((await app.inject("/sessions/" + id + "/tree?cwd=relative")).statusCode).toBe(400);
      expect(createAgentRuntime).not.toHaveBeenCalled(); expect(assertWritable).not.toHaveBeenCalled(); expect(restore).not.toHaveBeenCalled();
      expect(service.activeCount()).toBe(0);
      expect(events.sessionEvents).toEqual([]); expect(events.globalEvents).toEqual([]);
      expect(await readFile(transcriptPath, "utf8")).toBe(transcriptBefore);
      expect(await readFile(statePath, "utf8")).toBe(ownershipBefore);
      expect((await reloaded.require(record.id)).state.kind).toBe(state);
    } finally { await browser.close(); await app.close(); await service?.dispose(); await rm(root, { recursive: true, force: true }); }
  });
});
