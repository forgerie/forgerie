import Fastify from "fastify";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentSessionDirEnvKeys } from "../../config.js";
import { PullRequestService } from "../github/pullRequestService.js";
import { PullRequestStore } from "../github/pullRequestStore.js";
import { registerPullRequestRoutes } from "../github/pullRequestRoutes.js";
import { pullSnapshot, PR_TIME } from "../github/pullRequest.testSupport.js";
import { SessionWorktreeStore } from "../workspaces/sessionWorktreeStore.js";
import { SessionWorktrees } from "../workspaces/sessionWorktrees.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, testModelRuntime } from "./piSessionService.testSupport.js";
import { SessionArchiveStore } from "./sessionArchiveStore.js";

async function fixture(mode: "writable" | "archived" | "read-only" = "writable") {
  const root = await mkdtemp(join(tmpdir(), "pull-discovery-session-"));
  const cwd = join(root, "workspace"), sessionDir = join(root, "sessions");
  await mkdir(cwd); await mkdir(sessionDir);
  const ref = { id: "known-session", cwd }, path = join(sessionDir, "2026-10-07_known-session.jsonl");
  await writeFile(path, JSON.stringify({ type: "session", version: 3, id: ref.id, cwd, timestamp: PR_TIME }) + "\n");
  const session = { ...ref, path, created: PR_TIME, modified: PR_TIME, messageCount: 0, firstMessage: "" };
  const archives = new SessionArchiveStore(join(root, "archives.json"));
  const worktrees = new SessionWorktreeStore(join(root, "worktrees.json"));
  if (mode === "archived") await archives.archive({ ...session, sessionId: ref.id });
  if (mode === "read-only") {
    await worktrees.add({ id: "owned-worktree", repo: root, path: cwd, branch: "task", defaultBranch: "main", renamed: false,
      setup: { phase: "done", log: "" }, state: { kind: "active" }, cleanup: { kind: "done" }, transcripts: [], createdAt: PR_TIME, updatedAt: PR_TIME });
    await worktrees.saveTranscripts("owned-worktree", [session]);
    await worktrees.update("owned-worktree", { state: { kind: "discarded", at: PR_TIME } });
    await rm(path);
  }
  let runtimeCalls = 0;
  const sessions = new PiSessionService(new CapturingSessionEventHub(), {
    agentDir: join(root, "agent"), modelRuntime: testModelRuntime, archiveStore: archives, sessionWorktrees: new SessionWorktrees(worktrees),
    sessionManager: createPiSessionManagerGateway({ agentDir: join(root, "agent"), env: { PI_WEB_AGENT_SESSION_DIR: sessionDir }, sessionDirEnvKeys: agentSessionDirEnvKeys() }),
    createAgentRuntime: () => { runtimeCalls++; return Promise.reject(new Error("Discovery must not start a runtime")); }, heartbeatIntervalMs: 60_000,
  });
  const providerCalls: string[] = [];
  const snapshot = pullSnapshot();
  const store = new PullRequestStore();
  const pulls = new PullRequestService({ store,
    github: {
      repo: () => { providerCalls.push("repo"); return Promise.resolve({ slug: snapshot.pull.repo, everyone: true }); },
      openPulls: () => { providerCalls.push("open"); return Promise.resolve({ repo: snapshot.pull.repo, items: [{ ...snapshot.pull, state: "open" as const }], complete: true }); },
      pull: () => { providerCalls.push("preview"); return Promise.resolve(snapshot); },
      mergePull: () => { throw new Error("Discovery must not merge"); },
    },
    sessions: { inspect: target => sessions.inspectPullSession(target), wake: () => { throw new Error("Discovery must not wake a session"); } },
    onError: error => { throw error; },
  });
  const app = Fastify(); registerPullRequestRoutes(app, pulls);
  return { ref, sessions, pulls, providerCalls, runtimeCalls: () => runtimeCalls, app, store,
    close: async () => { pulls.dispose(); await app.close(); await sessions.dispose(); await rm(root, { recursive: true, force: true }); } };
}

describe("PR discovery admission through the production session gateway", () => {
  it("rejects unknown sessions and another cwd before any provider read, over both service and HTTP contracts", async () => {
    const f = await fixture();
    try {
      for (const target of [{ ...f.ref, id: "unknown-session" }, { ...f.ref, cwd: join(f.ref.cwd, "other") }]) {
        await expect(f.pulls.open(target)).rejects.toThrow("Session not found");
        await expect(f.pulls.preview(target, 9)).rejects.toThrow("Session not found");
        for (const tail of ["open", "9/preview"]) {
          const response = await f.app.inject(`/sessions/${target.id}/pull-requests/${tail}?${new URLSearchParams({ cwd: target.cwd })}`);
          expect(response.statusCode).toBe(400);
          expect(response.json()).toMatchObject({ kind: "pull_request_error", error: "Session not found." });
        }
        expect(await f.sessions.inspectPullSession(target)).toMatchObject({ exists: false, available: false });
      }
      expect(f.providerCalls).toEqual([]);
      expect(f.runtimeCalls()).toBe(0);
      expect(f.store.list()).toEqual([]);
    } finally { await f.close(); }
  });

  it.each(["writable", "archived", "read-only"] as const)("allows %s session discovery without opening a runtime or changing links", async mode => {
    const f = await fixture(mode);
    try {
      expect(await f.sessions.inspectPullSession(f.ref)).toMatchObject({ exists: true, available: mode === "writable" });
      expect(await f.pulls.open(f.ref)).toMatchObject({ items: [{ number: 9 }] });
      expect(await f.pulls.preview(f.ref, 9)).toMatchObject({ pull: { number: 9 } });
      for (const tail of ["open", "9/preview"]) {
        const response = await f.app.inject(`/sessions/${f.ref.id}/pull-requests/${tail}?${new URLSearchParams({ cwd: f.ref.cwd })}`);
        expect(response.statusCode).toBe(200);
      }
      expect(f.runtimeCalls()).toBe(0);
      expect(f.store.list()).toEqual([]);
    } finally { await f.close(); }
  });
});
