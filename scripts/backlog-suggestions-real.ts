#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 -c npx tsx
// BACKLOG_SUGGESTIONS_REAL=1 npx tsx scripts/backlog-suggestions-real.ts
// Real model, temporary Git project/profile, and an in-memory GitHub API. Never pushes.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import Fastify from "fastify";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { PiSessionService } from "../src/server/sessions/piSessionService.js";
import { emptyArchiveStore } from "../src/server/sessions/piSessionService.testSupport.js";
import { SessionEventHub } from "../src/server/realtime/sessionEventHub.js";
import { createPiSessionManagerGateway } from "../src/server/sessions/piSessionManagerGateway.js";
import { GitHubAgent } from "../src/server/github/githubAgent.js";
import { BacklogSuggestionStore } from "../src/server/backlog/suggestions/suggestionStore.js";
import { BacklogSuggestionService } from "../src/server/backlog/suggestions/suggestionService.js";
import { registerBacklogSuggestionRoutes } from "../src/server/backlog/suggestions/suggestionRoutes.js";
import { BacklogSettingsStore } from "../src/server/backlog/backlogSettingsStore.js";
import { BacklogClaimStore } from "../src/server/backlog/backlogClaimStore.js";
import { BacklogService } from "../src/server/backlog/backlogService.js";
import { SessionWorktrees } from "../src/server/workspaces/sessionWorktrees.js";
import { SessionWorktreeStore } from "../src/server/workspaces/sessionWorktreeStore.js";
import { UserSessionWorktrees } from "../src/server/workspaces/sessionWorktreeRoutes.js";
import type { BacklogSuggestion } from "../src/shared/backlogSuggestions.js";

