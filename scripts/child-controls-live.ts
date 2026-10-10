#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 -c npx tsx
// Opt-in real-model acceptance. Owns only a temporary profile, repository, and loopback server.
// Run from the worktree root with CHILD_CONTROLS_REAL=1. Never touches production sessions or Git checkouts.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { PiSessionService } from "../src/server/sessions/piSessionService.js";
import { CapturingSessionEventHub, emptyArchiveStore } from "../src/server/sessions/piSessionService.testSupport.js";
import { createPiSessionManagerGateway } from "../src/server/sessions/piSessionManagerGateway.js";
import { LiveChildSessionIndex, createDurableChildHost } from "../src/server/sessions/durableChildHost.js";
import { ChildRunStore } from "../src/server/sessions/childRunStore.js";
import { SessionWorktreeStore } from "../src/server/workspaces/sessionWorktreeStore.js";
import { SessionWorktrees } from "../src/server/workspaces/sessionWorktrees.js";
import { registerDurableChildRoutes } from "../src/server/sessions/durableChildRoutes.js";
import { WorktreeCleanupJob } from "../src/server/workspaces/worktreeCleanupJob.js";
import { registerWorktreeCleanupRoutes } from "../src/server/workspaces/worktreeCleanupRoutes.js";
import { registerChildRunRoutes } from "../src/server/sessions/childRunRoutes.js";

if (process.env.CHILD_CONTROLS_REAL !== "1") throw new Error("Set CHILD_CONTROLS_REAL=1 to authorize the real-model test");
const root = await mkdtemp(join(tmpdir(), "forgerie-child-controls-real-"));
const agentDir = join(root, "agent");
const cwd = join(root, "workspace");
const execute = promisify(execFile);
const git = async (...args: string[]) => execute("git", args, { cwd });
await mkdir(agentDir, { recursive: true, mode: 0o700 });
await mkdir(cwd);
const provider = JSON.parse(await readFile(`${process.env.HOME}/.local/share/forgerie/agent/cliproxyapi.json`, "utf8"));
const baseUrl = String(provider.baseUrl).replace(/\/$/, "").replace(/\/v1$/, "") + "/v1";
await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { "child-acceptance": { baseUrl, apiKey: provider.apiKey, api: "openai-completions", models: [{ id: "deepseek-v4.1-flash", name: "Acceptance", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 8192 }] } } }), { mode: 0o600 });
await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "child-acceptance", defaultModel: "deepseek-v4.1-flash", defaultThinkingLevel: "off", packages: [], compaction: { enabled: false } }));
await mkdir(join(agentDir, "agents"));
await writeFile(join(agentDir, "agents", "acceptance.md"), "---\nname: acceptance\ndescription: Writes the specified acceptance file and commits it.\ntools: read,write,bash\n---\nDo only the requested file operation. Run each Git command separately. Do not inspect other directories.\n");
await git("init", "-b", "main"); await git("config", "user.email", "test@example.invalid"); await git("config", "user.name", "Acceptance");
await writeFile(join(cwd, "base.txt"), "base\n"); await git("add", "base.txt"); await git("commit", "-m", "base");
const store = new SessionWorktreeStore(join(root, "worktrees.json")); await store.initialize();
const worktrees = new SessionWorktrees(store);
const records = new ChildRunStore(join(root, "runs.json"));
const models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
const service = new PiSessionService(new CapturingSessionEventHub(), { agentDir, modelRuntime: models,
  sessionManager: createPiSessionManagerGateway({ agentDir, env: { HOME: root }, sessionDirEnvKeys: [] }), archiveStore: emptyArchiveStore(),
  durableChildAgents: createDurableChildHost({ worktrees, runRecords: records, index: new LiveChildSessionIndex(join(root, "live.json")) }) });
const app = Fastify();
registerDurableChildRoutes(app, service, "/api"); registerChildRunRoutes(app, records, "/api");
const cleanup = new WorktreeCleanupJob({ worktrees, inUse: async () => true });
registerWorktreeCleanupRoutes(app, cleanup, "/api");
const ref = { id: (await service.start(cwd)).id, cwd };
await app.listen({ host: "127.0.0.1", port: 8540 });
console.log(JSON.stringify({ root, ref, port: 8540 }));
let closing = false;
async function close() {
  if (closing) return; closing = true;
  await cleanup.stop(); await service.dispose(); await app.close(); await records.stop();
  await rm(join(agentDir, "models.json"), { force: true }); // Contains the temporary credential copy.
}
process.once("SIGTERM", () => { void close(); }); process.once("SIGINT", () => { void close(); });
try {
  for (const name of ["builder", "disposable"]) {
    const file = `${name}.txt`;
    await service.prompt(ref, `Use child_agent to spawn exactly one child: name ${name}, agent acceptance, isolation worktree. Its task: write ${file} containing exactly CHILD-CONTROLS-${name}, then git add ${file} and git commit -m 'acceptance ${name}' as separate commands. Do not change any other file. Parent must not do the work. After the child reports, reply only Recorded.`);
    const deadline = Date.now() + 180_000;
    for (;;) {
      const child = (await service.durableChildren(ref)).find((item) => item.name === name);
      const messages = (await service.messages(ref, { limit: 100 })).messages;
      if (child?.worktree && child.worktree.ahead > 0 && !child.busy && JSON.stringify(messages).includes(`[subagent ${name} answered`)) break;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${name}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  await cleanup.run();
  const seed = { root, ref, children: await service.durableChildren(ref) };
  await writeFile("/tmp/child-controls-live-seed.json", JSON.stringify(seed));
  console.log("CHILD_CONTROLS_READY");
} catch (error) { await close(); throw error; }
