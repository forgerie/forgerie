#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 -c npx tsx
// TRIGGERS_REAL=1 ./scripts/triggers-real.ts. Owns only a temporary profile, repository and loopback daemon.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { PiSessionService } from "../src/server/sessions/piSessionService.js";
import { SessionEventHub } from "../src/server/realtime/sessionEventHub.js";
import { createPiSessionManagerGateway, defaultPiSessionDir } from "../src/server/sessions/piSessionManagerGateway.js";
import { SessionArchiveStore } from "../src/server/sessions/sessionArchiveStore.js";
import { createDurableChildHost, LiveChildSessionIndex } from "../src/server/sessions/durableChildHost.js";
import { ChildRunStore } from "../src/server/sessions/childRunStore.js";
import { registerSessionRoutes } from "../src/server/sessions/sessionRoutes.js";
import { registerWorkflowRoutes } from "../src/server/sessions/workflowRoutes.js";
import { WorkflowLibrary, assertProseOnly, workflowInputs } from "../src/server/resources/workflowLibrary.js";
import { ProjectService } from "../src/server/projects/projectService.js";
import { ProjectStore } from "../src/server/storage/projectStore.js";
import { WorkspaceService } from "../src/server/workspaces/workspaceService.js";
import { RegisteredProjectWorkspaceCwds } from "../src/server/workspaces/projectWorkspaceCwds.js";
import { sanitizedGitEnv } from "../src/server/git/gitEnv.js";
import { TriggerService } from "../src/server/triggers/triggerService.js";
import { registerTriggerRoutes } from "../src/server/triggers/triggerRoutes.js";
import { triggerSessionId, workflowTriggerFire } from "../src/server/triggers/triggerFire.js";
import { TriggerSchema } from "../src/shared/triggers.js";

