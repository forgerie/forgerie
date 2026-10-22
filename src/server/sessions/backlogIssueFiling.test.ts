import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry } from "@earendil-works/pi-durable";
import { expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import { CapturingSessionEventHub } from "./piSessionService.testSupport.js";
import { SessionArchiveStore } from "./sessionArchiveStore.js";
import { DurableJournalPool } from "./durableJournalPool.js";
import { readDurableSessionLocator } from "./durableSessionLocator.js";
import { durableSessionPaths } from "./durableSessionJournal.js";
import { decisions } from "./durableDecisions.js";
import { UserSessionWorktrees } from "../workspaces/sessionWorktreeRoutes.js";
import { repository } from "../backlog/suggestions/suggestionTestSupport.js";

it.each(["archived", "removed-worktree"] as const)("files and logs for a real %s chat without resuming it", async kind => {
  const repo = await repository(); const agentDir = join(repo.root, ".git/agent"); await mkdir(agentDir);
  const models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
  const provider = fauxProvider({ tokensPerSecond: 100000 }); models.registerNativeProvider(provider.provider); await models.refresh({ allowNetwork: false });
  let requests = 0; let writes = 0;
  provider.setResponses(Array.from({ length: 20 }, () => () => { requests++; return fauxAssistantMessage("Done"); }));
  const service = new PiSessionService(new CapturingSessionEventHub(), { agentDir, modelRuntime: models, sessionWorktrees: repo.worktrees,
    archiveStore: new SessionArchiveStore(join(agentDir, "archive.json")),
    sessionManager: createPiSessionManagerGateway({ agentDir, env: { HOME: repo.root }, sessionDirEnvKeys: [] }),
    github: { read: () => Promise.resolve(""), write: () => Promise.resolve({ text: "" }), fileIssue: (_cwd, _id, input) => { writes++; return Promise.resolve({ state: "created", repo: "owner/repo", number: 9, title: input.title, url: "https://github.com/owner/repo/issues/9", agentFiled: true }); } },
  });
  const pool = new DurableJournalPool();
  try {
    const session = kind === "archived" ? await service.start(repo.root, { initialModelSpec: "faux/faux-1" })
      : await new UserSessionWorktrees(repo.worktrees, service).start({ cwd: repo.root, modelSpec: "faux/faux-1", destination: { kind: "fresh-worktree" } });
    const ref = { id: session.id, cwd: session.cwd };
    await service.prompt(ref, "Persist this session");
    await vi.waitFor(async () => { expect(requests).toBeGreaterThan(0); expect(JSON.stringify((await service.messages(ref)).messages)).toContain("Done"); expect((await service.status(ref)).isStreaming).toBe(false); }, { timeout: 5000 });
    const address = service.activeDurableRead(ref)?.address; if (address === undefined) throw new Error("Missing live journal");
    if (kind === "archived") await service.archive(ref);
    else {
      const record = await repo.worktrees.store.forSession(ref); if (record === undefined) throw new Error("Missing owned worktree");
      const affected = await service.prepareWorktreeRemoval(ref.cwd);
      expect(await repo.worktrees.land(record.id, affected)).toMatchObject({ kind: "landed", cleanup: { kind: "done" } });
    }
    expect(service.activeDurableRead(ref)).toBeUndefined(); const before = requests;
    const result = await service.fileBacklogIssue(repo.root, ref.id, { title: "Improve launch recovery", body: "Context", duplicates: ["Improve launch recovery"] }, "owner/repo");
    expect(result).toMatchObject({ state: "created", number: 9 }); expect(result).not.toHaveProperty("decisionLogWarning"); expect(writes).toBe(1); expect(requests).toBe(before);
    const handle = await pool.acquire(address, { models: createModels(), registry: createRegistry() }, context);
    try { expect(await decisions(handle.harness, handle.conversation.id, context)).toMatchObject([{ id: "issue:owner/repo:9", kind: "issue" }]); }
    finally { await handle.release(context); }
    // The discovery pointer continues to name the saved journal, not the removed checkout.
    expect((await readDurableSessionLocator(durableSessionPaths(session.path).directory))?.journalId).toBe(address.journalId);
  } finally { await service.dispose(); await pool.close(context); await rm(agentDir, { recursive: true, force: true }); await repo.dispose(); }
}, 15000);
