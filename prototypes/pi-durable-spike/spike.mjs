#!/usr/bin/env -S /run/current-system/sw/bin/nix shell nixpkgs#nodejs_22 -c node
// Pi Durable crash-recovery spike for Forgerie. Throwaway.
//
//   spike.mjs probe                 list proxy models the spike can use
//   spike.mjs run <stateDir>        start the job; meant to be SIGKILLed mid-tool
//   spike.mjs resume <stateDir>     reopen storage, resume, wait for the same job
//
// The job asks the model to call fetch_reading (replay: "safe") and then
// record_result (no replay). Each tool logs every attempt with its task id, so
// the crash test can see exactly what ran twice.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels, createProvider, Type } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { createRegistry, defineExtension, defineTool, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

const context = BACKGROUND_CONTEXT;
const PROFILE = "/home/simonwjackson/.local/share/forgerie/agent/cliproxyapi.json";
const proxy = JSON.parse(readFileSync(PROFILE, "utf8"));
const BASE = `${proxy.baseUrl.replace(/\/+$/, "")}/v1`;
const MODEL_ID = process.env.SPIKE_MODEL ?? "deepseek-v4.1-flash";
const TOOL_SECONDS = Number(process.env.SPIKE_TOOL_SECONDS ?? 8);
const REQUEST_ID = "forgerie-spike-job-1";
const PROMPT = [
  "Call the fetch_reading tool exactly once.",
  "Then call the record_result tool exactly once with the reading it returned.",
  "Then reply with exactly: DONE <reading>",
].join(" ");

const [mode, stateDir] = process.argv.slice(2);
const log = (...a) => console.log(`[spike ${mode} ${new Date().toISOString()}]`, ...a);

if (mode === "probe") {
  const r = await fetch(`${BASE}/models`, { headers: { authorization: `Bearer ${proxy.apiKey}` } });
  const ids = (await r.json()).data?.map((m) => m.id) ?? [];
  console.log(`HTTP ${r.status}; ${ids.length} models; flash/mini: ${ids.filter((id) => /flash|mini|luna/.test(id)).join(", ")}`);
  process.exit(r.ok ? 0 : 1);
}
if ((mode !== "run" && mode !== "resume") || !stateDir) {
  console.error("usage: spike.mjs probe | run <stateDir> | resume <stateDir>");
  process.exit(2);
}
mkdirSync(stateDir, { recursive: true });
const attempt = (tool, taskId, phase) => appendFileSync(join(stateDir, "attempts.log"), `${JSON.stringify({ tool, taskId, phase, pid: process.pid, at: Date.now() })}\n`);

const fetchReading = defineTool({
  name: "fetch_reading",
  description: "Read the current sensor value. Takes a few seconds.",
  parameters: Type.Object({}),
  replay: "safe",
  execute: async (_args, api) => {
    attempt("fetch_reading", api.taskId, "start");
    writeFileSync(join(stateDir, "in-fetch_reading"), String(process.pid));
    for (let i = 1; i <= TOOL_SECONDS; i++) {
      api.output(`reading ${i}/${TOOL_SECONDS}\n`);
      await sleep(1000);
    }
    attempt("fetch_reading", api.taskId, "end");
    return { content: [{ type: "text", text: "reading=42" }] };
  },
});

const recordResult = defineTool({
  name: "record_result",
  description: "Record a reading in the permanent log. Not safe to repeat.",
  parameters: Type.Object({ reading: Type.String() }),
  execute: async (args, api) => {
    attempt("record_result", api.taskId, "start");
    writeFileSync(join(stateDir, "in-record_result"), String(process.pid));
    for (let i = 1; i <= TOOL_SECONDS; i++) {
      api.output(`recording ${i}/${TOOL_SECONDS}\n`);
      await sleep(1000);
    }
    appendFileSync(join(stateDir, "permanent.log"), `${args.reading}\n`);
    attempt("record_result", api.taskId, "end");
    return { content: [{ type: "text", text: `recorded ${args.reading}` }] };
  },
});

const cliproxy = createProvider({
  id: "cliproxy",
  name: "CLIProxyAPI",
  baseUrl: BASE,
  auth: { apiKey: { name: "CLIProxyAPI", resolve: async () => ({ auth: { apiKey: proxy.apiKey } }) } },
  models: [{
    id: MODEL_ID, name: MODEL_ID, api: "openai-completions", provider: "cliproxy", baseUrl: BASE,
    reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000, maxTokens: 4096,
  }],
  api: openAICompletionsApi(),
});
const models = createModels();
models.setProvider(cliproxy);
const registry = createRegistry();
registry.install(defineExtension({ name: "spike", tools: [fetchReading, recordResult] }));

const openedAt = Date.now();
const harness = await Harness.open(await openNodeSqliteStorage(join(stateDir, "spike.sqlite")), {
  models, registry, settings: { retry: { maxRetries: 2 }, stream: { timeoutMs: 120_000 } },
}, context);
const root = await harness.root(context, { agent: { model: { provider: "cliproxy", modelId: MODEL_ID } } });
log(`harness open in ${Date.now() - openedAt} ms; conversation ${root.id}`);
if (mode === "resume") harness.resume();

const submission = await root.submit({ type: "input", content: PROMPT, requestId: REQUEST_ID }, context);
writeFileSync(join(stateDir, `submission-${mode}`), String(submission.id));
log(`submission ${submission.id}`);

const timeout = sleep(180_000).then(() => ({ status: "timeout" }));
const settled = await Promise.race([submission.wait(context), timeout]);
const page = await root.commit((tx) => tx.scanEntries({ conversationId: root.id }, 500), context);
const entries = page.items.map((e) => ({
  kind: e.kind,
  text: JSON.stringify(e.model ?? e.data ?? null).slice(0, 300),
}));
writeFileSync(join(stateDir, `result-${mode}.json`), `${JSON.stringify({ status: settled.status, entries }, null, 2)}\n`);
log(`settled: ${settled.status}; ${entries.length} entries`);
await harness.close(context);
process.exit(settled.status === "done" ? 0 : 1);
