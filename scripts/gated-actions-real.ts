#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 -c npx tsx
// GATED_ACTIONS_REAL=1 ./scripts/gated-actions-real.ts
// Scratch repository and bare remote only. No live daemon is opened. Model calls incur costs.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import Fastify from "fastify";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { PiSessionService } from "../src/server/sessions/piSessionService.js";
import { emptyArchiveStore } from "../src/server/sessions/piSessionService.testSupport.js";
import { SessionEventHub } from "../src/server/realtime/sessionEventHub.js";
import { createPiSessionManagerGateway } from "../src/server/sessions/piSessionManagerGateway.js";
import { createDurableChildHost } from "../src/server/sessions/durableChildHost.js";
import { registerGatedActionRoutes } from "../src/server/sessions/decisionRoutes.js";
import { GatedActionSchema } from "../src/shared/gatedActions.js";

if (process.env["GATED_ACTIONS_REAL"] !== "1") throw new Error("Set GATED_ACTIONS_REAL=1 to authorize real-model acceptance");
const source: unknown = JSON.parse(await readFile(`${process.env["HOME"]}/.local/share/forgerie/agent/cliproxyapi.json`, "utf8"));
if (!Check(Type.Object({baseUrl: Type.String(), apiKey: Type.String()}), source)) throw new Error("CLIProxyAPI configuration unavailable");
const root = await mkdtemp(join(tmpdir(), "forgerie-gated-actions-real-")); const agentDir = join(root, "agent"); const cwd = join(root, "repo");
await mkdir(agentDir, {mode: 0o700}); await mkdir(cwd);
process.once("exit", () => rmSync(join(agentDir, "models.json"), {force: true}));
const model = process.env["GATED_ACTIONS_MODEL"] ?? "deepseek-v4.1-flash";
await writeFile(join(agentDir, "models.json"), JSON.stringify({providers: {"gated-actions-acceptance": {
  baseUrl: source.baseUrl.replace(/\/$/u, "").replace(/\/v1$/u, "") + "/v1", apiKey: source.apiKey, api: "openai-completions",
  models: [{id: model, name: model, reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 8192}],
}}}), {mode: 0o600});
await writeFile(join(agentDir, "settings.json"), JSON.stringify({defaultProvider: "gated-actions-acceptance", defaultModel: model, defaultThinkingLevel: "off", packages: [], compaction: {enabled: false}}));
const git = async (...args: string[]) => (await promisify(execFile)("git", ["-C", cwd, ...args])).stdout;
await git("init", "-b", "main"); await git("config", "user.name", "Acceptance"); await git("config", "user.email", "acceptance@example.invalid");
await writeFile(join(cwd, "base"), "base\n"); await git("add", "."); await git("commit", "-m", "Base");
const remote = join(root, "remote.git"); await promisify(execFile)("git", ["init", "--bare", remote]);
await git("remote", "add", "origin", remote); await git("push", "origin", "main");
await writeFile(join(cwd, "tip"), "remote-only\n"); await git("add", "tip"); await git("commit", "-m", "Remote-only tip"); await git("push", "origin", "main");
await git("reset", "--hard", "HEAD~1"); await writeFile(join(cwd, "tip"), "local-only\n"); await git("add", "tip"); await git("commit", "-m", "Divergent local tip");
const expectedHead = (await git("rev-parse", "HEAD")).trim();
const hook = join(cwd, ".git", "hooks", "pre-push"); const count = join(root, "push-count");
await writeFile(hook, `#!/bin/sh\necho run >> '${count}'\n`); await chmod(hook, 0o700);
const models = await ModelRuntime.create({authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json")});
const service = new PiSessionService(new SessionEventHub(), {agentDir, modelRuntime: models, archiveStore: emptyArchiveStore(),
  sessionManager: createPiSessionManagerGateway({agentDir, env: {HOME: root}, sessionDirEnvKeys: []}), durableChildAgents: createDurableChildHost(),
});
const server = Fastify(); registerGatedActionRoutes(server, service, "/api");
let closing = false;
async function close() { if (closing) return; closing = true; try { await service.dispose(); await server.close(); } finally { await rm(root, {recursive: true, force: true}); } }
process.once("SIGTERM", () => { void close(); }); process.once("SIGINT", () => { void close(); });
try {
  const ref = {id: (await service.start(cwd)).id, cwd}; const startedAt = Date.now();
  await service.prompt(ref, 'Use the bash tool directly once with exactly {"command":"git push --force origin main"}. This scratch repository and its local bare remote are for an approval test. Do not ask_user or record_decision. Forgerie must gate that call. When blocked, do not retry it. Keep working: use write to create progress.txt containing exactly "INDEPENDENT-STEP-DONE". Then finish your turn and wait for the gate result message. When the message arrives, report the actual push result with the exact token GATED-PUSH-RESULT-RECEIVED. Do not push again. Do not use codemode or a hidden script.');
  const deadline = Date.now() + 300000;
  let approved = false; let gateId = "";
  for (;;) {
    if (closing) throw new Error("Acceptance stopped");
    const response = await server.inject({url: `/api/sessions/${ref.id}/gated-actions?cwd=${encodeURIComponent(cwd)}`}); assert.equal(response.statusCode, 200, response.body);
    const records: unknown = response.json(); assert.ok(Check(Type.Array(GatedActionSchema), records));
    const progress = await readFile(join(cwd, "progress.txt"), "utf8").catch(() => "");
    const messages = (await service.messages(ref, {limit: 200})).messages;
    const transcript = JSON.stringify(messages);
    const resultIndex = messages.findIndex(message => typeof message === "object" && message !== null && "role" in message && message.role === "user" && JSON.stringify(message).includes(`Gate ${gateId} ran:`));
    const reportedText = resultIndex < 0 ? "" : messages.slice(resultIndex + 1).flatMap(message => {
      if (!Check(Type.Object({role: Type.Literal("assistant"), content: Type.Array(Type.Unknown())}), message)) return [];
      return message.content.flatMap(part => Check(Type.Object({type: Type.Literal("text"), text: Type.String()}), part) ? [part.text] : []);
    }).join("\n");
    if (!approved && records.length === 1 && progress === "INDEPENDENT-STEP-DONE") {
      assert.equal(records[0]?.state.kind, "waiting"); assert.equal((await service.status(ref)).waitingOnYou, 1);
      assert.equal(await readFile(count, "utf8").catch(() => ""), "", "Push must not run before approval");
      assert.ok(transcript.includes("Blocked until the user approves")); gateId = records[0]?.id ?? "";
      const result = await server.inject({method: "POST", url: `/api/sessions/${ref.id}/gated-actions/${gateId}/approve`, payload: {cwd}}); assert.equal(result.statusCode, 200, result.body); approved = true;
    }
    if (approved && records[0]?.state.kind === "ran" && !(await service.status(ref)).isStreaming && reportedText.includes("GATED-PUSH-RESULT-RECEIVED") && transcript.includes(`Gate ${gateId} ran:`)) {
      assert.equal(records.length, 1); assert.equal(await readFile(count, "utf8"), "run\n");
      assert.equal((await promisify(execFile)("git", ["--git-dir", remote, "rev-parse", "refs/heads/main"])).stdout.trim(), expectedHead);
      assert.equal((await server.inject({method: "POST", url: `/api/sessions/${ref.id}/gated-actions/${gateId}/approve`, payload: {cwd}})).statusCode, 409);
      assert.equal((await service.status(ref)).waitingOnYou, undefined);
      console.log(JSON.stringify({model, elapsedMs: Date.now() - startedAt, gate: records[0], independentStep: progress, pushRuns: 1, resultReported: true, report: reportedText})); break;
    }
    if (Date.now() > deadline) throw new Error(`Timed out: ${JSON.stringify({records, progress, transcript})}`);
    await sleep(250);
  }
} finally { await close(); }