if (process.env.TRIGGERS_REAL !== "1") throw new Error("Set TRIGGERS_REAL=1 to authorize real-model acceptance");
const credentials: unknown = JSON.parse(await readFile(`${process.env.HOME}/.local/share/forgerie/agent/cliproxyapi.json`, "utf8"));
if (!Check(Type.Object({ baseUrl: Type.String(), apiKey: Type.String() }), credentials)) throw new Error("Live CLIProxyAPI config is unavailable");
const root = await mkdtemp(join(tmpdir(), "forgerie-triggers-real-"));
const agentDir = join(root, "agent");
const cwd = join(root, "workspace");
const model = process.env.TRIGGERS_MODEL ?? "deepseek-v4.1-flash";
await mkdir(agentDir, { mode: 0o700 }); await mkdir(cwd);
process.once("exit", () => { rmSync(join(agentDir, "models.json"), { force: true }); });
await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { "trigger-acceptance": {
  baseUrl: credentials.baseUrl.replace(/\/$/u, "").replace(/\/v1$/u, "") + "/v1", apiKey: credentials.apiKey, api: "openai-completions",
  models: [{ id: model, name: "Trigger acceptance", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 4096 }],
} } }), { mode: 0o600 });
await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "trigger-acceptance", defaultModel: model, defaultThinkingLevel: "off", packages: [], compaction: { enabled: false } }));
const git = (...args: string[]) => execFileSync("git", args, { cwd, env: sanitizedGitEnv(), encoding: "utf8" });
git("init", "-b", "main"); git("config", "user.email", "acceptance@example.invalid"); git("config", "user.name", "Trigger acceptance");
await writeFile(join(cwd, "README.md"), "Trigger acceptance workspace\n"); git("add", "README.md"); git("commit", "-qm", "Initial workspace");
await mkdir(join(cwd, ".pi", "prompts"), { recursive: true });
await writeFile(join(cwd, ".pi", "prompts", "nightly.md"), "---\ndescription: Real scheduled trigger acceptance\nworkflow:\n  version: 1\n  stages:\n    - { id: prepare, name: Prepare, does: 'State a one-sentence acceptance result.' }\n    - { id: land, name: Land, stop: land }\n---\nDo not write files, run shell commands, spawn children, or call workflow_finish. This acceptance needs no code changes. State one sentence confirming the scheduled workflow started. Then call workflow_stop for stage land with the runId from this prompt, summary TRIGGERS-REAL. End your turn and wait for the user.\n");
const projects = new ProjectService(new ProjectStore(join(root, "projects.json"))); await projects.add({ path: cwd });
const workspaces = new RegisteredProjectWorkspaceCwds({ projects, workspaces: new WorkspaceService() });
const library = new WorkflowLibrary(agentDir);
const models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
// Schedules have minute resolution. Use the production clock seam to place that minute four seconds ahead.
const occurrence = (Math.floor(Date.now() / 60_000) + 1) * 60_000;
let shift = occurrence - 4_000 - Date.now();
const now = () => Date.now() + shift;
let interrupted = false;
async function daemon(hold: boolean) {
  const hub = new SessionEventHub();
  const archive = new SessionArchiveStore(join(root, "archive.json")); await archive.initialize();
  const records = new ChildRunStore(join(root, "child-runs.json"));
  const sessions = new PiSessionService(hub, { agentDir, modelRuntime: models, archiveStore: archive,
    sessionManager: createPiSessionManagerGateway({ agentDir, env: { HOME: root }, sessionDirEnvKeys: [] }),
    durableChildAgents: createDurableChildHost({ runRecords: records, index: new LiveChildSessionIndex(join(root, "children.json")) }),
  });
  const triggers = await TriggerService.open({ env: { PI_WEB_DATA_DIR: root }, workflows: library, workspaces, now,
    fire: workflowTriggerFire({ sessions,
      requireWorkspace: async (value) => { if (await workspaces.forCwd(value) === undefined) throw new Error("Unregistered workspace"); },
      validateAction: async (action) => { const workflow = await library.read(action.cwd, action.workflow); assertProseOnly(workflow); workflowInputs(workflow.definition, action.inputs); },
      afterStep: async (step, _request, context) => {
        if (!hold || step !== "workflow") return;
        interrupted = true;
        await new Promise<never>((_resolve, reject) => { context.abortSignal?.addEventListener("abort", () => { reject(new Error("acceptance restart")); }, { once: true }); });
      },
    }), publish: () => { hub.publishGlobal({ type: "triggers.changed" }); }, onError: (error) => { throw error; },
  });
  const app = Fastify(); await app.register(websocket);
  registerTriggerRoutes(app, triggers); registerSessionRoutes(app, sessions, hub); registerWorkflowRoutes(app, sessions);
  const address = await app.listen({ port: 0, host: "127.0.0.1" });
  return { address, sessions, triggers, close: async () => { await triggers.close(); await sessions.dispose(); await records.stop(); await app.close(); } };
}
let current: Awaited<ReturnType<typeof daemon>> | undefined;
try {
  current = await daemon(true);
  shift = occurrence - 4_000 - Date.now();
  const time = new Date(occurrence).toISOString().slice(11, 16);
  const response = await fetch(`${current.address}/triggers`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "night", name: "Nightly acceptance", schedule: { kind: "daily", at: time, timezone: "UTC" }, action: { kind: "workflow", cwd, workflow: "nightly", inputs: {}, model: `trigger-acceptance/${model}`, thinkingLevel: "off" } }) });
  assert.equal(response.status, 201, await response.text());
  const deadline = Date.now() + 300_000;
  while (!interrupted) { if (Date.now() > deadline) throw new Error("No scheduled launch before deadline"); await sleep(100); }
  const running: unknown = await (await fetch(`${current.address}/triggers/night`)).json();
  assert.ok(Check(TriggerSchema, running)); assert.equal(running.history[0]?.outcome.kind, "running");
  await current.close(); current = undefined;
  current = await daemon(false);
  for (;;) {
    const trigger = await current.triggers.get("night");
    const fire = trigger.history[0];
    if (fire?.outcome.kind === "failed") throw new Error(fire.outcome.error);
    if (fire?.outcome.kind === "started") {
      const ref = { id: fire.outcome.sessionId, cwd };
      const runs = await current.sessions.workflowRuns(ref);
      if (runs[0]?.stops?.["land"]?.state === "waiting" && !(await current.sessions.status(ref)).isStreaming) {
        const files = (await readdir(defaultPiSessionDir(cwd, agentDir))).filter((name) => name.endsWith(".jsonl"));
        const journals = await readdir(join(defaultPiSessionDir(cwd, agentDir), ".durable"));
        assert.equal(files.length, 1); assert.deepEqual(journals, files); assert.equal(runs.length, 1); assert.equal(trigger.history.length, 1);
        assert.equal(ref.id, triggerSessionId(fire.requestId, occurrence));
        assert.equal((await current.sessions.list(cwd))[0]?.name, `Nightly acceptance · ${new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(occurrence)}`);
        const summary = { root, model, sessions: files.length, journals: journals.length, runs: runs.length, history: trigger.history.length, restartedDuring: "fire-after-workflow-launch", land: "waiting" };
        await writeFile(join(root, "results.json"), JSON.stringify({ summary, trigger, runs }, null, 2));
        console.log(JSON.stringify(summary));
        break;
      }
    }
    if (Date.now() > deadline) throw new Error(`Land stop not reached: ${JSON.stringify(trigger)}`);
    await sleep(250);
  }
} finally { await current?.close(); await rm(join(agentDir, "models.json"), { force: true }); }
