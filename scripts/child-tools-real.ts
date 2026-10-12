#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 -c npx tsx
// Opt-in real-model acceptance. Owns only a temporary profile, workspace, and in-process daemon.
// RESEARCH_CREDENTIAL_FILE supplies a private JSON file with baseUrl and apiKey, as in workflow-real.ts.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { effectivePiWebConfig } from "../src/config.js";
import { PiSessionService } from "../src/server/sessions/piSessionService.js";
import { emptyArchiveStore } from "../src/server/sessions/piSessionService.testSupport.js";
import { SessionEventHub } from "../src/server/realtime/sessionEventHub.js";
import { createPiSessionManagerGateway } from "../src/server/sessions/piSessionManagerGateway.js";
import { createDurableChildHost } from "../src/server/sessions/durableChildHost.js";
import { bundledSubagentsPackagePath } from "../src/server/sessions/bundledSubagents.js";

if (process.env.RESEARCH_REAL !== "1") throw new Error("Set RESEARCH_REAL=1 to authorize real-model acceptance (provider costs apply)");
const credentialFile = process.env.RESEARCH_CREDENTIAL_FILE;
if (!credentialFile) throw new Error("Set RESEARCH_CREDENTIAL_FILE to a private JSON file with baseUrl and apiKey");
const source: unknown = JSON.parse(await readFile(credentialFile, "utf8"));
if (!Check(Type.Object({ baseUrl: Type.String(), apiKey: Type.String() }), source)) throw new Error("Model credentials are unavailable");
const model = process.env.RESEARCH_MODEL;
if (!model) throw new Error("Set RESEARCH_MODEL to the model id available through the supplied credentials");
const root = await mkdtemp(join(tmpdir(), "forgerie-child-tools-real-"));
const agentDir = join(root, "agent");
const cwd = join(root, "workspace");
const configPath = join(root, "config.json");
let service: PiSessionService | undefined;
let closing = false;
const started = Date.now();
// The profile must never survive even a failed package install. SIGKILL remains outside this cleanup contract.
process.once("exit", () => { rmSync(root, { recursive: true, force: true }); });
async function close() {
  if (closing) return;
  closing = true;
  try { await service?.dispose(); }
  finally { await rm(root, { recursive: true, force: true }); }
}
process.once("SIGTERM", () => { void close().finally(() => process.exit(143)); });
process.once("SIGINT", () => { void close().finally(() => process.exit(130)); });
try {
  await mkdir(agentDir, { mode: 0o700 });
  await mkdir(cwd);
  // pi-web-access resolves configuration via this environment variable. Never let it see the live profile.
  process.env.PI_CODING_AGENT_DIR = agentDir;
  delete process.env.BRAVE_SEARCH_API_KEY;
  delete process.env.SERPER_API_KEY;
  await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { "research-acceptance": {
    baseUrl: source.baseUrl.replace(/\/$/u, "").replace(/\/v1$/u, "") + "/v1", apiKey: source.apiKey, api: "openai-completions",
    models: [{ id: model, name: "Research acceptance", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 8192 }],
  } } }), { mode: 0o600 });
  // Pi installs this exact package into the temporary profile from its settings, independently of Forgerie's bundles.
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "research-acceptance", defaultModel: model,
    defaultThinkingLevel: "off", packages: ["npm:pi-web-access@0.39.0"], compaction: { enabled: false } }));
  await mkdir(join(agentDir, "extensions"));
  const auditPath = join(root, "tool-audit.jsonl");
  await writeFile(join(agentDir, "extensions", "tool-audit.ts"), `import { appendFileSync } from "node:fs";
export default function(pi) {
  for (const type of ["tool_call", "tool_result"]) pi.on(type, (event) => {
    if (!["web_search", "fetch_content"].includes(event.toolName)) return;
    appendFileSync(${JSON.stringify(auditPath)}, JSON.stringify({ type, tool: event.toolName, id: event.toolCallId, at: Date.now() }) + "\\n");
  });
}
`);
  await writeFile(configPath, JSON.stringify({ durableChildren: true, codemode: false, childToolsDeny: [] }));
  const config = effectivePiWebConfig({ env: { HOME: root, PI_WEB_CONFIG: configPath } }).config;
  assert.equal(config.durableChildren, true);
  const models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
  service = new PiSessionService(new SessionEventHub(), { agentDir, modelRuntime: models, archiveStore: emptyArchiveStore(), codemodeEnabled: config.codemode,
    sessionManager: createPiSessionManagerGateway({ agentDir, env: { HOME: root }, sessionDirEnvKeys: [] }),
    durableChildAgents: createDurableChildHost({ childToolsDeny: config.childToolsDeny, builtinAgentsDirs: [join(bundledSubagentsPackagePath(), "agents")] }),
  });
  const ref = { id: (await service.start(cwd)).id, cwd };
  const readyMs = Date.now() - started;
  const task = "Bounded tool acceptance, not a full research brief. Call web_search exactly once with queries [\"Node.js official documentation\"], workflow none. Then call fetch_content exactly once with url https://nodejs.org/en/about. Do not use source_check or get_search_content, do not write files, and do not call other tools. Reply with a short account of both results, including the fetched page title. Stop after these two calls.";
  await service.prompt(ref, `Use child_agent to spawn exactly one child named research using agent researcher, shared isolation, model research-acceptance/${model}:off. Give it this exact task: ${task} You must not search or fetch yourself. After spawn, reply Started. After the child's report, reply Recorded and do not spawn again.`);
  const deadline = Date.now() + 240000;
  let child;
  for (;;) {
    if (closing) throw new Error("Acceptance stopped");
    const children = await service.durableChildren(ref);
    assert.ok(children.length <= 1, "Expected exactly one child");
    child = children[0];
    if (child !== undefined && !child.busy && (await service.durableChildMessages(ref, child.conversationId)).messages.some((message) => message.role === "toolResult" && message.toolName === "fetch_content")) break;
    if (Date.now() > deadline) throw new Error("Timed out waiting for researcher web_search and fetch_content");
    await sleep(300);
  }
  assert.equal(child.agent, "researcher");
  const messages = (await service.durableChildMessages(ref, child.conversationId)).messages;
  const calls = messages.flatMap((message) => message.role === "assistant" ? message.content.filter((part) => part.type === "toolCall") : []);
  assert.deepEqual(calls.map((call) => call.name).sort(), ["fetch_content", "web_search"]);
  const results = messages.flatMap((message) => message.role === "toolResult" ? [message] : []);
  assert.equal(results.length, 2);
  const summary = results.map((result) => {
    assert.equal(result.isError, false, `${result.toolName} failed`);
    const text = result.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
    assert.ok(text.length > 100, `${result.toolName} returned no useful content`);
    assert.ok(!text.includes("Not available here"));
    return { tool: result.toolName, callId: result.toolCallId, isError: result.isError, chars: text.length, preview: text.slice(0, 350), timestamp: result.timestamp };
  });
  // Wait for the completion report and its parent turn too, so cleanup does not truncate them.
  while ((await service.status(ref)).isStreaming || (await service.durableChildren(ref)).some((item) => item.busy)) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for child reporting");
    await sleep(300);
  }
  const Audit = Type.Object({ type: Type.String(), tool: Type.String(), id: Type.String(), at: Type.Number() });
  const audit = (await readFile(auditPath, "utf8")).trim().split("\n").map((line) => {
    const item: unknown = JSON.parse(line);
    assert.ok(Check(Audit, item));
    return item;
  });
  const timings = ["web_search", "fetch_content"].map((tool) => {
    const start = audit.find((item) => item.tool === tool && item.type === "tool_call");
    const end = audit.find((item) => item.tool === tool && item.type === "tool_result");
    assert.ok(start && end, `${tool} did not pass both extension hooks`);
    assert.equal(start.id, end.id);
    assert.ok(start.id.startsWith(`child:${String(child.conversationId)}:`), "Expected a child-specific SDK call id");
    return { tool, sdkCallId: start.id, durationMs: end.at - start.at };
  });
  console.log(JSON.stringify({ model, agent: child.agent, readyMs, elapsedMs: Date.now() - started, calls: calls.map((call) => ({ tool: call.name, args: call.arguments })), results: summary, timings, checks: "named session tools, real researcher, keyless search and fetch, and extension hooks passed" }, null, 2));
} finally { await close(); }