if (process.env.BACKLOG_SUGGESTIONS_REAL !== "1") throw new Error("Set BACKLOG_SUGGESTIONS_REAL=1 to authorize real-model acceptance");
const source: unknown = JSON.parse(await readFile(`${process.env.HOME}/.local/share/forgerie/agent/cliproxyapi.json`, "utf8"));
if (!Check(Type.Object({ baseUrl: Type.String(), apiKey: Type.String() }), source)) throw new Error("Real model config is unavailable");
const root = await mkdtemp(join(tmpdir(), "forgerie-suggestions-real-"));
const cwd = join(root, "project"); const agentDir = join(root, "agent"); await mkdir(cwd); await mkdir(agentDir, { mode: 0o700 });
const execute = promisify(execFile);
const git = async (...args: string[]) => (await execute("git", ["-C", cwd, ...args], { env: { ...process.env, FORGERIE_MANAGED_WORKTREE_SETUP: "1" } })).stdout.trim();
await git("init", "-b", "main"); await git("config", "user.name", "Suggestion Acceptance"); await git("config", "user.email", "acceptance@example.test");
await writeFile(join(cwd, "README.md"), "Temporary acceptance project. Never push.\n"); await git("add", "."); await git("commit", "-m", "initial");
const model = process.env.BACKLOG_SUGGESTIONS_MODEL ?? "deepseek-v4.1-flash";
await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { "suggestion-acceptance": { baseUrl: source.baseUrl.replace(/\/$/u, "").replace(/\/v1$/u, "") + "/v1", apiKey: source.apiKey, api: "openai-completions", models: [{ id: model, name: "Suggestion acceptance", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 8192 }] } } }), { mode: 0o600 });
await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "suggestion-acceptance", defaultModel: model, defaultThinkingLevel: "off", packages: [], compaction: { enabled: false } }));
process.once("exit", () => { rmSync(join(agentDir, "models.json"), { force: true }); });
const requests: { method: string; url: string; body: unknown }[] = []; const labels = new Set<string>();
const issue = (number: number, title: string, labels: string[] = []) => ({ number, title, body: "Existing", state: "open", html_url: `https://github.com/acceptance/scratch/issues/${number}`, user: { login: "acceptance" }, author_association: "OWNER", labels, updated_at: "2026-10-20T00:00:00Z", comments: 0 });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const github = new GitHubAgent({ resolveRepo: async () => ({ slug: "acceptance/scratch", everyone: true }), trust: { judge: async () => () => true },
  app: { tokenFor: async () => ({ ok: true, token: "memory" }), dropToken: () => undefined, status: () => ({ state: "not-configured" }) },
  fetch: async (url, init) => {
    const method = init?.method ?? "GET"; const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : {}; requests.push({ method, url, body });
    if (url.includes("/search/issues")) return json({ total_count: 1, items: [issue(7, "Improve launch recovery")], incomplete_results: false });
    if (url.includes("/labels") && method === "GET") return json([...labels].map(name => ({ name, description: null })));
    if (url.endsWith("/labels") && method === "POST") { labels.add("agent-filed"); return json({ name: "agent-filed", description: "Agent filed" }, 201); }
    if (url.endsWith("/issues") && method === "POST" && Check(Type.Object({ title: Type.String(), labels: Type.Array(Type.String()) }), body)) return json(issue(20, body.title, body.labels), 201);
    throw new Error(`Unexpected in-memory GitHub call ${method} ${url}`);
  },
});
const project = { id: "acceptance", name: "Acceptance", path: cwd, createdAt: new Date().toISOString() };
const projects = { list: async () => [project], requireProject: async () => project };
const settings = new BacklogSettingsStore(join(root, "backlog-settings.json")); await settings.save(project.id, { providers: ["github"] }, 0);
const store = new BacklogSuggestionStore(join(root, "backlog-suggestions.json")); await store.initialize();
const claims = new BacklogClaimStore(join(root, "backlog-claims.json")); await claims.initialize();
const worktrees = new SessionWorktrees(new SessionWorktreeStore(join(root, "worktrees.json")));
const models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
const sessions: PiSessionService = new PiSessionService(new SessionEventHub(), { agentDir, modelRuntime: models, archiveStore: emptyArchiveStore(), sessionWorktrees: worktrees,
  sessionManager: createPiSessionManagerGateway({ agentDir, env: { HOME: root }, sessionDirEnvKeys: [] }),
  backlogSuggestions: { suggest: (cwd, id, input, context) => suggestions.suggest(cwd, id, input, context) },
  github: { read: (cwd, input) => github.read(cwd, input), write: (cwd, id, input) => github.write(cwd, id, input), fileIssue: (cwd, id, input, repo) => github.fileIssue(cwd, id, input, repo) },
});
const backlog: BacklogService = new BacklogService({ projects, settings, claims, userSessions: new UserSessionWorktrees(worktrees, sessions), sessions, isArchived: async () => false });
const suggestions: BacklogSuggestionService = new BacklogSuggestionService({ store, projects, settings, worktrees, backlog, githubRepo: async () => "acceptance/scratch", fileIssue: (cwd, id, input, repo) => sessions.fileBacklogIssue(cwd, id, input, repo) });
const app = Fastify(); registerBacklogSuggestionRoutes(app, suggestions, "/api");
const ref = { id: (await sessions.start(cwd)).id, cwd };
let closing = false;
async function close() { if (closing) return; closing = true; await app.close(); await sessions.dispose(); await rm(join(agentDir, "models.json"), { force: true }); }
process.once("SIGTERM", () => { void close(); }); process.once("SIGINT", () => { void close(); });
async function assistantSaid(ref: { id: string; cwd: string }, marker: string): Promise<boolean> {
  return (await sessions.messages(ref)).messages.some(message => typeof message === "object" && message !== null && "role" in message && message.role === "assistant" && JSON.stringify(message).includes(marker));
}
async function until(what: string, check: () => Promise<boolean>) {
  const deadline = Date.now() + 300000;
  while (!await check()) { if (closing || Date.now() > deadline) throw new Error(`Timed out: ${what}`); await sleep(300); }
}
async function click(id: string, action: string, body: object): Promise<BacklogSuggestion> {
  const response = await app.inject({ method: "POST", url: `/api/backlog/suggestions/${id}/${action}`, payload: body });
  assert.equal(response.statusCode, 200, response.body); return response.json<BacklogSuggestion>();
}
try {
  await sessions.prompt(ref, `Safe acceptance test in a temporary repo. Call suggest_backlog exactly once, not file_issue, with title "Improve launch recovery", body "Retain the initial prompt", why "A launch retry can lose context", files ["src/launch.ts"], decisions ["Use durable prompt receipts"]. Keep working after the tool by replying SUGGESTION_OK. Do not use bash or change files.`);
  await until("real-model suggestion and continued reply", async () => store.list().length === 1 && await assistantSaid(ref, "SUGGESTION_OK") && !(await sessions.status(ref)).isStreaming);
  assert.equal(requests.filter(request => request.method === "POST").length, 0);
  const first = store.list()[0]!;
  assert.equal((await click(first.id, "file", { requestId: "duplicate" })).state.kind, "duplicate");
  const filed = await click(first.id, "file", { requestId: "anyway", notDuplicateOf: [7] }); assert.equal(filed.state.kind, "filed");
  assert.equal((await sessions.decisions(ref)).length, 1); assert.ok(labels.has("agent-filed"));
  await settings.save(project.id, { providers: ["markdown"], suggestions: { modelSpec: `suggestion-acceptance/${model}`, thinkingLevel: "off" } }, (await settings.read()).projects[project.id]!.revision);
  await sessions.prompt(ref, `Now call suggest_backlog exactly once for title "Background acceptance proof". Its body must say "This is an isolated acceptance test. Reply BACKGROUND_OK only. Do not use tools, change files, or file more items." Set why "Verify background launch", files ["README.md"], decisions ["Use a fresh worktree"]. After suggesting, reply SECOND_SUGGESTION_OK. Do not file it yourself.`);
  await until("second suggestion", async () => store.list().length === 2 && await assistantSaid(ref, "SECOND_SUGGESTION_OK") && !(await sessions.status(ref)).isStreaming);
  const second = store.list().find(record => record.id !== first.id)!;
  const started = await click(second.id, "file-and-act", { requestId: "background" }); assert.equal(started.state.kind, "started");
  assert.deepEqual(await click(second.id, "file-and-act", { requestId: "background" }), started);
  if (started.state.kind !== "started") throw new Error("Background session did not start");
  const backgroundSessionId = started.state.sessionId;
  const background = (await sessions.machineListing()).sessions.find(session => session.id === backgroundSessionId)!;
  await until("server-delivered background prompt", async () => await assistantSaid({ id: background.id, cwd: background.cwd }, "BACKGROUND_OK") && !(await sessions.status({ id: background.id, cwd: background.cwd })).isStreaming);
  assert.equal((await worktrees.store.list()).length, 1); assert.equal((await sessions.machineListing()).sessions.filter(session => session.id === background.id).length, 1);
  assert.equal(second.destination.provider, "markdown"); if (second.destination.provider === "markdown") assert.ok((await readFile(join(cwd, second.destination.path), "utf8")).includes("## Context"));
  const evidence = { model, ref, suggestions: store.list(), requests, background, parentMessages: (await sessions.messages(ref)).messages, backgroundMessages: (await sessions.messages({ id: background.id, cwd: background.cwd })).messages, checks: "real parent suggest/continue; no auto-filing; GitHub duplicate/File anyway/agent-filed/decision; Markdown commit/fast-forward; server-prompted fresh-worktree background; request replay starts once" };
  await writeFile(join(root, "results.json"), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify({ root, model, checks: evidence.checks }));
} finally { await close(); }
