#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 -c npx tsx
// FILE_ISSUE_REAL=1 nix shell nixpkgs#nodejs_24 -c npx tsx scripts/file-issue-real.ts
// Real model; temporary profile and workspace; all GitHub requests use an in-memory API.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { PiSessionService } from "../src/server/sessions/piSessionService.js";
import { emptyArchiveStore } from "../src/server/sessions/piSessionService.testSupport.js";
import { SessionEventHub } from "../src/server/realtime/sessionEventHub.js";
import { createPiSessionManagerGateway } from "../src/server/sessions/piSessionManagerGateway.js";
import { GitHubAgent } from "../src/server/github/githubAgent.js";
import { FileIssueResultSchema, type FileIssueResult } from "../src/shared/fileIssues.js";

if (process.env.FILE_ISSUE_REAL !== "1") throw new Error("Set FILE_ISSUE_REAL=1 to authorize real-model acceptance");
const source: unknown = JSON.parse(await readFile(`${process.env.HOME}/.local/share/forgerie/agent/cliproxyapi.json`, "utf8"));
if (!Check(Type.Object({ baseUrl: Type.String(), apiKey: Type.String() }), source)) throw new Error("The live CLIProxyAPI config is unavailable");
const root = await mkdtemp(join(tmpdir(), "forgerie-file-issue-real-"));
const agentDir = join(root, "agent"); const cwd = join(root, "workspace");
await mkdir(agentDir, { mode: 0o700 }); await mkdir(cwd);
process.once("exit", () => { rmSync(join(agentDir, "models.json"), { force: true }); });
const model = process.env.FILE_ISSUE_MODEL ?? "deepseek-v4.1-flash";
await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { "issue-acceptance": {
  baseUrl: source.baseUrl.replace(/\/$/u, "").replace(/\/v1$/u, "") + "/v1", apiKey: source.apiKey, api: "openai-completions",
  models: [{ id: model, name: "Issue acceptance", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 8192 }],
} } }), { mode: 0o600 });
await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "issue-acceptance", defaultModel: model, defaultThinkingLevel: "off", packages: [], compaction: { enabled: false } }));
const requests: { method: string; url: string; body: unknown }[] = [];
const labels = new Set<string>();
const issue = (number: number, title: string) => ({ number, title, body: "Details", state: "closed", html_url: `https://github.com/acceptance/scratch/issues/${String(number)}`, user: { login: "acceptance" }, author_association: "OWNER", labels: [], updated_at: "2026-10-13T00:00:00Z", comments: 0 });
const existing = issue(7, "Portal reconnect loses queued messages");
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
let next = 20;
const github = new GitHubAgent({
  resolveRepo: async () => ({ slug: "acceptance/scratch", everyone: true }),
  app: { tokenFor: async () => ({ ok: true, token: "in-memory" }), dropToken: () => undefined, status: () => ({ state: "not-configured" }) },
  trust: { judge: async () => () => true },
  fetch: async (url, init) => {
    const method = init?.method ?? "GET";
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    requests.push({ method, url, body });
    if (url.startsWith("https://api.github.com/search/issues")) return json({ total_count: 1, items: [existing], incomplete_results: false });
    if (url.includes("/labels") && method === "GET") return json([...labels].map(name => ({ name, description: null })));
    if (url.endsWith("/labels") && method === "POST") { labels.add("agent-filed"); return json({ name: "agent-filed", description: "Filed by an agent" }, 201); }
    if (url.endsWith("/issues") && method === "POST" && Check(Type.Object({ title: Type.String() }), body)) return json({ ...issue(next++, body.title), state: "open", labels: "labels" in body ? body.labels : [] }, 201);
    if (url.endsWith("/issues/7") && method === "GET") return json(existing);
    throw new Error(`No in-memory answer for ${method} ${url}`);
  },
});
const models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
const service = new PiSessionService(new SessionEventHub(), { agentDir, modelRuntime: models, archiveStore: emptyArchiveStore(),
  sessionManager: createPiSessionManagerGateway({ agentDir, env: { HOME: root }, sessionDirEnvKeys: [] }),
  github: { read: (cwd, request) => github.read(cwd, request), write: (cwd, id, request) => github.write(cwd, id, request), fileIssue: (cwd, id, input) => github.fileIssue(cwd, id, input) },
});
const ref = { id: (await service.start(cwd)).id, cwd };
let closing = false;
async function close() { if (closing) return; closing = true; await service.dispose(); await rm(join(agentDir, "models.json"), { force: true }); }
process.once("SIGTERM", () => { void close(); }); process.once("SIGINT", () => { void close(); });
async function results(): Promise<FileIssueResult[]> {
  return (await service.messages(ref)).messages.flatMap(row => {
    if (typeof row !== "object" || row === null || !("toolName" in row) || row.toolName !== "file_issue" || !("details" in row) || !Check(FileIssueResultSchema, row.details)) return [];
    return [row.details];
  });
}
async function until(what: string, check: (rows: FileIssueResult[]) => boolean) {
  const deadline = Date.now() + 300000;
  while (true) {
    const rows = await results();
    if (check(rows) && !(await service.status(ref)).isStreaming) return rows;
    if (closing || Date.now() > deadline) throw new Error(`Timed out waiting for ${what}: ${JSON.stringify((await service.messages(ref)).messages)}`);
    await sleep(500);
  }
}
try {
  await service.prompt(ref, `This is a safe acceptance test: GitHub is an in-memory API, not a real repository. Search open and closed issues for portal reconnect. Then deliberately call file_issue once with title "Portal reconnect loses messages", body "Queued messages disappear during reconnect", and duplicates containing your search query. We need to observe the tool's duplicate refusal, so call it even if github_read finds issue #7. After refusal, stop and report the duplicate. Do not override #7 or file a second issue yet. Do not write files or use bash.`);
  const refused = await until("duplicate refusal", rows => rows.some(row => row.state === "duplicate"));
  assert.equal(requests.filter(row => row.method === "POST" && row.url.endsWith("/issues")).length, 0);
  assert.equal((await service.decisions(ref)).length, 0);
  await service.prompt(ref, `Now file different work: title "Export decision log as JSON", body "Add a JSON export for the session decision log". First search open and closed issues for decision log export, then use file_issue with the queries in duplicates. Do not use notDuplicateOf: this title is distinct. Stop after filing. Do not write files or use bash.`);
  const rows = await until("distinct issue filing", rows => rows.some(row => row.state === "created"));
  const created = rows.find(row => row.state === "created"); assert.ok(created?.state === "created"); assert.equal(created.agentFiled, true);
  const writes = requests.filter(row => row.method === "POST" && row.url.endsWith("/issues"));
  assert.equal(writes.length, 1); assert.ok(Check(Type.Object({ labels: Type.Array(Type.String()) }), writes[0]?.body));
  assert.ok(writes[0].body.labels.includes("agent-filed"));
  assert.equal(requests.filter(row => row.method === "POST" && row.url.endsWith("/labels")).length, 1);
  const decisions = await service.decisions(ref); assert.equal(decisions.length, 1); assert.equal(decisions[0]?.kind, "issue"); assert.equal(decisions[0]?.flagged, false);
  await writeFile(join(root, "results.json"), JSON.stringify({ model, ref, refused, rows, requests, decisions }, null, 2));
  console.log(JSON.stringify({ root, model, checks: "real agent searched, duplicate refused without writes or decisions, stopped, distinct issue filed with agent-filed created once, parent issue decision logged" }));
  await close();
} catch (error) { await close(); throw error; }
