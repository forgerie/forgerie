import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { agentSessionDirEnvKeys } from "../../config.js";
import { SessionWorktreeStore } from "../workspaces/sessionWorktreeStore.js";
import { SessionWorktrees } from "../workspaces/sessionWorktrees.js";
import { PiSessionService } from "./piSessionService.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import { SessionArchiveStore } from "./sessionArchiveStore.js";
import { CapturingSessionEventHub, testModelRuntime } from "./piSessionService.testSupport.js";

const exec = promisify(execFile);

describe("completed worktree sessions", () => {
  for (const outcome of ["landed", "discarded"] as const) {
    it(`reads real ${outcome} transcripts after checkout removal and daemon reconstruction without starting Pi`, async () => {
      const root = await mkdtemp(join(tmpdir(), "forgerie-worktree-readonly-"));
      let service: PiSessionService | undefined;
      try {
        const repo = join(root, "repo");
        const agentDir = join(root, "agent");
        await mkdir(repo);
        const git = (...args: string[]) => exec("git", ["-C", repo, ...args]);
        await git("init", "-b", "main");
        await git("config", "user.name", "Test");
        await git("config", "user.email", "test@example.invalid");
        await writeFile(join(repo, ".gitignore"), ".sessions/\n");
        await git("add", ".");
        await git("commit", "-m", "base");
        const statePath = join(root, "worktrees.json");
        const store = new SessionWorktreeStore(statePath);
        await store.initialize();
        const worktrees = new SessionWorktrees(store);
        const record = await worktrees.create(repo);
        const sessionDir = join(record.path, ".sessions");
        await mkdir(sessionDir);
        const id = "real-history";
        const path = join(sessionDir, "2026-01-01_real-history.jsonl");
        await writeFile(path, [
          { type: "session", version: 3, id, timestamp: "2026-01-01T00:00:00.000Z", cwd: record.path },
          { type: "message", id: "m1", parentId: null, timestamp: "2026-01-01T00:01:00.000Z", message: { role: "user", content: "from disk" } },
          { type: "message", id: "m2", parentId: "m1", timestamp: "2026-01-01T00:02:00.000Z", message: { role: "assistant", provider: "openai", model: "gpt-4.1", content: "preserved answer" } },
        ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
        const ref = { id, cwd: record.path };
        const session = { ...ref, path, created: "2026-01-01T00:00:00.000Z", modified: "2026-01-01T00:02:00.000Z", messageCount: 2, firstMessage: "from disk" };
        await worktrees.attach(record.id, session);
        if (outcome === "landed") await worktrees.land(record.id, [session]);
        else await worktrees.discard(record.id, (await worktrees.discardPreview(record.id)).confirmationToken, [session]);
        const reloaded = new SessionWorktreeStore(statePath);
        await reloaded.initialize();
        let runtimeCalls = 0;
        service = new PiSessionService(new CapturingSessionEventHub(), {
          agentDir, modelRuntime: testModelRuntime,
          archiveStore: new SessionArchiveStore(join(root, "archives.json")),
          sessionWorktrees: new SessionWorktrees(reloaded),
          createAgentRuntime: () => { runtimeCalls++; return Promise.reject(new Error("Cannot start Pi in a removed worktree")); },
          sessionManager: createPiSessionManagerGateway({ agentDir, env: { PI_WEB_AGENT_SESSION_DIR: sessionDir }, sessionDirEnvKeys: agentSessionDirEnvKeys() }),
          heartbeatIntervalMs: 60_000,
        });
        expect((await service.messages(ref)).messages).toEqual([{ role: "user", content: "from disk" }, { role: "assistant", provider: "openai", model: "gpt-4.1", content: "preserved answer" }]);
        expect(await service.status(ref)).toMatchObject({ readOnly: true, messageCount: 2, worktree: { state: { kind: outcome } } });
        expect(await service.streamSnapshot(ref)).toMatchObject({ partial: null });
        expect((await service.machineListing()).sessions.find((item) => item.id === id)?.worktree?.state.kind).toBe(outcome);
        expect((await service.list(record.path)).map((item) => item.id)).toContain(id);
        await expect(service.prompt(ref, "continue")).rejects.toThrow("read-only");
        await expect(service.reload(ref)).rejects.toThrow("read-only");
        await expect(service.start(record.path)).rejects.toThrow("closed");
        await service.archive(ref);
        expect((await service.messages(ref)).total).toBe(2);
        expect(await service.status(ref)).toMatchObject({ readOnly: true });
        await service.restore(ref);
        expect((await service.messages(ref)).total).toBe(2);
        await service.pin(ref);
        expect((await service.list(record.path)).find((item) => item.id === id)?.pinned).toBe(true);
        await service.unpin(ref);
        const archivedAgain = await service.archiveMany([ref]);
        expect(archivedAgain.archivedSessionIds).toContain(id);
        expect((await service.messages(ref)).total).toBe(2);
        const deletion = await service.deleteArchivedMany([ref]);
        expect(deletion.deletedSessionIds).toContain(id);
        expect((await service.machineListing()).sessions.map((item) => item.id)).not.toContain(id);
        expect(runtimeCalls).toBe(0);
      } finally { await service?.dispose(); await rm(root, { recursive: true, force: true }); }
    });
  }
});
